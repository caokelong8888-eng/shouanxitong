import { getDb } from '../connection.js';

/**
 * 区域 / 家具仓储。
 * 与空间的差别：locations 可以有空间（挂靠关系），也可以独立存在。
 */

const SELECT_WITH_JOIN = `
  SELECT l.*,
         s.name AS space_name,
         (SELECT COUNT(*) FROM containers c WHERE c.location_id = l.id) AS container_count
    FROM locations l
    LEFT JOIN spaces s ON s.id = l.space_id
`;

export function listLocations(familyId, spaceId = null) {
  const db = getDb();
  if (spaceId) {
    return db
      .prepare(`${SELECT_WITH_JOIN} WHERE l.family_id = ? AND l.space_id = ? ORDER BY l.sort_order, l.id`)
      .all(familyId, spaceId);
  }
  return db.prepare(`${SELECT_WITH_JOIN} WHERE l.family_id = ? ORDER BY l.sort_order, l.id`).all(familyId);
}

export function getLocation(id, familyId) {
  return getDb().prepare(`${SELECT_WITH_JOIN} WHERE l.id = ? AND l.family_id = ?`).get(id, familyId);
}

export function createLocation(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO locations (family_id, space_id, name, note, sort_order)
       VALUES (@family_id, @space_id, @name, @note, @sort_order)`
    )
    .run({
      family_id: data.familyId,
      space_id: data.spaceId ?? null,
      name: data.name,
      note: data.note ?? null,
      sort_order: data.sortOrder ?? 0,
    });
  return getLocation(info.lastInsertRowid, data.familyId);
}

export function updateLocation(id, familyId, patch) {
  const fields = [];
  const params = { id, familyId };
  for (const [key, col] of [
    ['name', 'name'],
    ['spaceId', 'space_id'],
    ['note', 'note'],
    ['sortOrder', 'sort_order'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (!fields.length) return getLocation(id, familyId);
  fields.push("updated_at = datetime('now','localtime')");
  getDb()
    .prepare(`UPDATE locations SET ${fields.join(', ')} WHERE id = @id AND family_id = @familyId`)
    .run(params);
  return getLocation(id, familyId);
}

export function deleteLocation(id, familyId) {
  return getDb().prepare('DELETE FROM locations WHERE id = ? AND family_id = ?').run(id, familyId);
}

/** 用于重算 full_path：取出某区域下的所有盒子 */
export function listContainersInLocation(locationId) {
  return getDb().prepare('SELECT id, code, name, detail FROM containers WHERE location_id = ?').all(locationId);
}
