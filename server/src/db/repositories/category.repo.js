import { getDb } from '../connection.js';

/** 分类仓储（支持父子层级） */

const BASE_SELECT = `
  SELECT c.*,
         p.name AS parent_name,
         (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
`;

export function listCategories(familyId) {
  return getDb()
    .prepare(`${BASE_SELECT} WHERE c.family_id = ? ORDER BY c.sort_order, c.id`)
    .all(familyId);
}

export function getCategory(id, familyId) {
  return getDb().prepare(`${BASE_SELECT} WHERE c.id = ? AND c.family_id = ?`).get(id, familyId);
}

export function findCategoryByName(familyId, name) {
  return getDb()
    .prepare('SELECT * FROM categories WHERE family_id = ? AND name = ? LIMIT 1')
    .get(familyId, name);
}

export function createCategory(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO categories (family_id, name, parent_id, icon, sort_order)
       VALUES (@family_id, @name, @parent_id, @icon, @sort_order)`
    )
    .run({
      family_id: data.familyId,
      name: data.name,
      parent_id: data.parentId ?? null,
      icon: data.icon ?? null,
      sort_order: data.sortOrder ?? 0,
    });
  return getCategory(info.lastInsertRowid, data.familyId);
}

/** AI 识别后按名称取分类，没有就新建（AI 辅助录入的关键一环） */
export function ensureCategory(familyId, name, icon = null) {
  if (!name) return null;
  const found = findCategoryByName(familyId, name);
  if (found) return found;
  return createCategory({ familyId, name, icon, sortOrder: 50 });
}

export function updateCategory(id, familyId, patch) {
  const fields = [];
  const params = { id, familyId };
  for (const [key, col] of [
    ['name', 'name'],
    ['parentId', 'parent_id'],
    ['icon', 'icon'],
    ['sortOrder', 'sort_order'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (!fields.length) return getCategory(id, familyId);
  getDb()
    .prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = @id AND family_id = @familyId`)
    .run(params);
  return getCategory(id, familyId);
}

export function deleteCategory(id, familyId) {
  return getDb().prepare('DELETE FROM categories WHERE id = ? AND family_id = ?').run(id, familyId);
}

export function countItemsInCategory(id) {
  return getDb().prepare('SELECT COUNT(*) AS c FROM items WHERE category_id = ?').get(id).c;
}
