import { config } from '../config/index.js';
import { sweepOrphanFiles } from '../services/image-gc.service.js';

/**
 * 孤儿图片清理定时器。
 *
 * 【为什么必须有】
 * 照片存在磁盘上，删除物品时靠数据库级联清记录、清不掉文件。
 * 加上「拍完照没入库就退出」这条路径，一天下来能攒不少垃圾。
 * 而磁盘是有限的 —— 满了 SQLite 就写不进去，那才是真正的数据丢失。
 *
 * 【安全边界】
 * 只删两种东西：
 *   1. 数据库里无主（item_id 和 container_id 都是 NULL）且超过 N 小时的图片记录 + 文件
 *   2. 磁盘上完全没有对应数据库行、且文件修改时间超过 N 小时的文件
 * 正在连拍 / 正在识别的照片都是刚写入的，mtime 很新，绝不会被误删。
 */

let timer = null;
let bootTimer = null;

async function runOnce(reason) {
  try {
    const r = await sweepOrphanFiles({ minAgeHours: config.imageGc.minAgeHours });
    if (r.rowsDeleted || r.loose) {
      console.log(
        `🧹 [image-gc] ${reason}：清理无主图片记录 ${r.rowsDeleted} 条、` +
          `无主文件 ${r.loose} 个（共扫描 ${r.scanned} 个文件）`
      );
    } else {
      console.log(`🧹 [image-gc] ${reason}：无需清理（扫描 ${r.scanned} 个文件）`);
    }
  } catch (err) {
    // 清理失败绝不能影响服务，只记日志
    console.warn('[image-gc] 清理失败:', err.message);
  }
}

export function startImageGc() {
  if (!config.imageGc.enabled) {
    console.log('  🧹 图片清理  已关闭（IMAGE_GC_ENABLED=false）');
    return;
  }
  // 错开启动时间：服务刚起来时磁盘 IO 最忙，而且可能有连拍正在进行
  bootTimer = setTimeout(() => {
    runOnce('启动后首轮');
    timer = setInterval(() => runOnce('每日巡检'), config.imageGc.intervalMs);
    timer.unref?.();
  }, config.imageGc.runAfterBootMs);
  bootTimer.unref?.();

  console.log(
    `  🧹 图片清理  每 ${Math.round(config.imageGc.intervalMs / 3600000)} 小时一次，` +
      `超过 ${config.imageGc.minAgeHours} 小时的孤儿文件会被回收`
  );
}

/** 手动触发一次（供 /api/admin/sweep-images 调试用） */
export async function sweepNow() {
  return sweepOrphanFiles({ minAgeHours: config.imageGc.minAgeHours });
}
