import { getDb } from '../connection.js';

/**
 * 库存仓储 —— 「同一物品可存在多个位置」的核心实现。
 *
 * 模型说明：
 *   item  = 物品规格（AA电池）
 *   stock = 该物品在某个容器里的存量（盒子02: 8节、盒子08: 12节）
 *
 * container_id 允许为 NULL，表示「不在任何盒子里」（在家使用 / 借出 / 在车里）。
 * 注意：SQLite 的 UNIQUE 约束对 NULL 不生效，所以建了部分唯一索引
 *       uq_stock_item_container ... WHERE container_id IS NOT NULL，
 *       而 NULL 场景由 upsertLoose() 在应用层查重兜底。
 */

const BASE_SELECT = `
  SELECT st.*,
         c.code AS container_code,
         c.name AS container_name,
         c.full_path,
         i.name AS item_name,
         i.unit
    FROM stock st
    LEFT JOIN containers c ON c.id = st.container_id
    LEFT JOIN items i      ON i.id = st.item_id
`;

export function listStockByItem(itemId) {
  return getDb()
    .prepare(`${BASE_SELECT} WHERE st.item_id = ? ORDER BY (st.container_id IS NULL), c.sort_order, st.id`)
    .all(itemId);
}

export function listStockByContainer(containerId) {
  return getDb()
    .prepare(
      `SELECT st.*, i.name AS item_name, i.unit, i.category_id, i.status AS item_status, i.cover_image_id,
              cat.name AS category_name, cat.icon AS category_icon,
              COALESCE(
                (SELECT im.thumb_url FROM item_images im WHERE im.id = i.cover_image_id),
                (SELECT COALESCE(im.thumb_url, im.url) FROM item_images im
                  WHERE im.item_id = i.id ORDER BY im.sort_order, im.id LIMIT 1)
              ) AS cover_thumb_url,
              COALESCE(
                (SELECT im.url FROM item_images im WHERE im.id = i.cover_image_id),
                (SELECT im.url FROM item_images im
                  WHERE im.item_id = i.id ORDER BY im.sort_order, im.id LIMIT 1)
              ) AS cover_url
         FROM stock st
         JOIN items i ON i.id = st.item_id
         LEFT JOIN categories cat ON cat.id = i.category_id
        WHERE st.container_id = ?
        ORDER BY cat.sort_order, i.name`
    )
    .all(containerId);
}

export function getStock(id) {
  return getDb().prepare(`${BASE_SELECT} WHERE st.id = ?`).get(id);
}

export function findStock(itemId, containerId) {
  if (containerId === null || containerId === undefined) {
    // NULL 场景：应用层兜底查重（部分唯一索引管不到 NULL）
    return getDb()
      .prepare(`${BASE_SELECT} WHERE st.item_id = ? AND st.container_id IS NULL LIMIT 1`)
      .get(itemId);
  }
  return getDb().prepare(`${BASE_SELECT} WHERE st.item_id = ? AND st.container_id = ?`).get(itemId, containerId);
}

export function createStock(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO stock (item_id, container_id, quantity, status, note)
       VALUES (@item_id, @container_id, @quantity, @status, @note)`
    )
    .run({
      item_id: data.itemId,
      container_id: data.containerId ?? null,
      quantity: data.quantity ?? 1,
      status: data.status ?? 'in_box',
      note: data.note ?? null,
    });
  return getStock(info.lastInsertRowid);
}

/**
 * 新增或累加库存。
 * 同一物品放进同一个盒子时，默认把数量累加而不是新建一条记录，
 * 避免出现「盒子03 里有两条 HDMI线」这种脏数据。
 */
export function upsertStock(data) {
  const existing = findStock(data.itemId, data.containerId ?? null);
  if (existing) {
    return updateStock(existing.id, {
      quantity: Number(existing.quantity) + Number(data.quantity ?? 1),
      status: data.status ?? existing.status,
      note: data.note ?? existing.note,
    });
  }
  return createStock(data);
}

export function updateStock(id, patch) {
  const fields = [];
  const params = { id };
  for (const [key, col] of [
    ['quantity', 'quantity'],
    ['status', 'status'],
    ['note', 'note'],
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (patch.containerId !== undefined) {
    fields.push('container_id = @containerId');
    params.containerId = patch.containerId;
  }
  if (!fields.length) return getStock(id);
  fields.push("updated_at = datetime('now','localtime')");
  getDb().prepare(`UPDATE stock SET ${fields.join(', ')} WHERE id = @id`).run(params);
  return getStock(id);
}

export function deleteStock(id) {
  return getDb().prepare('DELETE FROM stock WHERE id = ?').run(id);
}

export function deleteStockByItem(itemId) {
  return getDb().prepare('DELETE FROM stock WHERE item_id = ?').run(itemId);
}

/** 统计：某物品总共有多少存量 */
export function totalQuantityOfItem(itemId) {
  return (
    getDb().prepare('SELECT COALESCE(SUM(quantity), 0) AS t FROM stock WHERE item_id = ?').get(itemId).t || 0
  );
}
