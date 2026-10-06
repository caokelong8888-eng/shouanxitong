import { getDb } from '../connection.js';

/**
 * 空间仓储。
 * 约定：本文件（以及 repositories 目录下所有文件）是唯一允许出现 SQL 的地方，
 * 未来迁移 MySQL 时只改这一层。
 */

export function listSpaces(familyId) {
  return getDb()
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM locations l WHERE l.space_id = s.id) AS location_count,
              (SELECT COUNT(*) FROM containers c WHERE c.space_id = s.id) AS container_count
         FROM spaces s
        WHERE s.family_id = ?
        ORDER BY s.sort_order, s.id`
    )
    .all(familyId);
}

export function getSpace(id, familyId) {
  return getDb().prepare('SELECT * FROM spaces WHERE id = ? AND family_id = ?').get(id, familyId);
}

export function createSpace(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO spaces (family_id, name, icon, sort_order)
       VALUES (@family_id, @name, @icon, @sort_order)`
    )
    .run({
      family_id: data.familyId,
      name: data.name,
      icon: data.icon ?? null,
      sort_order: data.sortOrder ?? 0,
    });
  return getSpace(info.lastInsertRowid, data.familyId);
}

export function updateSpace(id, familyId, patch) {
  const fields = [];
  const params = { id, familyId };
  for (const [key, col] of [
    ['name', 'name'],
    ['icon', 'icon'],
    ['sortOrder', 'sort_order'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (!fields.length) return getSpace(id, familyId);
  fields.push("updated_at = datetime('now','localtime')");
  getDb()
    .prepare(`UPDATE spaces SET ${fields.join(', ')} WHERE id = @id AND family_id = @familyId`)
    .run(params);
  return getSpace(id, familyId);
}

export function deleteSpace(id, familyId) {
  return getDb().prepare('DELETE FROM spaces WHERE id = ? AND family_id = ?').run(id, familyId);
}

/** 该空间下的盒子数量（用于删除前提示） */
export function countContainersInSpace(id) {
  return getDb().prepare('SELECT COUNT(*) AS c FROM containers WHERE space_id = ?').get(id).c;
}
