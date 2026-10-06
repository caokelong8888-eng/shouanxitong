import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './connection.js';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 极简迁移器。
 * - 扫描 migrations 目录下的 *.sql，按文件名排序依次执行
 * - 已执行过的记录在 schema_migrations 表，不会重复执行
 * - 每个文件在事务中执行，失败自动回滚
 */

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

function appliedVersions(db) {
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
}

export function runMigrations() {
  const db = getDb();
  ensureMigrationTable(db);

  const dir = config.migrationsDir || __dirname + '/migrations';
  if (!fs.existsSync(dir)) {
    throw new Error(`迁移目录不存在: ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const done = appliedVersions(db);
  const results = [];

  for (const file of files) {
    if (done.has(file)) {
      results.push({ file, status: 'skip' });
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
    });
    try {
      run();
      results.push({ file, status: 'applied' });
    } catch (err) {
      results.push({ file, status: 'failed', error: err.message });
      throw new Error(`迁移 ${file} 执行失败: ${err.message}`);
    }
  }
  return results;
}

/** 直接执行：node src/db/migrate.js */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const results = runMigrations();
    for (const r of results) {
      const mark = r.status === 'applied' ? '✅ 已执行' : r.status === 'skip' ? '⏭  已存在' : '❌ 失败';
      console.log(`${mark}  ${r.file}`);
    }
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((t) => t.name);
    console.log(`\n📦 数据库: ${config.dbPath}`);
    console.log(`📋 共 ${tables.length} 张表: ${tables.join(', ')}`);
    closeDb();
  } catch (err) {
    console.error('迁移失败:', err.message);
    process.exit(1);
  }
}
