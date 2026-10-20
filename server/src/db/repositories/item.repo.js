import { getDb } from '../connection.js';

/**
 * 物品仓储（规格层）。
 * 【铁律】此层不写 quantity，不写 container_id —— 数量与位置一律走 stock.repo.js
 */

const BASE_SELECT = `
  SELECT i.*,
         c.name  AS category_name,
         c.icon  AS category_icon,
         (SELECT COALESCE(SUM(st.quantity), 0) FROM stock st WHERE st.item_id = i.id) AS total_quantity,
         (SELECT COUNT(*) FROM stock st WHERE st.item_id = i.id) AS stock_count,
         (SELECT COUNT(DISTINCT st.container_id) FROM stock st WHERE st.item_id = i.id AND st.container_id IS NOT NULL) AS container_count
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
`;

export function listItems(familyId, { categoryId = null, status = null, keyword = null, limit = 50, offset = 0 } = {}) {
  const where = ['i.family_id = @familyId'];
  const params = { familyId, limit, offset };
  if (categoryId) {
    where.push('i.category_id = @categoryId');
    params.categoryId = categoryId;
  }
  if (status) {
    where.push('i.status = @status');
    params.status = status;
  }
  if (keyword) {
    where.push('(i.name LIKE @kw OR i.search_text LIKE @kw)');
    params.kw = `%${keyword}%`;
  }
  const rows = getDb()
    .prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.updated_at DESC, i.id DESC LIMIT @limit OFFSET @offset`)
    .all(params);
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM items i WHERE ${where.join(' AND ')}`)
    .get(params).c;
  return { rows, total };
}

export function getItem(id, familyId) {
  return getDb().prepare(`${BASE_SELECT} WHERE i.id = ? AND i.family_id = ?`).get(id, familyId);
}

export function getItemByIdRaw(id) {
  return getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
}

/**
 * 按名字找已存在的物品。
 *
 * 【为什么需要】
 * item 表的语义是「物品规格」——AA电池、HDMI线，**不是**「某一根线」。
 * 同一类东西在家里有 3 根，正确的建模是：1 个 item + 3 条 stock。
 *
 * 但入库时如果每次都 createItem，就会出现 3 个叫「HDMI线」的 item，
 * 搜索出 3 条、盒子详情里也是 3 行 —— 数量还各自是 1。
 * 这正是「同件物品多位置」这个设计想避免的情况。
 *
 * 所以入库前先按名字找一下：找到了就复用（只加库存），
 * 找不到才新建。
 *
 * 匹配规则刻意保守：只比名字（去空白、忽略大小写），
 * 分类不同也照样合并 —— 因为分类是 AI 猜的，本来就可能这次叫「电子配件」
 * 下次叫「线材」，拿它当合并依据反而会漏合。
 *
 * 【去空白必须去掉「中间」的空白，不能只 TRIM】
 * 前端归组用的是 name.toLowerCase().replace(/\s+/g, '')，
 * 会把「USB-C 数据线」和「USB-C数据线」当成同一个。
 * 这里如果只写 LOWER(TRIM(name))，中间那个空格还在，
 * 两边口径就对不上了 —— 同一根线，AI 这次写「USB-C数据线」、
 * 下次写「USB-C 数据线」，就会在库里多出一件重复物品。
 * 所以后端也用同样的规则：把名字里所有空白字符都去掉再比。
 */
export function findItemByName(familyId, name) {
  const key = normalizeItemName(name);
  if (!key) return null;
  return (
    getDb()
      .prepare(
        `SELECT i.*,
                c.name  AS category_name,
                c.icon  AS category_icon
           FROM items i
           LEFT JOIN categories c ON c.id = i.category_id
          WHERE i.family_id = ?
            AND LOWER(REPLACE(REPLACE(REPLACE(TRIM(i.name), ' ', ''), CHAR(9), ''), CHAR(10), '')) = ?
          ORDER BY i.id
          LIMIT 1`
      )
      .get(familyId, key) || null
  );
}

/**
 * 物品名字的归一化 —— 和前端 groupKeyOf 必须完全一致。
 *
 * 规则：去掉所有空白字符 + 转小写。
 * 「USB-C 数据线」「usb-c数据线」「 USB-C数据线 」→「usb-c数据线」
 */
export function normalizeItemName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function createItem(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO items (family_id, name, category_id, description, brand, model, color, unit, status,
                          cover_image_id, ai_confidence, need_confirm, search_text, created_by, updated_by)
       VALUES (@family_id, @name, @category_id, @description, @brand, @model, @color, @unit, @status,
               @cover_image_id, @ai_confidence, @need_confirm, @search_text, @created_by, @updated_by)`
    )
    .run({
      family_id: data.familyId,
      name: data.name,
      category_id: data.categoryId ?? null,
      description: data.description ?? null,
      brand: data.brand ?? null,
      model: data.model ?? null,
      color: data.color ?? null,
      unit: data.unit ?? null,
      status: data.status ?? 'in_box',
      cover_image_id: data.coverImageId ?? null,
      ai_confidence: data.aiConfidence ?? null,
      need_confirm: data.needConfirm ? 1 : 0,
      search_text: data.searchText ?? null,
      created_by: data.userId ?? null,
      updated_by: data.userId ?? null,
    });
  return getItem(info.lastInsertRowid, data.familyId);
}

export function updateItem(id, familyId, patch) {
  const fields = [];
  const params = { id, familyId };
  for (const [key, col] of [
    ['name', 'name'],
    ['categoryId', 'category_id'],
    ['description', 'description'],
    ['brand', 'brand'],
    ['model', 'model'],
    ['color', 'color'],
    ['unit', 'unit'],
    ['status', 'status'],
    ['coverImageId', 'cover_image_id'],
    ['aiConfidence', 'ai_confidence'],
    ['searchText', 'search_text'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (patch.needConfirm !== undefined) {
    fields.push('need_confirm = @needConfirm');
    params.needConfirm = patch.needConfirm ? 1 : 0;
  }
  if (!fields.length) return getItem(id, familyId);
  fields.push("updated_at = datetime('now','localtime')");
  if (patch.userId !== undefined) {
    fields.push('updated_by = @userId');
    params.userId = patch.userId;
  }
  getDb()
    .prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = @id AND family_id = @familyId`)
    .run(params);
  return getItem(id, familyId);
}

export function deleteItem(id, familyId) {
  return getDb().prepare('DELETE FROM items WHERE id = ? AND family_id = ?').run(id, familyId);
}

/** 重建检索字段：名称 + 品牌 + 型号 + 描述 + 标签 */
export function refreshSearchText(itemId) {
  const row = getDb()
    .prepare(
      `SELECT i.id, i.name, i.brand, i.model, i.color, i.description,
              (SELECT GROUP_CONCAT(t.name, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id) AS tag_text
         FROM items i WHERE i.id = ?`
    )
    .get(itemId);
  if (!row) return;
  const text = [row.name, row.brand, row.model, row.color, row.description, row.tag_text]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  getDb().prepare('UPDATE items SET search_text = ? WHERE id = ?').run(text, itemId);
}
