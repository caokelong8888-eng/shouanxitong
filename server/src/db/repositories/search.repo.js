import { getDb } from '../connection.js';

/**
 * 搜索仓储。
 * 分两级：
 *   - 结构化检索（本文件）：LIKE 模糊 + 分类 + 标签，快、可预测、零成本
 *   - 语义检索（第五阶段）：走 AI 把自然语言转成结构化查询条件后再调这里
 */

/**
 * 把用户输入的「人话」拆成可匹配的词元。
 *
 * 为什么需要这一步：
 *   用户不会按物品全名搜索。搜「电视线」想找的是「HDMI线」，
 *   搜「给电视用的线」也是同一个东西。纯 LIKE 做不到，所以：
 *     1. 砍掉口语助词（我的/那个/给…用的/上次买的）
 *     2. 去掉「线」这类泛化后缀，让「电视线」→「电视」
 *     3. 中文按二元切分（电视线 → 电视 / 视线），英文数字按词切
 *   得到多个词元后逐个 OR 匹配，命中任何一个就算候选，再按得分排序。
 */
const STOP_WORDS = [
  '我的', '我家的', '那个', '这个', '一个', '上次买的', '上回买的', '买的东西',
  '给我', '给', '用的', '用来', '请问', '帮我', '找一下', '找找', '在哪', '哪里',
  '什么东西', '是啥', '什么', '地方', '东西',
];

/** 泛化后缀：去掉后词义不受影响，反而能扩大召回（电视线 → 电视） */
const GENERIC_SUFFIX = ['线', '头', '子', '儿', '器', '用品'];

export function tokenize(input) {
  let text = String(input || '').trim().toLowerCase();
  if (!text) return [];

  // 1) 去掉口语助词
  for (const w of STOP_WORDS) text = text.split(w).join(' ');

  // 2) 按空白与标点切分
  const chunks = text.split(/[\s,，。、；;：:!！?？/\\|()（）\[\]【】"'`]+/).filter(Boolean);

  const tokens = new Set();
  for (const chunk of chunks) {
    // 英文数字整体保留
    if (/^[a-z0-9][a-z0-9\-+. ]*$/.test(chunk)) {
      tokens.add(chunk.trim());
      continue;
    }
    // 中文：原词 + 去泛化后缀 + 二元切分
    tokens.add(chunk);
    for (const suf of GENERIC_SUFFIX) {
      if (chunk.length > suf.length && chunk.endsWith(suf)) {
        tokens.add(chunk.slice(0, -suf.length));
      }
    }
    if (chunk.length >= 3) {
      for (let i = 0; i + 2 <= chunk.length; i += 1) tokens.add(chunk.slice(i, i + 2));
    }
  }
  // 太短的词元（单个汉字）噪声大，除非整句就一个字
  const list = [...tokens].filter((t) => t.length >= 2 || chunks.length === 1);
  return list.length ? list : [...tokens];
}

/**
 * 关键词检索。
 * 策略：先把输入拆成词元，每个词元去匹配 名称/品牌/型号/描述/标签/检索冗余字段，
 * 命中任意词元即入选；再按「匹配了多少个词元 + 匹配位置」打分排序。
 * 这样「电视线」能通过词元「电视」命中标签里带「电视」的 HDMI线。
 *
 * placeFilter：位置限定（对应「书房里面的电池」这类查询）。
 *   传了就只返回「在指定空间/区域里的盒子中」的那部分物品。
 *   不传（null）则不过滤。
 */
export function searchItemsByKeyword(familyId, keyword, limit = 30, placeFilter = null) {
  const kw = String(keyword || '').trim();
  if (!kw) return placeFilter ? searchItemsByPlace(familyId, placeFilter, limit) : [];

  const tokens = tokenize(kw);
  if (!tokens.length) return placeFilter ? searchItemsByPlace(familyId, placeFilter, limit) : [];

  // 为每个词元生成一组匹配条件，占位符命名成 t0,t1...
  const clauses = [];
  const params = { familyId, limit, exact: kw, exactPrefix: `${kw}%` };
  tokens.forEach((tok, i) => {
    const key = `tok${i}`;
    params[key] = `%${tok}%`;
    clauses.push(`(
      i.name LIKE @${key}
      OR i.brand LIKE @${key}
      OR i.model LIKE @${key}
      OR i.color LIKE @${key}
      OR i.description LIKE @${key}
      OR i.search_text LIKE @${key}
      OR EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                  WHERE it.item_id = i.id AND t.name LIKE @${key})
      OR EXISTS (SELECT 1 FROM categories cat
                  WHERE cat.id = i.category_id AND cat.name LIKE @${key})
    )`);
  });

  // 得分：命中词元数量越多越高；名称完全等于原输入额外加分
  const scoreParts = tokens
    .map((_t, i) => `(CASE WHEN (i.name LIKE @tok${i} OR i.search_text LIKE @tok${i} OR i.brand LIKE @tok${i} OR i.model LIKE @tok${i} OR i.color LIKE @tok${i} OR i.description LIKE @tok${i} OR EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name LIKE @tok${i})) THEN 10 ELSE 0 END)`)
    .join(' + ');

  // 位置限定条件
  let placeSql = '';
  if (placeFilter) {
    const { spaceIds = [], locationIds = [] } = placeFilter;
    const ids = [...spaceIds, ...locationIds].filter((n) => Number.isInteger(n));
    if (!ids.length) return []; // 传了个空范围 → 明确返回空，不给「全量」这种误导结果
    const ph = ids.map(() => '?').join(',');
    placeSql = `AND EXISTS (
      SELECT 1 FROM stock s2
      JOIN containers c2 ON c2.id = s2.container_id
      WHERE s2.item_id = i.id
        AND (c2.space_id IN (${ph}) OR c2.location_id IN (${ph}))
    )`;
  }

  const sql = `
    SELECT i.id, i.name, i.brand, i.model, i.color, i.unit, i.status, i.category_id,
           i.need_confirm, i.updated_at,
           c.name AS category_name, c.icon AS category_icon,
           (SELECT GROUP_CONCAT(t.name, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id) AS tag_text,
           (${scoreParts}
             + CASE WHEN i.name = @exact THEN 1000 ELSE 0 END
             + CASE WHEN i.name LIKE @exactPrefix THEN 500 ELSE 0 END
           ) AS score
      FROM items i
      LEFT JOIN categories c ON c.id = i.category_id
     WHERE i.family_id = @familyId
       AND (${clauses.join(' OR ')})
       ${placeSql}
     ORDER BY score DESC, i.updated_at DESC
     LIMIT @limit`;

  const stmt = getDb().prepare(sql);
  if (placeFilter) {
    const { spaceIds = [], locationIds = [] } = placeFilter;
    const ids = [...spaceIds, ...locationIds].filter((n) => Number.isInteger(n));
    return stmt.all({ ...params }, ...ids, ...ids);
  }
  return stmt.all(params);
}

/**
 * 只按位置找东西（用户输入的全是位置词，比如就搜了个「书房」）。
 * 命中的不是「名字带书房的物品」，而是「书房里那些盒子里的东西」。
 */
export function searchItemsByPlace(familyId, placeFilter, limit = 50) {
  const { spaceIds = [], locationIds = [] } = placeFilter || {};
  const ids = [...spaceIds, ...locationIds].filter((n) => Number.isInteger(n));
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');

  return getDb()
    .prepare(
      `SELECT DISTINCT i.id, i.name, i.brand, i.model, i.unit, i.status, i.category_id,
              i.need_confirm, i.updated_at,
              c.name AS category_name, c.icon AS category_icon,
              (SELECT GROUP_CONCAT(t.name, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id) AS tag_text,
              0 AS score
         FROM items i
         LEFT JOIN categories c ON c.id = i.category_id
         JOIN stock s2  ON s2.item_id = i.id AND s2.container_id IS NOT NULL
         JOIN containers c2 ON c2.id = s2.container_id
        WHERE i.family_id = ?
          AND (c2.space_id IN (${ph}) OR c2.location_id IN (${ph}))
        ORDER BY i.updated_at DESC
        LIMIT ?`
    )
    .all(familyId, ...ids, ...ids, limit);
}

/** 家里所有空间与区域的名字 —— 用来判断用户输入里哪些词是在说位置 */
export function listPlaceNames(familyId) {
  const db = getDb();
  const spaces = db
    .prepare('SELECT id, name FROM spaces WHERE family_id = ? AND name <> ""')
    .all(familyId)
    .map((s) => ({ type: 'space', id: s.id, name: s.name }));
  const locations = db
    .prepare('SELECT id, name FROM locations WHERE family_id = ? AND name <> ""')
    .all(familyId)
    .map((l) => ({ type: 'location', id: l.id, name: l.name }));
  // 长的排前面：「柜子A」要先于「柜子」被匹配掉，否则会先吃掉「柜子」留下「A」
  return [...spaces, ...locations].sort((a, b) => b.name.length - a.name.length);
}

/** 按分类检索 */
export function searchItemsByCategory(familyId, categoryId, limit = 50) {
  return getDb()
    .prepare(
      `SELECT i.id, i.name, i.brand, i.model, i.status, i.category_id,
              c.name AS category_name, c.icon AS category_icon
         FROM items i
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE i.family_id = ? AND i.category_id = ?
        ORDER BY i.updated_at DESC
        LIMIT ?`
    )
    .all(familyId, categoryId, limit);
}

/** 按标签名检索 */
export function searchItemsByTag(familyId, tagName, limit = 50) {
  return getDb()
    .prepare(
      `SELECT DISTINCT i.id, i.name, i.brand, i.model, i.status, i.category_id,
              c.name AS category_name, c.icon AS category_icon
         FROM items i
         JOIN item_tags it ON it.item_id = i.id
         JOIN tags t       ON t.id = it.tag_id
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE i.family_id = ? AND t.name LIKE ?
        ORDER BY i.updated_at DESC
        LIMIT ?`
    )
    .all(familyId, `%${tagName}%`, limit);
}

/** 分类名模糊检索（搜「电池」时把同名分类也带出来） */
export function searchCategories(familyId, keyword, limit = 10) {
  return getDb()
    .prepare(
      `SELECT id, name, icon FROM categories
        WHERE family_id = @familyId AND name LIKE @like
        ORDER BY sort_order LIMIT @limit`
    )
    .all({ familyId, like: `%${keyword}%`, limit });
}

/** 标签名模糊检索 */
export function searchTags(familyId, keyword, limit = 10) {
  return getDb()
    .prepare(
      `SELECT id, name, color FROM tags
        WHERE family_id = @familyId AND name LIKE @like
        ORDER BY name LIMIT @limit`
    )
    .all({ familyId, like: `%${keyword}%`, limit });
}

/** 盒子检索（搜位置名时把盒子也带出来） */
export function searchContainers(familyId, keyword, limit = 10) {
  return getDb()
    .prepare(
      `SELECT c.id, c.code, c.name, c.full_path
         FROM containers c
        WHERE c.family_id = @familyId
          AND (c.name LIKE @like OR c.code LIKE @like OR c.full_path LIKE @like)
        ORDER BY c.sort_order
        LIMIT @limit`
    )
    .all({ familyId, like: `%${keyword}%`, limit });
}
