import { api } from '../services/api.js';
import { esc, toast, confirmSheet, inputSheet } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 按空间浏览 —— 从现实的角度找东西。
 * 用户想的是「客厅那个柜子里有啥」，而不是「盒子编号是几」。
 *
 * 空间 / 区域都支持「改名」和「删除」：
 *   - 改名：后端会自动重算所有盒子的路径缓存，不用手动修
 *   - 删除：盒子不会丢，只是不再属于任何空间（路径会少掉空间那一段）
 */
export async function spacesPage({ app }) {
  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title">按空间看</div>
        <button class="btn btn-ghost" id="btn-new-space" style="height:34px;padding:0 12px;font-size:var(--f-sm);">＋ 空间</button>
      </header>
      <div class="page-body" id="body">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  renderBottomNav();
  document.getElementById('btn-new-space').addEventListener('click', () => createSpace(load));

  await load();

  async function load() {
    const body = document.getElementById('body');
    try {
      const [{ data: spaces }, { data: locations }, { data: containers }] = await Promise.all([
        api.listSpaces(),
        api.listLocations(),
        api.listContainers(),
      ]);

      if (!spaces.length) {
        body.innerHTML = `
          <div class="card">
            <div class="empty">
              <div class="emoji">🗂️</div>
              <div class="title">还没有空间</div>
              <div class="desc">先建「客厅」「卧室」这样的空间</div>
            </div>
            <div style="padding:0 var(--s-4) var(--s-4);">
              <button class="btn btn-primary btn-block" id="empty-new">建第一个空间</button>
            </div>
          </div>`;
        document.getElementById('empty-new')?.addEventListener('click', () => createSpace(load));
        return;
      }

      body.innerHTML = spaces
        .map((s) => {
          const locs = locations.filter((l) => String(l.space_id) === String(s.id));
          const boxes = containers.filter((c) => String(c.space_id) === String(s.id));
          return `
            <div class="section" style="margin-top:var(--s-4);">
              <div class="section-head">
                <span class="section-title">${esc(s.icon || '📍')} ${esc(s.name)}</span>
                <button class="section-more" data-menu-space="${s.id}" data-name="${esc(s.name)}"
                        style="min-height:28px;padding:0 8px;">⋯</button>
              </div>
              <div class="card">
                ${
                  locs.length
                    ? locs
                        .map((l) => {
                          const inLoc = boxes.filter((b) => String(b.location_id) === String(l.id));
                          return `
                        <div style="border-bottom:1px solid var(--c-border);">
                          <div class="row-item" style="border-bottom:none;">
                            <span style="font-size:20px;">🗄️</span>
                            <div class="grow">
                              <div style="font-weight:600;">${esc(l.name)}</div>
                              <div class="xs muted">${inLoc.length} 个盒子</div>
                            </div>
                            <button class="chip chip-grey" data-menu-loc="${l.id}"
                                    data-name="${esc(l.name)}">⋯</button>
                            <button class="chip chip-grey" data-addbox="${l.id}" data-space="${s.id}">＋盒子</button>
                          </div>
                          ${
                            inLoc.length
                              ? `<div style="padding:0 var(--s-4) var(--s-3);display:flex;flex-wrap:wrap;gap:6px;">
                                   ${inLoc
                                     .map(
                                       (b) =>
                                         `<button class="chip" data-box="${b.id}">${esc(b.name)} · ${b.item_kind_count || 0}种</button>`
                                     )
                                     .join('')}
                                 </div>`
                              : ''
                          }
                        </div>`;
                        })
                        .join('')
                    : ''
                }
                ${
                  boxes.filter((b) => !b.location_id).length
                    ? `<div style="padding:var(--s-3) var(--s-4);">
                         <div class="xs muted" style="margin-bottom:6px;">直接放在这个空间</div>
                         <div style="display:flex;flex-wrap:wrap;gap:6px;">
                           ${boxes
                             .filter((b) => !b.location_id)
                             .map((b) => `<button class="chip" data-box="${b.id}">${esc(b.name)} · ${b.item_kind_count || 0}种</button>`)
                             .join('')}
                         </div>
                       </div>`
                    : ''
                }
                ${
                  !locs.length && !boxes.length
                    ? `<div class="empty" style="padding:var(--s-6);">
                         <div class="desc">这个空间还没放东西</div>
                         <button class="btn btn-ghost mt-3" data-addloc="${s.id}">＋ 加一个家具 / 区域</button>
                       </div>`
                    : `
                    <div style="padding:var(--s-3) var(--s-4);border-top:1px solid var(--c-border);">
                      <button class="chip chip-grey" data-addloc="${s.id}">＋ 加家具 / 区域</button>
                    </div>`
                }
              </div>
            </div>`;
        })
        .join('');

      body.querySelectorAll('[data-box]').forEach((el) => {
        el.addEventListener('click', () => navigate(`/boxes/${el.dataset.box}`));
      });
      body.querySelectorAll('[data-addloc]').forEach((el) => {
        el.addEventListener('click', () => createLocation(Number(el.dataset.addloc), load));
      });
      body.querySelectorAll('[data-addbox]').forEach((el) => {
        el.addEventListener('click', () => {
          navigate(`/boxes/new?spaceId=${el.dataset.space}&locationId=${el.dataset.addbox}`);
        });
      });
      body.querySelectorAll('[data-menu-space]').forEach((el) => {
        el.addEventListener('click', () => spaceMenu(el.dataset.menuSpace, el.dataset.name, locations, load));
      });
      body.querySelectorAll('[data-menu-loc]').forEach((el) => {
        el.addEventListener('click', () => locationMenu(el.dataset.menuLoc, el.dataset.name, load));
      });
    } catch (err) {
      body.innerHTML = `
        <div class="card card-pad">
          <div class="sub small">没加载出来：${esc(err.message)}</div>
          <button class="btn btn-ghost btn-block mt-3" id="retry">重试</button>
        </div>`;
      document.getElementById('retry')?.addEventListener('click', load);
    }
  }
}

/* ---------------- 空间的改名 / 删除 ---------------- */

async function spaceMenu(spaceId, name, locations, done) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(name)}</div>
      <button class="row-item" data-act="rename" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
        <span style="font-size:20px;">✏️</span><div class="grow">改名字</div>
      </button>
      <button class="row-item" data-act="manage-loc" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
        <span style="font-size:20px;">🗄️</span><div class="grow">管理家具 / 区域</div>
      </button>
      <button class="row-item" data-act="delete" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;color:#b42318;">
        <span style="font-size:20px;">🗑️</span><div class="grow">删除这个空间</div>
      </button>
      <button class="btn btn-secondary btn-block mt-3" data-act="cancel">取消</button>
    </div>`;

  mask.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel' || e.target === mask) return mask.remove();
    mask.remove();

    if (act === 'rename') {
      const next = await inputSheet('空间改名', { value: name, placeholder: '比如：客厅 / 卧室 / 储藏室' });
      if (!next || next === name) return;
      try {
        await api.updateSpace(spaceId, { name: next });
        toast('改好了，盒子位置也一起更新了');
        done?.();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (act === 'manage-loc') {
      return pickLocationToManage(spaceId, name, locations, done);
    }

    if (act === 'delete') {
      // 这条一定要说清楚：盒子不会丢，只是不再挂在任何空间下面
      const yes = await confirmSheet(
        '删除空间',
        `「${name}」会删掉。里面的盒子不会丢，但会变成「不属于任何空间」，` +
          `按空间看的时候要重新归位。确定吗？`,
        '删除',
        { danger: true }
      );
      if (!yes) return;
      try {
        const { data } = await api.deleteSpace(spaceId);
        const n = data?.detachedContainers || 0;
        toast(n ? `空间删了，${n} 个盒子还在` : '空间删了');
        done?.();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  document.body.appendChild(mask);
}

/** 空间里家具/区域的管理入口（改名 / 删除） */
function pickLocationToManage(spaceId, spaceName, locations, done) {
  const locs = locations.filter((l) => String(l.space_id) === String(spaceId));
  if (!locs.length) return toast('这个空间还没有家具 / 区域');

  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(spaceName)} · 家具与区域</div>
      ${locs
        .map(
          (l) => `
        <button class="row-item" data-loc="${l.id}" data-name="${esc(l.name)}"
                style="width:100%;text-align:left;border-radius:var(--r-md);margin-bottom:6px;border:1px solid var(--c-border);">
          <span style="font-size:20px;">🗄️</span><div class="grow">${esc(l.name)}</div><span class="muted">›</span>
        </button>`
        )
        .join('')}
      <button class="btn btn-secondary btn-block mt-3" data-act="cancel">关闭</button>
    </div>`;

  mask.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="cancel"]') || e.target === mask) return mask.remove();
    const btn = e.target.closest('[data-loc]');
    if (!btn) return;
    mask.remove();
    locationMenu(btn.dataset.loc, btn.dataset.name, done);
  });

  document.body.appendChild(mask);
}

async function locationMenu(locId, name, done) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${esc(name)}</div>
      <button class="row-item" data-act="rename" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
        <span style="font-size:20px;">✏️</span><div class="grow">改名字</div>
      </button>
      <button class="row-item" data-act="delete" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;color:#b42318;">
        <span style="font-size:20px;">🗑️</span><div class="grow">删除这个区域</div>
      </button>
      <button class="btn btn-secondary btn-block mt-3" data-act="cancel">取消</button>
    </div>`;

  mask.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel' || e.target === mask) return mask.remove();
    mask.remove();

    if (act === 'rename') {
      const next = await inputSheet('区域改名', { value: name, placeholder: '比如：电视柜 / 衣柜 / 货架' });
      if (!next || next === name) return;
      try {
        await api.updateLocation(locId, { name: next });
        toast('改好了，里面盒子的位置也一起更新了');
        done?.();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (act === 'delete') {
      const yes = await confirmSheet(
        '删除区域',
        `「${name}」会删掉。里面的盒子不会丢，会退回到所属空间下面。确定吗？`,
        '删除',
        { danger: true }
      );
      if (!yes) return;
      try {
        await api.deleteLocation(locId);
        toast('区域删了，里面的盒子还在');
        done?.();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  document.body.appendChild(mask);
}

/* ---------------- 新建 ---------------- */

async function createSpace(done) {
  const name = await inputSheet('新建空间', { placeholder: '比如：客厅 / 卧室 / 储藏室', confirmText: '建好' });
  if (!name) return;
  const icons = ['🛋️', '🛏️', '📚', '🍳', '📦', '🚗', '🧺'];
  const icon = icons[Math.floor(Math.random() * icons.length)];
  try {
    await api.createSpace({ name, icon });
    toast('空间建好了');
    done?.();
  } catch (err) {
    toast(err.message, true);
  }
}

async function createLocation(spaceId, done) {
  const name = await inputSheet('新建家具 / 区域', { placeholder: '比如：电视柜 / 衣柜 / 货架', confirmText: '加好' });
  if (!name) return;
  try {
    await api.createLocation({ name, spaceId });
    toast('加好了');
    done?.();
  } catch (err) {
    toast(err.message, true);
  }
}
