import { getRecognizer } from '../adapters/ai/index.js';
import { getStorage } from '../adapters/storage/index.js';
import { getDb } from '../db/connection.js';
import * as imageRepo from '../db/repositories/image.repo.js';
import * as categoryRepo from '../db/repositories/category.repo.js';
import * as tagRepo from '../db/repositories/tag.repo.js';
import * as itemRepo from '../db/repositories/item.repo.js';
import * as stockRepo from '../db/repositories/stock.repo.js';
import * as containerRepo from '../db/repositories/container.repo.js';
import * as activityRepo from '../db/repositories/activity.repo.js';
import { ok, badRequest, notFound, AppError } from '../utils/response.js';
import { parseId } from '../middleware/family.js';
import { config } from '../config/index.js';

/**
 * AI 相关接口。
 *
 * 【重要】前端完全不感知模型名称，一切通过这里统一调用。
 * 换模型只改后端配置（AI_DRIVER / AI_ENDPOINT / AI_MODEL），前端不用重发版本。
 *
 * 【强制要求】AI 给出的名称、分类、标签、数量全部允许人工修改。
 * 这些接口只负责「给出建议」，最终写入以用户确认后的数据为准。
 */

const WHAT_IS_THIS_PROMPT = `用户拿了一个东西不知道是什么，请你帮忙判断。只返回 JSON：
{
  "name": "这看起来像什么（中文，不确定就写「疑似 XXX」）",
  "category": "分类",
  "tags": ["相关关键词"],
  "brand": null,
  "model": null,
  "color": "颜色",
  "quantity": 1,
  "unit": "个",
  "description": "它是什么、通常用来干什么",
  "usage": "常见用途，2-3 句话，说人话",
  "related": ["可能一起出现的物品"],
  "confidence": 0.8,
  "needConfirm": false
}`;

/** 确保 AI 提到的分类存在（不存在就自动建一个，用户可后续改名） */
function resolveCategory(familyId, categoryName) {
  if (!categoryName) return null;
  return categoryRepo.ensureCategory(familyId, String(categoryName).trim());
}

/**
 * 把一件物品完整写入库：建物品 → 标签 → 库存 → 绑照片。
 * 整体包在一个事务里，任一步失败则整条回滚，不留半条数据。
 *
 * 【同款合并】
 * 库里已经有同名物品时不再新建，而是复用它、只把数量加上。
 * item 的语义是「物品规格」而不是「某一根线」——
 * 家里 3 根 HDMI 线应该是 1 个 item + 数量 3，而不是 3 个 item 各 1 根。
 * 之前每次都新建，搜索会出来 3 条重复结果，盒子详情里也是 3 行。
 *
 * 复用时要注意别把用户原来的信息冲掉：
 *   - 分类：原来的有就保留（AI 这次分类猜错了也不能改用户的）
 *   - 标签：取并集，不覆盖
 *   - 描述/品牌等：原来的有就保留
 */
function persistInboundItem(p) {
  const db = getDb();
  const run = db.transaction(() => {
    const category = resolveCategory(p.familyId, p.categoryName);

    // 先找同款的已有物品
    const existing = itemRepo.findItemByName(p.familyId, p.name);

    let item;
    let merged = false;

    if (existing) {
      // 复用已有物品，只加库存
      item = existing;
      merged = true;

      // 标签取并集：新照片带来的新标签补上，老的不删
      if (p.tags?.length) {
        const oldTags = tagRepo.listItemTags(item.id).map((t) => t.name);
        const merged2 = [...new Set([...oldTags, ...p.tags.map((t) => String(t).trim()).filter(Boolean)])];
        if (merged2.length !== oldTags.length) {
          tagRepo.setItemTags(item.id, p.familyId, merged2);
        }
      }

      // 补上缺失的字段（原来是空、这次有值的才补）
      const patch = {};
      if (!item.description && p.description) patch.description = p.description;
      if (!item.brand && p.brand) patch.brand = p.brand;
      if (!item.model && p.model) patch.model = p.model;
      if (!item.color && p.color) patch.color = p.color;
      if (!item.unit && p.unit) patch.unit = p.unit;
      if (!item.category_id && category) patch.categoryId = category.id;
      if (Object.keys(patch).length) {
        itemRepo.updateItem(item.id, p.familyId, { ...patch, userId: p.userId });
        item = itemRepo.getItem(item.id, p.familyId);
      }
      itemRepo.refreshSearchText(item.id);
    } else {
      item = itemRepo.createItem({
        familyId: p.familyId,
        name: p.name,
        categoryId: category?.id ?? null,
        description: p.description,
        brand: p.brand,
        model: p.model,
        color: p.color,
        unit: p.unit,
        status: 'in_box',
        aiConfidence: p.aiConfidence,
        needConfirm: p.needConfirm,
        userId: p.userId,
      });

      if (p.tags?.length) tagRepo.setItemTags(item.id, p.familyId, p.tags);
      itemRepo.refreshSearchText(item.id);
    }

    // upsert 保证「同一物品 + 同一盒子」只保留一条库存记录，重复放入时累加数量
    const qty = Number.isFinite(Number(p.quantity)) && Number(p.quantity) > 0 ? Number(p.quantity) : 1;
    stockRepo.upsertStock({
      itemId: item.id,
      containerId: p.containerId,
      quantity: qty,
      status: 'in_box',
      note: p.note,
    });

    if (p.imageIds?.length) {
      const imgs = imageRepo.getImagesByIds(p.imageIds);
      imageRepo.bindImagesToItem(p.imageIds, item.id, imgs[0]?.id ?? null);
    }

    return { itemId: item.id, quantity: qty, unit: item.unit, merged };
  });
  return run();
}

/**
 * POST /api/recognize
 * 入参：{ imageId } 或 { imageIds: [] }
 * 出参：单张 → { result }；多张 → { results: [{imageId, status, result|error}] }
 *
 * 连拍场景下逐张识别，单张失败不影响其他张（对应「不要因为一次失败让用户重拍」）。
 */
export async function recognize(req, res) {
  const single = req.body?.imageId;
  const list = Array.isArray(req.body?.imageIds) ? req.body.imageIds : single ? [single] : [];
  if (!list.length) throw badRequest('缺少 imageId 或 imageIds');

  const recognizer = getRecognizer();
  const images = imageRepo.getImagesByIds(list.map((n) => Number(n)));
  if (!images.length) throw notFound('图片');

  const byId = new Map(images.map((i) => [i.id, i]));

  const runOne = async (imageId, index) => {
    const image = byId.get(Number(imageId));
    if (!image) return { imageId, status: 'error', error: '图片不存在' };
    try {
      const raw = await recognizer.recognize(image.original_path, {
        index,
        thumbPath: image.thumb_path,
      });
      return {
        imageId: image.id,
        status: 'ok',
        thumbUrl: image.thumb_url || image.url,
        result: {
          name: raw.name,
          category: raw.category,
          categoryId: null, // 由前端确认后再解析，避免提前建错分类
          tags: raw.tags,
          brand: raw.brand,
          model: raw.model,
          color: raw.color,
          quantity: raw.quantity,
          unit: raw.unit,
          description: raw.description,
          // 这两个字段 AI 一直在返回，但这里以前没往下传 ——
          // 结果入库卡片上「怎么用」「可能和什么放一起」永远是空的。
          usage: raw.usage || '',
          related: Array.isArray(raw.related) ? raw.related : [],
          confidence: raw.confidence,
          needConfirm: raw.needConfirm,
        },
      };
    } catch (err) {
      // 失败也要给用户明确出路：重新识别 / 手动填写 / 取消（前端按此渲染）
      return {
        imageId: image.id,
        status: 'error',
        thumbUrl: image.thumb_url || image.url,
        error: err instanceof AppError ? err.message : '暂时无法识别这张图片',
        code: err?.code || 'AI_ERROR',
        actions: ['retry', 'manual', 'cancel'],
      };
    }
  };

  // 并发识别：一次发 3 张、齐了再发下一批。
  // 原来是一张一张排队（await 在循环里），5 张图要等 5 倍单张时间。
  // 3 路是实测下来比较稳的数字 —— 再高容易撞上 API 的并发上限，反而整体变慢。
  const CONCURRENCY = 3;
  const results = new Array(list.length);
  for (let start = 0; start < list.length; start += CONCURRENCY) {
    const batch = list.slice(start, start + CONCURRENCY);
    const done = await Promise.all(batch.map((imageId, k) => runOne(imageId, start + k)));
    done.forEach((r, k) => { results[start + k] = r; });
  }

  activityRepo.log({
    familyId: req.familyId,
    userId: req.userId,
    action: 'ai_recognize',
    entityType: 'image',
    entityId: results[0]?.imageId ?? null,
    summary: `识别了 ${results.length} 张图片`,
  });

  const driver = config.ai.driver;
  if (single && results.length === 1) {
    const r = results[0];
    if (r.status === 'error') {
      return res.status(200).json({
        ok: false,
        error: { message: r.error, code: r.code, actions: r.actions },
        data: r,
      });
    }
    return ok(res, { ...r, driver });
  }
  return ok(res, { results, driver });
}

/**
 * POST /api/recognize/what-is-this
 * 「这是什么？」—— 与正式入库分开的独立入口。
 * 只识别，不落库；用户可以选择保存或只看看。
 */
export async function whatIsThis(req, res) {
  const imageId = req.body?.imageId;
  if (!imageId) throw badRequest('缺少 imageId');

  const image = imageRepo.getImage(parseId(imageId, 'imageId'));
  if (!image) throw notFound('图片');

  const recognizer = getRecognizer();
  try {
    const raw = await recognizer.recognize(image.original_path, {
      prompt: WHAT_IS_THIS_PROMPT,
      index: 0,
      thumbPath: image.thumb_path,
    });
    return ok(res, {
      imageId: image.id,
      thumbUrl: image.thumb_url || image.url,
      url: image.url,
      // 和入库流程共用同一套字段，额外多了 usage / related
      name: raw.name,
      category: raw.category,
      tags: raw.tags,
      brand: raw.brand,
      model: raw.model,
      color: raw.color,
      quantity: raw.quantity,
      unit: raw.unit,
      description: raw.description,
      usage: raw._meta?.usage || raw.usage || raw.description,
      related: raw.related || [],
      confidence: raw.confidence,
      needConfirm: raw.needConfirm,
      driver: config.ai.driver,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: {
        message: err instanceof AppError ? err.message : '暂时无法识别这张图片',
        code: err?.code || 'AI_ERROR',
        actions: ['retry', 'cancel'],
      },
    });
  }
}

/**
 * POST /api/inbound/batch  —— 连续拍照入库的落库入口
 * 入参：
 * {
 *   containerId: 3,
 *   items: [
 *     { imageIds: [11], name:"USB-C数据线", category:"电子配件", tags:["USB-C"], quantity:1, unit:"条",
 *       brand, model, color, description, confidence, needConfirm }
 *   ]
 * }
 *
 * 说明：这里的数据是「用户确认/修改后」的结果，不是 AI 原始输出。
 * 分类按名字对齐（不存在则新建），标签同理。
 */
export async function batchInbound(req, res) {
  const familyId = req.familyId;
  const userId = req.userId;

  const containerIdRaw = req.body?.containerId;
  // 不选盒子也允许入库。
  // 有些东西只是「记一下家里有」，暂时不打算归到哪个盒子 ——
  // 硬拦着只会让人嫌麻烦干脆不记了。stock.container_id 允许为空，
  // stock.repo 的 upsert / findStock 也都显式处理过 null，链路是通的。
  // 填了盒子就照旧校验盒子合法性（填错了要报错，不能静默忽略）。
  let container = null;
  if (containerIdRaw !== undefined && containerIdRaw !== null && containerIdRaw !== '' && containerIdRaw !== 0) {
    container = containerRepo.getContainer(Number(containerIdRaw), familyId);
    if (!container) throw badRequest('盒子不存在');
  }

  const rows = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rows.length) throw badRequest('没有要入库的物品');

  const created = [];
  const failed = [];

  // 每件物品的写入（建物品 + 标签 + 库存 + 绑图）必须原子，
  // 否则中途失败会留下「物品建了但没进盒子」的半条数据。
  for (const row of rows) {
    try {
      const name = String(row.name || '').trim();
      if (!name) throw badRequest('物品名称不能为空');

      const payload = {
        familyId,
        name,
        categoryName: row.category,
        description: row.description ?? null,
        brand: row.brand ?? null,
        model: row.model ?? null,
        color: row.color ?? null,
        unit: row.unit ?? null,
        aiConfidence: row.confidence ?? null,
        needConfirm: row.needConfirm ?? false,
        userId,
        containerId: container?.id ?? null,
        quantity: row.quantity,
        note: row.note ?? null,
        tags: row.tags,
        imageIds: Array.isArray(row.imageIds) ? row.imageIds.map((n) => Number(n)) : [],
      };

      const saved = persistInboundItem(payload);
      created.push({
        itemId: saved.itemId,
        name,
        quantity: saved.quantity,
        unit: saved.unit,
        // true = 库里已有同款，这次是把数量加上而不是新建
        merged: !!saved.merged,
      });
    } catch (err) {
      failed.push({ name: row?.name || '(未命名)', message: err.message });
    }
  }

  activityRepo.log({
    familyId,
    userId,
    action: 'inbound',
    // 没选盒子时，日志挂在物品上而不是某个盒子
    entityType: container ? 'container' : 'item',
    entityId: container ? container.id : created[0]?.itemId ?? null,
    summary: container
      ? `一次性把 ${created.length} 件物品放进了${container.name}`
      : `记录了 ${created.length} 件物品（暂未放入盒子）`,
    detail: { created: created.map((c) => c.name), failed: failed.length },
  });

  return ok(res, {
    // 没选盒子时这几个字段为 null，前端据此决定跳不跳转
    containerId: container?.id ?? null,
    containerName: container?.name ?? null,
    fullPath: container?.full_path ?? null,
    createdCount: created.length,
    created,
    failed,
  });
}

/** 未关联的图片（连拍上传后，用户中途退出留下的） */
export function listPendingImages(_req, res) {
  return ok(res, imageRepo.listUnassignedImages());
}
