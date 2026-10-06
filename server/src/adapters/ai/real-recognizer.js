import { config } from '../../config/index.js';
import { mockRecognizer } from './mock-recognizer.js';
import { AppError } from '../../utils/response.js';

/**
 * 真实 AI 识别适配器 —— 骨架。
 *
 * 接入步骤（前端零改动）：
 *   1. .env 填 AI_API_KEY / AI_ENDPOINT / AI_MODEL
 *   2. 在本文件 buildRequest() 里按所选模型的协议组装请求
 *   3. 把 AI_DRIVER 设为 real
 *
 * 【重要】前端不感知模型名称。换模型只改这里的配置，前端不重发版本。
 * 不管是哪家模型，本适配器都必须把结果归一化成 mock-recognizer.js 顶部注释里的契约形状。
 */

const PROMPT = `你是一个家庭物品识别助手。请识别图片中的物品，并只返回 JSON，不要任何多余文字。
字段要求：
name（物品名称，中文。无法确定时用「疑似 XXX」并在 needConfirm 标记 true）
category（分类，从以下选一个：电子配件、电池、工具、文具、生活用品、厨房用品、药品、衣物、玩具、待确认）
tags（4-8 个可搜索关键词，包含品牌、型号、用途、别名）
brand（品牌，看不出来填 null）
model（型号，看不出来填 null）
color（颜色）
quantity（数量，判断不出填 1）
unit（单位：个/条/节/套/瓶...）
description（一句话描述这是什么、干什么用）
usage（2-3 句人话说明：这东西日常怎么用、什么时候会想起它。不要写「用于...」这种说明书口气）
related（3-6 个「可能和它放在一起」的物品名，用于提示收纳位置，例如 ["充电线","手机","备用电池"]）
confidence（0 到 1 的置信度，不确定就低分）
needConfirm（布尔值，true 表示需要人工确认）

示例输出：
{"name":"USB-C 转 HDMI 转接器","category":"电子配件","tags":["USB-C","HDMI","转接器","显示器配件"],"brand":null,"model":null,"color":"银灰","quantity":1,"unit":"个","description":"把 USB-C 接口的信号转成 HDMI 输出","usage":"出差或上课时，笔记本只有 USB-C 口但投影仪是 HDMI 口，中间靠它接一下就能投屏。不用的时候塞进电脑包侧袋就行。","related":["USB-C 数据线","笔记本电脑","HDMI 线"],"confidence":0.91,"needConfirm":false}`;

function assertConfigured() {
  if (!config.ai.endpoint || !config.ai.apiKey) {
    throw new AppError(
      'AI 识别服务还没配置（缺少 AI_ENDPOINT / AI_API_KEY），可以先手动填写物品信息',
      501,
      'AI_NOT_CONFIGURED'
    );
  }
}

/** 从模型返回的文本里抠出 JSON —— 模型常会裹 ```json 或多余说明 */
function extractJson(text) {
  if (!text) throw new AppError('AI 没有返回内容', 502, 'AI_EMPTY_RESPONSE');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new AppError('AI 返回的内容无法解析', 502, 'AI_BAD_JSON');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AppError('AI 返回的内容无法解析', 502, 'AI_BAD_JSON');
  }
}

/** 归一化：无论模型怎么返回，都收敛成前端契约的形状 */
export function normalize(raw) {
  const confidence = Number(raw.confidence);
  const safeConfidence = Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5;
  const name = String(raw.name || '').trim() || '未知物品';
  return {
    name,
    category: String(raw.category || '待确认').trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [],
    brand: raw.brand ? String(raw.brand) : null,
    model: raw.model ? String(raw.model) : null,
    color: raw.color ? String(raw.color) : null,
    quantity: Number.isFinite(Number(raw.quantity)) && Number(raw.quantity) > 0 ? Number(raw.quantity) : 1,
    unit: raw.unit ? String(raw.unit) : null,
    description: String(raw.description || '').trim(),
    // 「这是什么？」页要用这两个字段讲清楚「干什么用的」「可能和什么放一起」。
    // 少了它们，ai.controller 里的 raw._meta?.usage / raw.usage 永远取不到值，
    // usage 会静默退回 description、related 永远是空数组，那块 UI 就白写了。
    usage: String(raw.usage || '').trim(),
    related: Array.isArray(raw.related)
      ? raw.related.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : [],
    confidence: safeConfidence,
    needConfirm: raw.needConfirm === true || safeConfidence < 0.6,
  };
}

export const realRecognizer = {
  driver: 'real',

  /**
   * @param {string} imagePath 原图相对路径
   * @param {{prompt?:string, index?:number, thumbPath?:string|null}} opts
   *   thumbPath 存在时优先用缩略图 —— 640px 认「这是什么」已经足够，
   *   而原图动辄 2~3MB，base64 后 4MB 起步，弱网下光传图就要十几秒，纯属浪费。
   */
  async recognize(imagePath, opts = {}) {
    assertConfigured();
    const { getStorage } = await import('../storage/index.js');
    const storage = getStorage();

    // 优先缩略图；缩略图生成失败时 thumb_path 为 null，退回原图
    let source = 'thumb';
    let buf = opts.thumbPath ? await storage.read(opts.thumbPath) : null;
    if (!buf) {
      source = 'original';
      buf = await storage.read(imagePath);
    }
    if (!buf) throw new AppError('找不到这张图片，可能已被清理', 404, 'IMAGE_NOT_FOUND');

    // 缩略图一律是 JPEG；退回原图时按扩展名给个靠谱的 mime，别一律当 jpeg
    const usedMime =
      source === 'thumb'
        ? 'image/jpeg'
        : /\.png$/i.test(imagePath)
          ? 'image/png'
          : /\.webp$/i.test(imagePath)
            ? 'image/webp'
            : 'image/jpeg';

    const base64 = buf.toString('base64');

    // TODO(第二阶段)：接入时按实际模型协议替换本段请求体与响应解析。
    // 下面给出的是「OpenAI 兼容 /chat/completions + 图片 base64」的通用写法，
    // 多数国内视觉模型（含 DeepSeek 系）协议一致，只需改 endpoint 与 model。
    const body = {
      model: config.ai.model || 'vision-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt || PROMPT },
            { type: 'image_url', image_url: { url: `data:${usedMime};base64,${base64}` } },
          ],
        },
      ],
      temperature: 0.2,
      // 关掉「深度思考」——这是速度慢的元凶。
      // 认「这是什么东西」不需要推理链：看一眼就能答。
      // 实测同一张图：开着要 8 秒、思考 1200+ token；关掉 1.5 秒、思考 0 token，识别质量没有实质差别。
      // 注意：参数名是 thinking.type，只有它生效（reasoning_effort / effort 会被 DeepSeek 静默忽略）。
      ...(config.ai.thinking === false ? { thinking: { type: 'disabled' } } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.ai.timeout);
    let resp;
    try {
      resp = await fetch(config.ai.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ai.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new AppError('AI 识别超时了，请重试', 504, 'AI_TIMEOUT');
      throw new AppError('连不上 AI 识别服务，请检查网络后重试', 502, 'AI_UNREACHABLE');
    }
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError(`AI 识别失败（${resp.status}）${text.slice(0, 120)}`, 502, 'AI_ERROR');
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content ?? json?.output_text ?? '';
    const parsed = extractJson(typeof content === 'string' ? content : JSON.stringify(content));
    const result = normalize(parsed);
    result._meta = { driver: 'real', imagePath, source, model: body.model };
    return result;
  },
};

export { PROMPT, extractJson };
