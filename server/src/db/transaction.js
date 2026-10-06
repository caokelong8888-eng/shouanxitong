import { getDb } from './connection.js';

/**
 * 事务工具。
 * 批量入库这类「多步骤要么全成、要么全不成」的操作必须包在事务里，
 * 否则中途失败会留下半条数据（物品建了但没进盒子）。
 */

/** 把同步函数包成事务执行 */
export function inTransaction(fn) {
  return getDb().transaction(fn)();
}

/** 手动事务（异步场景用，better-sqlite3 的同步事务无法包裹 await） */
export function runInTransaction(steps) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = steps();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚失败就算了，原始错误更重要 */
    }
    throw err;
  }
}
