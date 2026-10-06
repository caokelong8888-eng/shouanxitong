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
