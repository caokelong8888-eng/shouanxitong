import { getDb } from '../connection.js';

/**
 * 容器 / 收纳盒仓储。
 * 关键点：盒子是唯一可挂物品的物理终点；盒子位置变化不需要动物品数据。
 */

const BASE_SELECT = `
  SELECT c.*,
         s.name  AS space_name,
         l.name  AS location_name,
         (SELECT COUNT(*) FROM stock st WHERE st.container_id = c.id) AS item_kind_count,
         (SELECT COALESCE(SUM(st.quantity), 0) FROM stock st WHERE st.container_id = c.id) AS item_total_qty,
         COALESCE(
           (SELECT i.thumb_url FROM item_images i WHERE i.id = c.cover_image_id),
           (SELECT COALESCE(i.thumb_url, i.url) FROM item_images i
             WHERE i.container_id = c.id
             ORDER BY i.id DESC LIMIT 1)
         ) AS cover_thumb_url,
         COALESCE(
           (SELECT i.url FROM item_images i WHERE i.id = c.cover_image_id),
           (SELECT i.url FROM item_images i
             WHERE i.container_id = c.id
             ORDER BY i.id DESC LIMIT 1)
         ) AS cover_url
    FROM containers c
    LEFT JOIN spaces s    ON s.id = c.space_id
    LEFT JOIN locations l ON l.id = c.location_id
`;

export function listContainers(familyId, { locationId = null, spaceId = null, keyword = null } = {}) {
  const where = ['c.family_id = @familyId'];
  const params = { familyId };
  if (locationId) {
    where.push('c.location_id = @locationId');
    params.locationId = locationId;
  }
  if (spaceId) {
    where.push('c.space_id = @spaceId');
    params.spaceId = spaceId;
  }
  if (keyword) {
    where.push('(c.name LIKE @kw OR c.code LIKE @kw OR c.full_path LIKE @kw)');
    params.kw = `%${keyword}%`;
  }
  return getDb()
    .prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.sort_order, c.code`)
    .all(params);
}

export function getContainer(id, familyId) {
  return getDb().prepare(`${BASE_SELECT} WHERE c.id = ? AND c.family_id = ?`).get(id, familyId);
}

export function getContainerByIdRaw(id) {
  return getDb().prepare('SELECT * FROM containers WHERE id = ?').get(id);
}

/** 扫码直达：按 code 查盒子（code 全局唯一） */
export function getContainerByCode(code) {
  return getDb().prepare(`${BASE_SELECT} WHERE c.code = ?`).get(code);
}

export function createContainer(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO containers (family_id, space_id, location_id, code, name, detail, note, full_path, sort_order, created_by, updated_by)
       VALUES (@family_id, @space_id, @location_id, @code, @name, @detail, @note, @full_path, @sort_order, @created_by, @updated_by)`
    )
    .run({
      family_id: data.familyId,
      space_id: data.spaceId ?? null,
      location_id: data.locationId ?? null,
      code: data.code,
      name: data.name,
      detail: data.detail ?? null,
      note: data.note ?? null,
      full_path: data.fullPath ?? null,
      sort_order: data.sortOrder ?? 0,
      created_by: data.userId ?? null,
      updated_by: data.userId ?? null,
    });
  return getContainer(info.lastInsertRowid, data.familyId);
}

export function updateContainer(id, familyId, patch) {
  const fields = [];
  const params = { id, familyId };
  for (const [key, col] of [
    ['spaceId', 'space_id'],
    ['locationId', 'location_id'],
    ['code', 'code'],
    ['name', 'name'],
    ['detail', 'detail'],
    ['note', 'note'],
    ['fullPath', 'full_path'],
    ['coverImageId', 'cover_image_id'],
    ['qrcodePath', 'qrcode_path'],
    ['sortOrder', 'sort_order'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (!fields.length) return getContainer(id, familyId);
  fields.push("updated_at = datetime('now','localtime')");
  if (patch.userId !== undefined) {
    fields.push('updated_by = @userId');
    params.userId = patch.userId;
  }
  getDb()
    .prepare(`UPDATE containers SET ${fields.join(', ')} WHERE id = @id AND family_id = @familyId`)
    .run(params);
  return getContainer(id, familyId);
}

/** 仅更新 full_path（批量重算路径时用，避免触发 updated_at 抖动） */
export function updateContainerPath(id, fullPath) {
  return getDb().prepare('UPDATE containers SET full_path = ? WHERE id = ?').run(fullPath, id);
}

export function deleteContainer(id, familyId) {
  return getDb().prepare('DELETE FROM containers WHERE id = ? AND family_id = ?').run(id, familyId);
}

export function countStockInContainer(id) {
  return getDb().prepare('SELECT COUNT(*) AS c FROM stock WHERE container_id = ?').get(id).c;
}

/** 统计该家庭下已有的最大盒号，用于自动生成下一个编号 */
export function listAllCodes(familyId) {
  return getDb()
    .prepare('SELECT code FROM containers WHERE family_id = ?')
    .all(familyId)
    .map((r) => r.code);
}

/** 全部盒子（重算路径时用） */
export function listContainersForPath(familyId) {
  return getDb()
    .prepare(
      `SELECT c.id, c.code, c.name, c.detail, c.space_id, c.location_id,
              s.name AS space_name, l.name AS location_name
         FROM containers c
         LEFT JOIN spaces s    ON s.id = c.space_id
         LEFT JOIN locations l ON l.id = c.location_id
        WHERE c.family_id = ?`
    )
    .all(familyId);
}
