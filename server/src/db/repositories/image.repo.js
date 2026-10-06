import { getDb } from '../connection.js';

/** 图片仓储（物品照 + 盒子照共用一张表） */

export function createImage(data) {
  const info = getDb()
    .prepare(
      `INSERT INTO item_images (item_id, container_id, original_path, thumb_path, url, thumb_url,
                                storage_driver, width, height, mime, size, sort_order)
       VALUES (@item_id, @container_id, @original_path, @thumb_path, @url, @thumb_url,
               @storage_driver, @width, @height, @mime, @size, @sort_order)`
    )
    .run({
      item_id: data.itemId ?? null,
      container_id: data.containerId ?? null,
      original_path: data.originalPath,
      thumb_path: data.thumbPath ?? null,
      url: data.url ?? null,
      thumb_url: data.thumbUrl ?? null,
      storage_driver: data.storageDriver ?? 'local',
      width: data.width ?? null,
      height: data.height ?? null,
      mime: data.mime ?? null,
      size: data.size ?? null,
      sort_order: data.sortOrder ?? 0,
    });
  return getImage(info.lastInsertRowid);
}

export function getImage(id) {
  return getDb().prepare('SELECT * FROM item_images WHERE id = ?').get(id);
}

export function getImagesByIds(ids = []) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return getDb().prepare(`SELECT * FROM item_images WHERE id IN (${ph})`).all(...ids);
}

export function listImagesByItem(itemId) {
  return getDb()
    .prepare('SELECT * FROM item_images WHERE item_id = ? ORDER BY sort_order, id')
    .all(itemId);
}

export function listImagesByContainer(containerId) {
  return getDb()
    .prepare('SELECT * FROM item_images WHERE container_id = ? ORDER BY sort_order, id')
    .all(containerId);
}

/**
 * 盒子的完整照片墙。
 * 盒子里物品的照片也属于「这个盒子里的东西长什么样」，
 * 所以一并带出来（标记来源，前端可区分显示）。
 * 这样用户打开盒子时首屏就能看到实际内容，而不是只有一张盒子外壳照。
 */
export function listContainerPhotoWall(containerId) {
  return getDb()
    .prepare(
      `SELECT img.*,
              CASE WHEN img.container_id IS NOT NULL THEN 'container' ELSE 'item' END AS source,
              i.name AS item_name,
              i.unit AS item_unit,
              st.quantity AS item_quantity
         FROM item_images img
         LEFT JOIN items i ON i.id = img.item_id
         LEFT JOIN stock st ON st.item_id = i.id AND st.container_id = @containerId
        WHERE img.container_id = @containerId
           OR (img.item_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM stock s2 WHERE s2.item_id = img.item_id AND s2.container_id = @containerId))
        ORDER BY (img.container_id IS NULL), img.sort_order, img.id`
    )
    .all({ containerId });
}

export function listUnassignedImages() {
  return getDb()
    .prepare('SELECT * FROM item_images WHERE item_id IS NULL AND container_id IS NULL ORDER BY id DESC')
    .all();
}

/** 批量绑定图片到物品（连拍批量入库时用） */
export function bindImagesToItem(imageIds = [], itemId, coverId = null) {
  if (!imageIds.length) return 0;
  const db = getDb();
  const stmt = db.prepare('UPDATE item_images SET item_id = ? WHERE id = ?');
  const run = db.transaction(() => {
    let n = 0;
    imageIds.forEach((id, idx) => {
      n += stmt.run(itemId, id).changes;
      db.prepare('UPDATE item_images SET sort_order = ? WHERE id = ?').run(idx, id);
    });
    if (coverId) db.prepare('UPDATE items SET cover_image_id = ? WHERE id = ?').run(coverId, itemId);
    return n;
  });
  return run();
}

export function bindImagesToContainer(imageIds = [], containerId, coverId = null) {
  if (!imageIds.length) return 0;
  const db = getDb();
  const stmt = db.prepare('UPDATE item_images SET container_id = ? WHERE id = ?');
  const run = db.transaction(() => {
    let n = 0;
    imageIds.forEach((id, idx) => {
      n += stmt.run(containerId, id).changes;
      db.prepare('UPDATE item_images SET sort_order = ? WHERE id = ?').run(idx, id);
    });
    if (coverId) db.prepare('UPDATE containers SET cover_image_id = ? WHERE id = ?').run(coverId, containerId);
    return n;
  });
  return run();
}

export function deleteImage(id) {
  return getDb().prepare('DELETE FROM item_images WHERE id = ?').run(id);
}

/** 某物品的封面图：优先 cover_image_id，否则取第一张 */
export function getCoverImageForItem(itemId) {
  const item = getDb().prepare('SELECT cover_image_id FROM items WHERE id = ?').get(itemId);
  if (item?.cover_image_id) {
    const img = getImage(item.cover_image_id);
    if (img) return img;
  }
  return getDb()
    .prepare('SELECT * FROM item_images WHERE item_id = ? ORDER BY sort_order, id LIMIT 1')
    .get(itemId);
}
