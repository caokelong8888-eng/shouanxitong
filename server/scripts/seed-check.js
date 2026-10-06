import { getDb, closeDb } from '../src/db/connection.js';
import { config } from '../src/config/index.js';

/**
 * 演示数据检查脚本：node scripts/seed-check.js
 * 重点验证「多位置模型」是否被正确表达。
 */
const db = getDb();

console.log('📦 家庭:', db.prepare('SELECT name FROM families WHERE id=?').get(config.defaultFamilyId)?.name);

const counts = {};
for (const t of ['spaces', 'locations', 'containers', 'categories', 'tags', 'items', 'stock', 'item_images']) {
  counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
}
console.log('📊 数据量:', JSON.stringify(counts, null, 0));

console.log('\n=== 关键验证① 多位置：AA电池分布在多个盒子 ===');
const aa = db
  .prepare(
    `SELECT i.name, c.code, c.full_path, s.quantity, i.unit, s.status
       FROM items i
       JOIN stock s ON s.item_id = i.id
       LEFT JOIN containers c ON c.id = s.container_id
      WHERE i.name = 'AA电池'`
  )
  .all();
if (aa.length !== 2) {
  console.error(`❌ 期望 2 条库存记录，实际 ${aa.length} 条 —— 多位置模型有问题`);
  process.exitCode = 1;
} else {
  for (const r of aa) console.log(`  ✅ ${r.name} → ${r.code} (${r.full_path}) : ${r.quantity}${r.unit}`);
}

console.log('\n=== 关键验证② 盒子03 里面有什么 ===');
const box3 = db
  .prepare(
    `SELECT i.name, s.quantity, i.unit
       FROM stock s
       JOIN items i ON i.id = s.item_id
      WHERE s.container_id = (SELECT id FROM containers WHERE code='B03')
      ORDER BY i.name`
  )
  .all();
for (const r of box3) console.log(`  📦 ${r.name} × ${r.quantity}${r.unit || ''}`);

console.log('\n=== 关键验证③ 无盒子库存（借出/在家使用） ===');
const loose = db
  .prepare(
    `SELECT i.name, s.quantity, s.status, s.note
       FROM stock s JOIN items i ON i.id = s.item_id
      WHERE s.container_id IS NULL`
  )
  .all();
for (const r of loose) console.log(`  🚩 ${r.name} × ${r.quantity}  状态=${r.status}  备注=${r.note || '-'}`);

console.log('\n=== 关键验证④ 盒子路径缓存 full_path ===');
for (const c of db.prepare('SELECT code, name, full_path FROM containers ORDER BY sort_order').all()) {
  console.log(`  ${c.code}  ${c.full_path}`);
}

closeDb();
console.log('\n✅ 种子数据自检完成');
