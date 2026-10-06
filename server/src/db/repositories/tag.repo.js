import { getDb } from '../connection.js';

/** 标签仓储 + 物品-标签关联 */

export function listTags(familyId) {
  return getDb()
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM item_tags it WHERE it.tag_id = t.id) AS item_count
         FROM tags t
        WHERE t.family_id = ?
        ORDER BY t.name`
    )
    .all(familyId);
}

export function findTagByName(familyId, name) {
  return getDb().prepare('SELECT * FROM tags WHERE family_id = ? AND name = ? LIMIT 1').get(familyId, name);
}

export function createTag(data) {
  const info = getDb()
    .prepare('INSERT INTO tags (family_id, name, color) VALUES (@family_id, @name, @color)')
    .run({ family_id: data.familyId, name: data.name, color: data.color ?? null });
  return getDb().prepare('SELECT * FROM tags WHERE id = ?').get(info.lastInsertRowid);
}

export function ensureTag(familyId, name, color = null) {
  if (!name) return null;
  const found = findTagByName(familyId, name);
  if (found) return found;
  return createTag({ familyId, name, color });
}

export function deleteTag(id, familyId) {
  return getDb().prepare('DELETE FROM tags WHERE id = ? AND family_id = ?').run(id, familyId);
}

/** 覆盖式设置物品标签（传名称数组，自动建标签） */
export function setItemTags(itemId, familyId, tagNames = []) {
  const db = getDb();
  const clean = [...new Set(tagNames.map((t) => String(t).trim()).filter(Boolean))];
  const run = db.transaction(() => {
    db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId);
    for (const name of clean) {
      const tag = ensureTag(familyId, name);
      db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tag.id);
    }
  });
  run();
  return listItemTags(itemId);
}

export function listItemTags(itemId) {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.color
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
        WHERE it.item_id = ?
        ORDER BY t.name`
    )
    .all(itemId);
}

/** 批量取多个物品的标签，避免列表页 N+1 查询 */
export function listTagsForItems(itemIds = []) {
  if (!itemIds.length) return {};
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT it.item_id, t.id, t.name, t.color
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
        WHERE it.item_id IN (${placeholders})
        ORDER BY t.name`
    )
    .all(...itemIds);
  const map = {};
  for (const r of rows) {
    (map[r.item_id] ||= []).push({ id: r.id, name: r.name, color: r.color });
  }
  return map;
}
