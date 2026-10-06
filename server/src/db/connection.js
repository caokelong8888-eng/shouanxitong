import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';

let db = null;

/** 确保数据库所在目录存在 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * 获取数据库单例。
 * SQLite 配置说明：
 *  - WAL 模式：读写并发更好，手机端并发请求不会互相阻塞
 *  - foreign_keys=ON：SQLite 默认关闭外键约束，必须显式打开
 */
export function getDb() {
  if (db) return db;
  ensureDir(config.dbPath);
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** 关闭数据库（脚本收尾用） */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/** 事务包装，仓储层写多表时用 */
export function transaction(fn) {
  return getDb().transaction(fn);
}
