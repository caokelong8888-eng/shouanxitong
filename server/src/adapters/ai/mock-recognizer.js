/**
 * AI 识别适配器 —— Mock 实现（第一阶段）。
 *
 * 为什么先做 mock：
 *   用户选择「AI 先留接口占位」。但 mock 的价值不只是占位 ——
 *   它把「识别结果长什么样」这个契约先冻结下来。
 *   之后接真实模型时，只要返回同样的字段，前端一行都不用改。
 *
 * 【契约 · 不可随意改动】
 *   {
 *     name:        string   物品名称
 *     category:    string   分类名（后端会自动建分类）
 *     tags:        string[] 可搜索关键词
 *     brand:       string|null
 *     model:       string|null
 *     color:       string|null
 *     quantity:    number   数量（判断不出时为 1）
 *     unit:        string|null  节/个/条...
 *     description: string   一句话描述
 *     usage:       string   常见用途（「这是什么？」页要显示，说人话、2-3 句）
 *     related:     string[] 可能一起出现的物品（「这是什么？」页要显示）
 *     confidence:  number   0~1 置信度
 *     needConfirm: boolean  true 表示 AI 不确定，需要人工确认
 *   }
 *   不管真实模型返回什么，适配器层负责归一化成上面的形状。
 */

/** 模拟一批常见物品，用图片序号轮换，让 demo 有变化 */
const SAMPLES = [
  { name: 'USB-C数据线', category: '电子配件', tags: ['USB-C', '数据线', '充电'], color: '白色', quantity: 1, unit: '条', description: 'Type-C 接口的快充数据线', usage: '手机、平板、笔记本充电和传数据都能用。出门带一条最方便。', related: ['充电头', 'USB-C 插座', '收纳袋'], confidence: 0.93 },
  { name: 'AA电池', category: '电池', tags: ['AA', '5号', '电池'], color: null, quantity: 4, unit: '节', description: '5 号碱性电池', usage: '遥控器、玩具、手电筒都能用。放久了会漏液，长期不用要取出来。', related: ['电池盒', '充电器', '螺丝刀'], confidence: 0.95 },
  { name: 'HDMI线', category: '电子配件', tags: ['HDMI', '视频线', '电视'], color: '黑色', quantity: 1, unit: '条', description: '标准 HDMI 高清线', usage: '接电视、显示器、投影仪传画面。换电视的时候最常用的一根线。', related: ['HDMI 转接器', '电视遥控器', '理线扣'], confidence: 0.92 },
  { name: '六角扳手', category: '工具', tags: ['内六角', '扳手', '工具'], color: '银色', quantity: 1, unit: '套', description: '内六角扳手套装', usage: '装家具、修自行车、拆电器都用得上。租房时建议自己带一套。', related: ['螺丝刀', '卷尺', '工具箱'], confidence: 0.88 },
  { name: '不明物品', category: '待确认', tags: ['待确认'], color: null, quantity: 1, unit: null, description: '暂时无法确定这是什么，建议手动填写名称', usage: '看不太清，建议换个角度、光线亮一点再拍一张，或者直接手写名称。', related: [], confidence: 0.32, needConfirm: true },
];

let mockCursor = 0;

export const mockRecognizer = {
  driver: 'mock',

  /**
   * @param {string} imagePath 图片在存储中的相对路径（mock 不真的读取它）
   * @param {{index?:number}} opts index 可指定返回第几个样本，方便前端演示
   */
  async recognize(imagePath, opts = {}) {
    // 制造一点真实感：真实模型有网络耗时
    await new Promise((r) => setTimeout(r, 260));

    const idx = Number.isInteger(opts.index) ? opts.index : mockCursor++;
    const sample = SAMPLES[idx % SAMPLES.length];

    return {
      name: sample.name,
      category: sample.category,
      tags: [...sample.tags],
      brand: null,
      model: null,
      color: sample.color ?? null,
      quantity: sample.quantity ?? 1,
      unit: sample.unit ?? null,
      description: sample.description,
      usage: sample.usage || '',
      related: [...(sample.related || [])],
      confidence: sample.confidence,
      needConfirm: Boolean(sample.needConfirm) || sample.confidence < 0.5,
      // 元信息：告诉调用方这次是谁识别的，便于排查
      _meta: { driver: 'mock', imagePath, sample: idx % SAMPLES.length },
    };
  },
};

/** 让 mock 结果可复现（测试用） */
export function resetMockCursor() {
  mockCursor = 0;
}
