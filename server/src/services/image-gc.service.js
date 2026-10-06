import fs from 'node:fs';
import path from 'node:path';
import { getStorage } from '../adapters/storage/index.js';
import { getDb } from '../db/connection.js';
import { config } from '../config/index.js';

/**
 * 图片文件回收。
 *
 * 【为什么需要这个文件】
 * item_images 表的 item_id / container_id 都带 ON DELETE CASCADE，
 * 所以删物品 / 删盒子时，数据库行会被 SQLite 自动清掉 —— 干净。
 * 但图片文件在磁盘上，不会跟着消失。
 *
 * 结果就是：删一件东西，数据库里查不到了，磁盘上那张照片却永远留着。
 * 实测过一天开发测试就攒了 46 个这种孤儿文件，磁盘 58 个文件里只有 12 个有效。
 * 而磁盘满了 SQLite 就写不进去，那才是真正的数据丢失。
 *
 * 【铁律】
 *   路径必须在删除之前收集好。删完之后再查就什么都查不到了（行已经没了）。
 *   删文件失败绝对不能影响删除结果 —— 用户说「删掉」就必须删掉，
 *   文件残留只是占点磁盘，下次清理任务会再收一次。
 */

/** 从一行图片记录里取出该删的磁盘路径 */
function pathsOf(row) {
  return [row?.original_path, row?.thumb_path].filter(Boolean);
}

/**
 * 删掉一批图片记录对应的磁盘文件。
 * @param {Array<{original_path?:string, thumb_path?:string}>} rows
 * @returns {{removed:number, failed:number}} 只用于记日志
 */
export async function removeFilesForImages(rows) {
  if (!rows?.length) return { removed: 0, failed: 0 };
  const storage = getStorage();
  let removed = 0;
  let failed = 0;

  for (const rel of rows.flatMap(pathsOf)) {
    try {
      // local 适配器是同步的、COS 是异步的，await 两者都吃得下
      await storage.remove(rel);
      removed += 1;
    } catch (err) {
      // 文件本来就不存在也算成功（幂等），其他错误只记不抛
      if (!/ENOENT|no such file/i.test(String(err?.message || ''))) {
        failed += 1;
        console.warn('[image-gc] 删除文件失败:', rel, err.message);
      } else {
        removed += 1;
      }
    }
  }
  return { removed, failed };
}

/** 删物品前调用：拿它名下所有图片的路径 */
export function collectImageRowsOfItem(itemId) {
  return getDb()
    .prepare('SELECT original_path, thumb_path FROM item_images WHERE item_id = ?')
    .all(itemId);
}

/** 删盒子前调用：只拿盒子自己的照片（不含里面物品的照片 —— 那些属于物品，物品还在） */
export function collectImageRowsOfContainer(containerId) {
  return getDb()
    .prepare('SELECT original_path, thumb_path FROM item_images WHERE container_id = ?')
    .all(containerId);
}

/**
 * 孤儿文件清理 —— 每天跑一次。
 *
 * 两种来源：
 *   1. 上传了但一直没入库的图片（用户拍完照就退出了那条路）
 *      → 数据库里 item_id 和 container_id 都是 NULL，超过 N 小时就是没人要的
 *   2. 磁盘上根本没有对应数据库行的文件
 *      → 修复本机制之前的历史遗留，以及任何异常退出的残留
 *
 * 阈值取 24 小时：足够覆盖「用户中午拍，晚上才想起来入库」，
 * 又不会让正在连拍中的照片（正在识别、还没绑物品）被误删。
 */
export async function sweepOrphanFiles({ minAgeHours = 24, now = Date.now() } = {}) {
  const db = getDb();
  const storage = getStorage();
  const cutoff = now - minAgeHours * 3600 * 1000;
  let rowsDeleted = 0;
  let filesRemoved = 0;

  // ---- 1. 数据库里无主的图片记录 ----
  // created_at 是 'YYYY-MM-DD HH:mm:ss' 本地时间，SQLite 的 datetime() 按 UTC 解析，
  // 这里不跟它比字符串，直接取回来在 JS 里换算，避免时区把边界算错。
  const stale = db
    .prepare('SELECT id, original_path, thumb_path, created_at FROM item_images WHERE item_id IS NULL AND container_id IS NULL')
    .all();

  for (const row of stale) {
    const t = new Date(String(row.created_at).replace(/-/g, '/')).getTime();
    if (Number.isFinite(t) && t > cutoff) continue; // 还很新，可能正在识别中
    await removeFilesForImages([row]);
    db.prepare('DELETE FROM item_images WHERE id = ?').run(row.id);
    rowsDeleted += 1;
    filesRemoved += 2;
  }

  // ---- 2. 磁盘上已经没有数据库行的文件 ----
  // 只有本地存储能这么扫；COS 上的对象没有对应的本地文件概念。
  if (storage.driver !== 'local') return { rowsDeleted, filesRemoved, scanned: 0 };

  const referenced = new Set();
  for (const r of db.prepare('SELECT original_path, thumb_path FROM item_images').all()) {
    for (const p of pathsOf(r)) referenced.add(p);
  }

  const root = path.resolve(config.storage.localRoot);
  let scanned = 0;
  let loose = 0;

  for (const sub of ['original', 'thumb']) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      scanned += 1;
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (referenced.has(rel)) continue;
      try {
        // 同样按修改时间兜底：刚写进来的文件可能数据库事务还没提交
        if (fs.statSync(file).mtimeMs > cutoff) continue;
        fs.unlinkSync(file);
        filesRemoved += 1;
        loose += 1;
      } catch (err) {
        console.warn('[image-gc] 清理孤儿文件失败:', rel, err.message);
      }
    }
  }

  return { rowsDeleted, filesRemoved, scanned, loose };
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
