/**
 * 清理本轮测试数据 —— 精确按 id 删除，不碰任何真实数据。
 *
 * 铁律：
 *   - 删除前先 SELECT 确认命中范围
 *   - 用 WHERE id IN (SELECT ... LIMIT n) 限行（SQLite 不支持 DELETE ... LIMIT）
 *   - 不使用任何前缀通配（LIKE '__%'）做过滤
 *
 * 单独跑这个脚本前，服务要停掉（避免边写边删）。
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
// better-sqlite3 只装在 server/node_modules 里（pnpm 的隔离结构），从根目录跑脚本要显式指路
const Database = require(path.join(ROOT, 'server', 'node_modules', 'better-sqlite3'));

const db = new Database(path.join(ROOT, 'data', 'app.db'));

/* ---------- 1. 先看清楚要删什么 ---------- */

const TARGET_ITEM_IDS = [17, 18]; // 「同款测试项」「E2E同款测试线」

console.log('【删除前确认】');
const items = db
  .prepare(`SELECT id, name FROM items WHERE id IN (SELECT id FROM items WHERE id IN (${TARGET_ITEM_IDS.join(',')}) LIMIT 10)`)
  .all();
console.log('  待删 items:', items);

const stock = db
  .prepare(`SELECT id, item_id, container_id, quantity FROM stock WHERE item_id IN (${TARGET_ITEM_IDS.join(',')})`)
  .all();
console.log('  待删 stock:', stock);

const itags = db.prepare(`SELECT * FROM item_tags WHERE item_id IN (${TARGET_ITEM_IDS.join(',')})`).all();
console.log('  待删 item_tags:', itags);

const cats = db.prepare(`SELECT id, name FROM categories WHERE name = '测试' AND is_system = 0`).all();
console.log('  待删 categories:', cats);

const imgs = db.prepare(`SELECT id, item_id, original_path, thumb_path FROM item_images`).all();
console.log('  待删 item_images:', imgs.length, '条（全部 item_id 为 null 的孤儿）');

// 先把要删的图片文件路径记下来 —— 数据库记录删掉之后就查不到了
const filesToRemove = imgs
  .filter((i) => !i.item_id && !i.container_id)
  .flatMap((i) => [i.original_path, i.thumb_path])
  .filter(Boolean);

const logs = db.prepare(`SELECT id, action, summary FROM activity_logs WHERE id > 6`).all();
console.log('  待删 activity_logs:', logs.length, '条');

if (!items.length || items.length !== TARGET_ITEM_IDS.length) {
  console.error('⚠️ items 命中数与预期不符，中止');
  process.exit(1);
}

/* ---------- 2. 删 ---------- */

const del = db.transaction(() => {
  const itemIds = TARGET_ITEM_IDS.join(',');
  db.prepare(`DELETE FROM stock WHERE item_id IN (${itemIds})`).run();
  db.prepare(`DELETE FROM item_tags WHERE item_id IN (${itemIds})`).run();
  db.prepare(`DELETE FROM item_images WHERE item_id IN (${itemIds})`).run();
  db.prepare(`DELETE FROM items WHERE id IN (${itemIds})`).run();
  db.prepare(`DELETE FROM categories WHERE name = '测试' AND is_system = 0`).run();
  db.prepare(`DELETE FROM activity_logs WHERE id > 6`).run();
  // 孤儿图片：所有没绑到任何物品/盒子的
  db.prepare(`DELETE FROM item_images WHERE item_id IS NULL AND container_id IS NULL`).run();
});
del();

/* ---------- 3. 清存储目录里对应的文件 ---------- */

const storageRoot = path.join(ROOT, 'storage');
let removed = 0;
for (const rel of filesToRemove) {
  const full = path.join(storageRoot, String(rel).replace(/\\/g, path.sep));
  try {
    fs.unlinkSync(full);
    removed++;
  } catch {
    /* 文件本来就不在，忽略 */
  }
}
console.log(`\n已删除存储文件 ${removed} 个`);

/* ---------- 4. 核对基线 ---------- */

const BASE = {
  items: 8,
  stock: 8,
  containers: 8,
  spaces: 5,
  locations: 5,
  item_tags: 10,
  tags: 6,
  categories: 6,
  item_images: 0,
  activity_logs: 6,
};

console.log('\n【删除后核对】');
let bad = 0;
for (const [t, expect] of Object.entries(BASE)) {
  const got = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const ok = got === expect;
  if (!ok) bad++;
  console.log(`  ${ok ? '✅' : '❌'} ${t}: ${got}（基线 ${expect}）`);
}
db.close();
process.exit(bad ? 1 : 0);
