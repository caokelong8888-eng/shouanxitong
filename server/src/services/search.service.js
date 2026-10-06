import * as searchRepo from '../db/repositories/search.repo.js';
import * as stockRepo from '../db/repositories/stock.repo.js';
import * as tagRepo from '../db/repositories/tag.repo.js';
import * as imageRepo from '../db/repositories/image.repo.js';

/**
 * 搜索服务 —— 全 App 最核心的功能。
 *
 * 设计取向：搜索结果不只是物品名字，必须让用户直接定位到现实位置。
 * 所以每条结果都带上「位置列表」，并且把「不在盒子里」的物品单独标出来，
 * 免得用户照着盒子去找却扑空。
 *
 * 支持的类型：
 *   keyword  关键词（含模糊，默认）
 *   category 按分类
 *   tag      按标签
 *   semantic 语义搜索 —— 第五阶段接入 AI，本阶段返回明确提示，不做假命中
 */

/** 给一批物品补上位置信息、标签、封面图 */
function enrich(familyId, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const tagMap = tagRepo.listTagsForItems(ids);

  return rows.map((r) => {
    const stocks = stockRepo.listStockByItem(r.id);
    const places = stocks.map((s) => ({
      stock_id: s.id,
      container_id: s.container_id,
      container_code: s.container_code,
      container_name: s.container_name,
      full_path: s.full_path,
      quantity: s.quantity,
      status: s.status,
      note: s.note,
      in_box: s.container_id !== null,
    }));
    const cover = imageRepo.getCoverImageForItem(r.id);

    // 位置展示文案：在盒子里 → 显示路径；不在盒子里 → 说明当前状态
    const primary = places.find((p) => p.in_box) || places[0] || null;
    const locationText = primary
      ? primary.in_box
        ? primary.full_path
        : primary.note || '不在盒子里'
      : '暂无存放记录';

    return {
      ...r,
      tags: tagMap[r.id] || [],
      places,
      total_quantity: places.reduce((s, p) => s + Number(p.quantity || 0), 0),
      container_count: places.filter((p) => p.in_box).length,
      location_text: locationText,
      cover_thumb_url: cover?.thumb_url || cover?.url || null,
      cover_url: cover?.url || null,
      abnormal: places.some((p) => !p.in_box || (p.status && p.status !== 'in_box')),
    };
  });
}

/**
 * 从查询里认出「哪些词是在说位置」。
 *
 * 【为什么需要】
 * 用户会直接搜「书房里面的电池」。但检索只发生在物品名/标签/分类上，
 * 位置完全不参与 —— 结果就变成「书房」这两个字被当成噪声丢掉，
 * 然后一本正经地返回一件根本不在书房的充电宝。
 *
 * 这里做的事很简单也很可靠：把家里现有哪些空间名、区域名列出来，
 * 看哪些出现在查询里。出现了就把它们从查询里摘掉 当成过滤条件。
 * 摘掉之后剩下的才是真正要找的东西（「电池」）。
 *
 * 纯字符串匹配，不猜语义 —— 宁可少过滤也不能给错结果，
 * 搜不到用户会换个词，搜错了用户会以为家里东西丢了。
 */
function detectPlaceFilter(familyId, keyword) {
  let text = String(keyword || '');
  const trimmed = text.trim();
  if (!trimmed) return { filter: null, keyword: trimmed, matched: [] };

  const places = searchRepo.listPlaceNames(familyId);
  const matched = [];
  const spaceIds = [];
  const locationIds = [];

  for (const p of places) {
    if (!p.name) continue;
    // 已经判定为位置词的就不再重复匹配（比如两个空间都叫「书房」）
    if (matched.some((m) => m.name.includes(p.name) || p.name.includes(m.name))) continue;
    if (!text.includes(p.name)) continue;
    matched.push(p);
    text = text.split(p.name).join(' ');
    if (p.type === 'space') spaceIds.push(p.id);
    else locationIds.push(p.id);
  }

  if (!matched.length) return { filter: null, keyword: trimmed, matched: [] };
  return {
    filter: { spaceIds, locationIds },
    keyword: text.replace(/\s+/g, ' ').trim(),
    matched: matched.map((m) => m.name),
  };
}

export function search(familyId, { q = '', type = 'keyword', categoryId = null, tag = null, limit = 30 }) {
  const keyword = String(q || '').trim();

  if (type === 'category' || categoryId) {
    const cid = Number(categoryId || keyword);
    if (!Number.isInteger(cid)) return { type: 'category', query: keyword, items: [], suggestions: {} };
    const rows = searchRepo.searchItemsByCategory(familyId, cid, limit);
    return { type: 'category', query: keyword, items: enrich(familyId, rows), suggestions: {} };
  }

  if (type === 'tag' || (tag && !keyword)) {
    const t = tag || keyword;
    const rows = searchRepo.searchItemsByTag(familyId, t, limit);
    return { type: 'tag', query: t, items: enrich(familyId, rows), suggestions: {} };
  }

  if (type === 'semantic') {
    // 第五阶段接入：把自然语言交给 AI 解析成结构化查询条件，再回到上面的检索。
    // 本阶段不做假命中，明确告知用户当前状态，避免"看起来能搜其实搜不准"。
    return {
      type: 'semantic',
      query: keyword,
      available: false,
      message: '语义搜索还没接入，先试试直接用物品名或关键词搜',
      items: [],
      suggestions: {},
    };
  }

  if (!keyword) return { type: 'keyword', query: '', items: [], suggestions: {} };

  // 位置词先摘出来，剩下的才是要找的东西
  const { filter, keyword: rest, matched } = detectPlaceFilter(familyId, keyword);
  const rows = searchRepo.searchItemsByKeyword(familyId, rest || keyword, limit, filter);

  return {
    type: 'keyword',
    query: keyword,
    // 告诉前端「限定了哪些位置」，搜索框下面要显示出来，
    // 不然用户会疑惑为什么搜「电视线」少了那么多结果
    place_filter: matched.length ? matched : null,
    items: enrich(familyId, rows),
    // 顺带给出分类/标签/盒子的相关命中，方便用户换一种方式找
    suggestions: {
      categories: searchRepo.searchCategories(familyId, keyword),
      tags: searchRepo.searchTags(familyId, keyword),
      containers: searchRepo.searchContainers(familyId, keyword),
    },
  };
}

