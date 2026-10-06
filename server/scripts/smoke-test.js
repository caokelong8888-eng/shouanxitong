/**
 * 接口冒烟测试。
 *   node server/scripts/smoke-test.js
 * 覆盖读、写、搜索、上传、AI 占位、批量入库的完整链路。
 * 用真实 HTTP 请求，不用假 mock —— 服务器没起会直接报错提醒。
 */
const BASE = process.env.BASE_URL || 'http://localhost:3300';

/**
 * 访问口令。
 * 服务器现在有鉴权了，冒烟测试得先登录拿令牌，否则全是 401。
 * 没配 ACCESS_PASSCODE 的环境（纯本地自测）会自动跳过登录。
 */
const PASSCODE = process.env.ACCESS_PASSCODE || '';
let TOKEN = '';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

async function req(method, path, body, opts = {}) {
  const init = { method, headers: {} };
  if (TOKEN) init.headers.Authorization = `Bearer ${TOKEN}`;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  // 中文必须显式编码，否则查询参数会因为非 ASCII 字符被丢弃
  const url = path.startsWith('http') ? path : BASE + path;
  const res = await fetch(url, init);
  const type = res.headers.get('content-type') || '';
  if (opts.raw) return { res, buf: Buffer.from(await res.arrayBuffer()) };
  if (type.includes('application/json')) {
    return { res, json: await res.json() };
  }
  return { res, buf: Buffer.from(await res.arrayBuffer()), type };
}

/** 带查询参数的 GET，自动编码参数值 */
async function get(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return req('GET', qs ? `${path}?${qs}` : path);
}

/**
 * 清理上一次测试遗留的数据。
 * 直接操作 SQLite 文件（测试脚本与服务器在同一台机器上）。
 * 只有带「测试」标记的数据会被删，演示数据（盒子01-08）不动。
 */
async function cleanup() {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const dbFile = process.env.DB_PATH || nodePath.resolve(process.cwd(), 'data', 'app.db');
  if (!fs.existsSync(dbFile)) return;
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbFile);
    db.pragma('foreign_keys = ON');
    const run = db.transaction(() => {
      db.prepare("DELETE FROM containers WHERE name LIKE '测试盒子%'").run();
      db.prepare("DELETE FROM items WHERE name LIKE '测试%'").run();
      db.prepare("DELETE FROM activity_logs WHERE summary LIKE '%测试%' OR summary LIKE '%识别了%'").run();
      // 清理测试上传产生的孤儿图片
      db.prepare('DELETE FROM item_images WHERE item_id IS NULL AND container_id IS NULL').run();
    });
    run();
    db.close();
    console.log('🧹 已清理上次测试残留数据\n');
  } catch (err) {
    console.log(`⚠️  跳过清理（${err.message}）\n`);
  }
}

async function main() {
  console.log(`\n🔍 冒烟测试目标: ${BASE}\n`);

  // ---------- 0. 先过鉴权 ----------
  if (PASSCODE) {
    console.log('【0】鉴权');
    const { json } = await req('POST', '/api/auth/login', { passcode: PASSCODE });
    check('口令登录', json?.ok === true && !!json.data?.token, JSON.stringify(json?.error));
    TOKEN = json?.data?.token || '';

    // 确认没令牌真的进不来 —— 这条不过说明保护是假的
    const saved = TOKEN;
    TOKEN = '';
    const { res } = await req('GET', '/api/items');
    check('无令牌被拒绝', res.status === 401, `状态码 ${res.status}`);
    TOKEN = saved;
    console.log('');
  } else {
    console.log('（未设置 ACCESS_PASSCODE，跳过鉴权测试）\n');
  }

  // 自清理：清掉上次测试可能残留的数据，保证反复运行结果一致
  await cleanup();

  // ---------- 1. 基础 ----------
  console.log('【1】基础接口');
  {
    const { json } = await req('GET', '/api/health');
    check('健康检查', json?.ok === true);
    const { json: fam } = await req('GET', '/api/families/current');
    check('家庭信息', fam?.ok && fam.data.members.length >= 1, JSON.stringify(fam?.data?.members));
    const { json: ov } = await req('GET', '/api/overview');
    check('首页概览', ov?.ok && ov.data.counts.containers >= 8, JSON.stringify(ov?.data?.counts));
  }

  // ---------- 2. 层级结构 ----------
  console.log('\n【2】空间 / 区域 / 盒子');
  {
    const { json: sp } = await req('GET', '/api/spaces');
    check('空间列表（5个）', sp?.ok && sp.data.length === 5, `实际 ${sp?.data?.length}`);

    const { json: loc } = await req('GET', '/api/locations');
    check('区域列表（5个）', loc?.ok && loc.data.length === 5, `实际 ${loc?.data?.length}`);

    const { json: locFiltered } = await get('/api/locations', { spaceId: 3 });
    check('按空间筛选区域（书房→柜子A）', locFiltered?.ok && locFiltered.data.length === 1 && locFiltered.data[0].name === '柜子A');

    const { json: cs } = await req('GET', '/api/containers');
    check('盒子列表至少含种子的 8 个', cs?.ok && cs.data.length >= 8, `实际 ${cs?.data?.length}`);
    check('盒子带 full_path 路径缓存', cs?.data?.[0]?.full_path?.includes('/'), cs?.data?.[0]?.full_path);
    // 注意：只校验「统计字段存在且 >= 种子数量」，不写死绝对值。
    // 否则一旦手工往盒子里加了东西，测试就会误报。
    const b03 = cs?.data?.find((c) => c.code === 'B03');
    check('盒子带物品数量统计', Number.isInteger(b03?.item_kind_count) && b03.item_kind_count >= 4, `盒子03 实际 ${b03?.item_kind_count}`);
  }

  // ---------- 3. 扫码直达 ----------
  console.log('\n【3】扫码直达盒子');
  {
    const { json: box } = await req('GET', '/api/containers/code/B03');
    check('按 code 查到盒子03', box?.ok && box.data.code === 'B03');
    check('盒子03 至少含种子的 4 种物品', (box?.data?.items?.length || 0) >= 4, `实际 ${box?.data?.items?.length}`);
    check('扫码返回完整路径', box?.data?.full_path === '书房 / 柜子A / 第二层 / 盒子03', box?.data?.full_path);

    const { json: missing } = await req('GET', '/api/containers/code/B999');
    check('不存在的盒子返回 404 且带人话提示', missing?.ok === false && missing.error.message.includes('不存在'), missing?.error?.message);
  }

  // ---------- 4. 多位置模型（核心） ----------
  console.log('\n【4】多位置模型（同一物品在多个盒子）');
  {
    const { json: items } = await get('/api/items', { keyword: 'AA电池' });
    const names = items?.data?.map((i) => i.name) || [];
    const aa = items?.data?.find((i) => i.name === 'AA电池');
    check('搜到 AA电池', !!aa, JSON.stringify(names));
    check('AA电池 有 2 个位置', aa?.container_count === 2, `实际 ${aa?.container_count}`);
    check('AA电池 总量 = 8+12 = 20', aa?.total_quantity === 20, `实际 ${aa?.total_quantity}`);

    const { json: detail } = await req('GET', `/api/items/${aa.id}`);
    const codes = detail?.data?.places?.map((p) => p.container_code).sort();
    check('详情里两个位置是 B02 和 B08', JSON.stringify(codes) === JSON.stringify(['B02', 'B08']), JSON.stringify(codes));

    // 无盒子物品
    const { json: pb } = await get('/api/items', { keyword: '充电宝' });
    const power = pb?.data?.find((i) => i.name === '充电宝');
    check('充电宝状态为借出', power?.status === 'lent', power?.status);
    const { json: pbDetail } = await req('GET', `/api/items/${power.id}`);
    const loose = pbDetail?.data?.places?.[0];
    check('借出物品 in_box = false 且有备注', loose?.in_box === false && loose?.note === '借给家人A', JSON.stringify(loose));
  }

  // ---------- 5. 搜索 ----------
  console.log('\n【5】搜索');
  {
    const { json: r1 } = await get('/api/search', { q: '电池' });
    const names1 = r1?.data?.items?.map((i) => i.name) || [];
    check('搜「电池」命中 AA/AAA电池', names1.includes('AA电池') && names1.includes('AAA电池'), JSON.stringify(names1));
    check('搜「电池」建议里带出分类', (r1?.data?.suggestions?.categories || []).some((c) => c.name.includes('电池')), JSON.stringify(r1?.data?.suggestions?.categories));
    check('搜索结果带位置文案', !!r1?.data?.items?.[0]?.location_text, r1?.data?.items?.[0]?.location_text);

    const { json: r2 } = await get('/api/search', { q: '电视线' });
    const names2 = r2?.data?.items?.map((i) => i.name) || [];
    check('模糊搜「电视线」能命中 HDMI线', names2.includes('HDMI线'), JSON.stringify(names2));

    const { json: r3 } = await get('/api/search', { q: 'USB-C', type: 'tag' });
    check('按标签搜「USB-C」有结果', (r3?.data?.items?.length || 0) >= 1, `实际 ${r3?.data?.items?.length}`);

    const { json: r4 } = await get('/api/search', { q: '转换头' });
    const names4 = r4?.data?.items?.map((i) => i.name) || [];
    check('搜「转换头」命中 USB-C转HDMI转接器', names4.some((n) => n.includes('转接器')), JSON.stringify(names4));

    const { json: r5 } = await get('/api/search', { q: '接电脑和显示器的转换头', type: 'semantic' });
    check('语义搜索明确返回未接入提示（不做假命中）', r5?.data?.available === false && r5.data.items.length === 0, r5?.data?.message);
  }

  // ---------- 6. 二维码 ----------
  console.log('\n【6】盒子二维码');
  {
    const { buf, res } = await req('GET', '/api/containers/3/qrcode', undefined, { raw: true });
    check('二维码返回 PNG 图片', res.headers.get('content-type') === 'image/png' && buf.length > 500, `${buf.length} bytes`);
    const { json: qrJson } = await req('GET', '/api/containers/3/qrcode?format=json');
    check('二维码扫码地址指向盒子03', qrJson?.data?.scan_url?.includes('#/boxes/code/B03'), qrJson?.data?.scan_url);
  }

  // ---------- 7. 图片上传 ----------
  console.log('\n【7】图片上传 + 缩略图');
  let uploadedImageId = null;
  {
    // 造一张 800x600 的测试图（用 sharp 生成，不依赖外部素材）
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 40, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();

    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
    const { json: up } = await req('POST', '/api/uploads/image', fd);
    check('上传成功返回图片记录', up?.ok && up.data.id > 0, JSON.stringify(up?.error));
    uploadedImageId = up?.data?.id;
    check('生成了缩略图地址', !!up?.data?.thumb_url, up?.data?.thumb_url);
    check('记录了图片尺寸', up?.data?.width === 800 && up?.data?.height === 600, `${up?.data?.width}x${up?.data?.height}`);

    // 缩略图确实能访问，且比原图小
    const { buf: thumbBuf, res: thumbRes } = await req('GET', up.data.thumb_url, undefined, { raw: true });
    check('缩略图可访问', thumbRes.status === 200 && thumbBuf.length > 0, `HTTP ${thumbRes.status}`);
    const { buf: origBuf } = await req('GET', up.data.url, undefined, { raw: true });
    check('缩略图体积小于原图', thumbBuf.length < origBuf.length, `thumb ${thumbBuf.length} < orig ${origBuf.length}`);
  }

  // ---------- 8. AI 识别占位 ----------
  console.log('\n【8】AI 识别（占位模式）');
  {
    const { json: rec } = await req('POST', '/api/recognize', { imageId: uploadedImageId });
    check('识别返回结构化结果', rec?.ok && !!rec.data.result.name, JSON.stringify(rec?.error));
    const r = rec?.data?.result;
    check('契约字段齐全', ['name', 'category', 'tags', 'quantity', 'unit', 'confidence', 'needConfirm'].every((k) => k in (r || {})), Object.keys(r || {}).join(','));
    check('返回 mock 驱动标识', rec?.data?.driver === 'mock', rec?.data?.driver);
    check('置信度在 0~1 之间', r?.confidence >= 0 && r?.confidence <= 1, String(r?.confidence));

    const { json: what } = await req('POST', '/api/recognize/what-is-this', { imageId: uploadedImageId });
    check('「这是什么」独立入口可用', what?.ok && !!what.data.name, JSON.stringify(what?.error));
  }

  // ---------- 9. 批量入库（连拍） ----------
  console.log('\n【9】连续拍照批量入库');
  let newContainerId = null;
  {
    const { json: nc } = await req('GET', '/api/containers/next-code');
    check('自动生成下一个盒号 B09', nc?.data?.code === 'B09', nc?.data?.code);

    const { json: created } = await req('POST', '/api/containers', { name: '测试盒子09', spaceId: 4, detail: '第一层' });
    check('新建盒子成功', created?.ok && created.data.code === 'B09', JSON.stringify(created?.error));
    newContainerId = created?.data?.id;
    // 空间是厨房、没选区域、detail 是第一层 → 路径应为「厨房 / 第一层 / 测试盒子09」
    check('新建盒子自动算了路径', created?.data?.full_path === '厨房 / 第一层 / 测试盒子09', created?.data?.full_path);

    const { json: inbound } = await req('POST', '/api/inbound/batch', {
      containerId: newContainerId,
      items: [
        { imageIds: [uploadedImageId], name: '测试数据线', category: '电子配件', tags: ['测试', '数据线'], quantity: 2, unit: '条', confidence: 0.9 },
        { name: '测试零件', category: '待确认', tags: ['测试'], quantity: 1, needConfirm: true },
      ],
    });
    check('批量入库 2 件', inbound?.data?.createdCount === 2, JSON.stringify(inbound?.data));
    check('入库无失败项', inbound?.data?.failed?.length === 0, JSON.stringify(inbound?.data?.failed));

    const { json: box } = await req('GET', `/api/containers/${newContainerId}`);
    check('新盒子里出现 2 件物品', box?.data?.items?.length === 2, `实际 ${box?.data?.items?.length}`);
    check('新盒子里带上了照片', box?.data?.images?.length === 1, `实际 ${box?.data?.images?.length}`);

    const { json: srch } = await get('/api/search', { q: '测试数据线' });
    const hit = srch?.data?.items?.find((i) => i.name === '测试数据线');
    check('新入库物品能被搜到', !!hit, JSON.stringify(srch?.data?.items?.map((i) => i.name)));
    check('新物品位置指向新盒子', hit?.location_text?.includes('测试盒子09'), hit?.location_text);
  }

  // ---------- 10. 盒子移动 → 物品跟随 ----------
  console.log('\n【10】移动盒子（物品自动跟随，不需逐个改）');
  {
    const { json: moved } = await req('PATCH', `/api/containers/${newContainerId}`, { spaceId: 5, locationId: 5, detail: '第三层' });
    check('盒子移动成功', moved?.ok && moved.data.full_path.includes('储藏室'), moved?.data?.full_path);
    check('移动后路径重算正确', moved?.data?.full_path === '储藏室 / 货架B / 第三层 / 测试盒子09', moved?.data?.full_path);
    check('里面的物品没丢', moved?.data?.items?.length === 2, `实际 ${moved?.data?.items?.length}`);

    const { json: srch } = await get('/api/search', { q: '测试数据线' });
    const hit = srch?.data?.items?.find((i) => i.name === '测试数据线');
    check('搜索结果里位置跟着更新了', hit?.location_text?.includes('储藏室'), hit?.location_text);
  }

  // ---------- 11. 改空间名 → 路径重算 ----------
  console.log('\n【11】改空间名后路径缓存一致性');
  {
    const { json: sp } = await req('PATCH', '/api/spaces/5', { name: '储物间' });
    check('空间改名成功', sp?.ok && sp.data.name === '储物间');
    const { json: box } = await req('GET', `/api/containers/${newContainerId}`);
    check('盒子路径自动跟着改了', box?.data?.full_path.startsWith('储物间'), box?.data?.full_path);
    await req('PATCH', '/api/spaces/5', { name: '储藏室' }); // 改回来
  }

  // ---------- 12. 库存数量调整 ----------
  console.log('\n【12】库存数量与位置调整');
  {
    const { json: item } = await req('POST', '/api/items', { name: '测试螺丝', category: '工具', quantity: 10, containerId: 3, unit: '个' });
    check('带库存新建物品', item?.ok && item.data.total_quantity === 10, JSON.stringify(item?.error));

    const stockId = item?.data?.stocks?.[0]?.stock_id;
    const { json: updated } = await req('PATCH', `/api/stocks/${stockId}`, { quantity: 25 });
    check('改数量成功（10→25）', updated?.data?.total_quantity === 25, String(updated?.data?.total_quantity));

    // 同一物品加到另一个盒子 → 应该变成两条位置
    const { json: added } = await req('POST', '/api/stocks', { itemId: item.data.id, containerId: 2, quantity: 5 });
    check('同一物品出现在第 2 个盒子', added?.data?.places?.length === 2, JSON.stringify(added?.data?.places?.map((p) => p.container_code)));
    check('总量合并为 30', added?.data?.total_quantity === 30, String(added?.data?.total_quantity));

    // 重复加到同一盒子 → 数量累加而不是新增记录
    const { json: again } = await req('POST', '/api/stocks', { itemId: item.data.id, containerId: 2, quantity: 5 });
    check('重复放入同一盒子会累加数量而非新增记录', again?.data?.places?.length === 2 && again?.data?.total_quantity === 35, JSON.stringify({ n: again?.data?.places?.length, t: again?.data?.total_quantity }));

    await req('DELETE', `/api/items/${item.data.id}`);
  }

  // ---------- 13. 错误处理 ----------
  console.log('\n【13】错误处理（不能出现「系统错误」了事）');
  {
    const { res: r1, json: j1 } = await req('GET', '/api/items/999999');
    check('查不存在的物品 → 404 + 人话', r1.status === 404 && j1.error.message.includes('不存在'), j1?.error?.message);

    const { json: j2 } = await req('POST', '/api/items', { name: '' });
    check('空名称 → 400 + 人话', j2?.ok === false && j2.error.message.includes('不能为空'), j2?.error?.message);

    const { json: j3 } = await req('POST', '/api/containers', { name: 'X', code: 'B03' });
    check('重复盒号 → 冲突提示', j3?.ok === false && (j3.error.code === 'DUPLICATE' || j3.error.message.includes('存在')), j3?.error?.message);

    const { json: j4 } = await req('POST', '/api/inbound/batch', { items: [] });
    check('批量入库缺盒子 → 明确提示', j4?.ok === false && j4.error.message.includes('盒子'), j4?.error?.message);

    const sharp = (await import('sharp')).default;
    const txt = Buffer.from('这不是图片');
    const fd = new FormData();
    fd.append('file', new Blob([txt], { type: 'text/plain' }), 'a.txt');
    const { json: j5 } = await req('POST', '/api/uploads/image', fd);
    check('非图片文件 → 明确拒绝', j5?.ok === false && j5.error.code === 'UNSUPPORTED_MEDIA', j5?.error?.message);

    const { json: j6 } = await req('GET', '/api/not-exist');
    check('未知接口 → 404 且说明路径', j6?.ok === false && j6.error.message.includes('/api/not-exist'), j6?.error?.message);
  }

  // ---------- 14. 操作日志 ----------
  console.log('\n【14】操作日志');
  {
    const { json: logs } = await get('/api/activity-logs', { limit: 50 });
    check('有操作日志', logs?.ok && logs.data.length > 0, `实际 ${logs?.data?.length}`);
    const actions = logs?.data?.map((l) => l.action) || [];
    check('记录了批量入库动作', actions.includes('inbound'), JSON.stringify([...new Set(actions)]));
    check('记录了盒子移动动作', actions.includes('move'), JSON.stringify([...new Set(actions)]));
    check('日志带操作人', logs?.data?.[0]?.user_name === '曹总', logs?.data?.[0]?.user_name);
  }

  // ---------- 收尾 ----------
  console.log('\n' + '─'.repeat(52));
  console.log(`  通过 ${passed} 项，失败 ${failed} 项`);
  if (failures.length) {
    console.log('  失败项：');
    failures.forEach((f) => console.log(`    · ${f}`));
  }
  console.log('─'.repeat(52) + '\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 冒烟测试执行失败:', err.message);
  console.error('   服务器起了吗？先运行: node server/src/index.js');
  process.exit(1);
});
