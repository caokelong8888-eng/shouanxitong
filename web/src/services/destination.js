/**
 * 拍照前的「放哪儿」选择面板。
 *
 * 【为什么要这一步】
 * 以前的流程是：点「＋」→ 拍 → 拍完才想起来要放哪个盒子 → 再翻一遍盒子列表。
 * 中间那一步（选盒子）夹在中间，是整个流程里最容易让人半途放弃的地方：
 * 手上还拿着东西，却要先腾出一只手去点列表。
 *
 * 现在改成：点「＋」→ 先定位置（一次点击）→ 直接进相机。
 * 位置在拍之前就定了，拍完再也不用想「放哪儿」。
 *
 * 【为什么用回调而不是 Promise】
 * 浏览器只认「同一次用户手势」里的弹窗。选完位置后要立刻唤起相机，
 * 如果用 Promise resolve 再 .then()，那就已经脱离了这次点击的手势上下文，
 * 部分手机浏览器会直接拒绝弹相机。所以这里改成回调，
 * 让 openCamera 在点击事件的同一个调用栈里被调用。
 *
 * 三个选项：
 *   - 选一个盒子：最近用过的排前面
 *   - 暂不指定：先记下来，之后再归位（不是每个东西都马上有位置的）
 */

import { api } from './api.js';
import { esc } from '../components/ui.js';

/** 最近用过的盒子：记在本地，下次优先显示 —— 连着整理同几个盒子时省事 */
const RECENT_KEY = 'home_inv_recent_containers';
const RECENT_MAX = 8;

export function loadRecentContainers() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberContainer(c) {
  if (!c?.id) return;
  try {
    const list = loadRecentContainers().filter((x) => Number(x.id) !== Number(c.id));
    list.unshift({ id: c.id, name: c.name, full_path: c.full_path || '', code: c.code || '' });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* 隐私模式存不了，忽略 */
  }
}

/**
 * 弹出「放哪儿」面板。
 *
 * @param {(dest: {containerId:number|null, containerName?:string, containerPath?:string}|null) => void} onPick
 *        选定时回调；点取消时回调 null。
 *        回调会在点击事件的同一个调用栈里被调用，可以安全地立刻唤起相机。
 */
export function pickDestination(onPick) {
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `
    <div class="sheet" id="dest-sheet">
      <div class="sheet-title">放进哪儿？</div>
      <div class="xs muted" style="margin:-6px 0 var(--s-4);">先定位置，拍完就自动归位，不用再想一遍</div>
      <div id="dest-body">
        <div class="loading"><span class="spinner"></span>加载盒子…</div>
      </div>
      <button class="btn btn-secondary btn-block mt-4" data-act="cancel">取消</button>
    </div>`;

  let settled = false;
  const close = (value) => {
    if (settled) return;
    settled = true;
    mask.remove();
    onPick(value);
  };

  mask.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="cancel"]') || e.target === mask) close(null);
  });
  document.body.appendChild(mask);

  const body = mask.querySelector('#dest-body');
  body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-container]');
    if (el) {
      const id = Number(el.dataset.container);
      const name = el.dataset.name || '';
      const path = el.dataset.path || '';
      rememberContainer({ id, name, full_path: path });
      return close({ containerId: id, containerName: name, containerPath: path });
    }
    if (e.target.closest('[data-act="none"]')) close({ containerId: null });
  });

  loadDestinations(body);
}

/** 拉盒子列表并渲染 */
async function loadDestinations(body) {
  let containers = [];
  try {
    const { data } = await api.listContainers();
    containers = data || [];
  } catch (err) {
    body.innerHTML = `<div class="xs muted" style="text-align:center;padding:var(--s-4) 0;">盒子没加载出来：${esc(err.message)}</div>`;
    return;
  }

  if (!containers.length) {
    body.innerHTML = `
      <div class="xs muted" style="text-align:center;padding:var(--s-3) 0;">
        还没有盒子。可以先建一个，也可以先记下来以后再归位。
      </div>
      <button class="btn btn-primary btn-block" data-act="none">先记下来，不放盒子</button>`;
    return;
  }

  // 最近用过的排前面 —— 连着整理同一个盒子时，这是最常要的
  const recent = loadRecentContainers();
  const recentSet = new Set(recent.map((r) => Number(r.id)));
  const recentList = recent
    .map((r) => containers.find((c) => Number(c.id) === Number(r.id)))
    .filter(Boolean);
  const rest = containers.filter((c) => !recentSet.has(Number(c.id)));

  const row = (c) => `
    <button class="row-item" data-container="${c.id}" data-name="${esc(c.name)}"
            data-path="${esc(c.full_path || '')}"
            style="width:100%;text-align:left;border-radius:var(--r-md);margin-bottom:6px;border:1px solid var(--c-border);">
      <div class="grow" style="min-width:0;">
        <div style="font-weight:600;">${esc(c.name)}</div>
        ${c.full_path ? `<div class="xs muted ellipsis">${esc(c.full_path)}</div>` : ''}
      </div>
      <span class="muted">›</span>
    </button>`;

  body.innerHTML = `
    ${
      recentList.length
        ? `<div class="xs muted" style="margin-bottom:6px;">最近用的</div>
           ${recentList.map(row).join('')}`
        : ''
    }
    <div class="xs muted" style="margin:${recentList.length ? 'var(--s-3)' : '0'} 0 6px;">全部盒子</div>
    <div style="max-height:38vh;overflow-y:auto;">${rest.map(row).join('')}</div>
    <button class="btn btn-ghost btn-block mt-3" data-act="none">先记下来，不放盒子</button>`;
}
