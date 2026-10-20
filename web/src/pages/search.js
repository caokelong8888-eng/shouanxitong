import { api } from '../services/api.js';
import { esc, thumbHtml, pathHtml, fmtQty, toast, statusChipClass, STATUS_LABEL, bindZoom } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';
import { startPhotoFlow } from '../services/photo-flow.js';

/**
 * 搜索页 —— 全 App 最核心的功能。
 *
 * 结果必须直接告诉用户「东西在哪」，而不是只给个名字。
 * 每条结果都把位置、照片、盒子摆出来，减少一次点击。
 *
 * 三种找法：
 *   关键词 —— 直接打字，主打
 *   按分类 —— 点选列表（不用打字，点一下就出结果）
 *   按标签 —— 点选列表
 */

const HOT = ['电池', '数据线', 'HDMI', '充电头', '工具', '说明书'];

/**
 * 位置筛选状态。
 *
 * 模块级而不是页面内局部 —— doSearch 是模块级函数，它要用这个状态。
 * 用户选了「客厅」之后结果要一直带着这个限定，所以状态得比页面活得久。
 */
const placeFilter = {
  spaceIds: [],
  locationIds: [],
};

/* ---------------- 最近找过的 ---------------- */

const RECENT_KEY = 'home_inv_recent_searches';
const RECENT_MAX = 5;

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** 记一笔搜索词。同一个词提到最前，不重复堆叠 */
function rememberSearch(word) {
  const w = String(word || '').trim();
  if (!w) return;
  try {
    const list = loadRecentSearches().filter((x) => x !== w);
    list.unshift(w);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* 隐私模式下存不了，忽略即可 */
  }
}

function clearRecentSearches() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* 忽略 */
  }
}

export async function searchPage({ app, query }) {
  const initialQ = query?.q || '';

  // 每次进搜索页重置位置筛选 —— 上次的条件不该莫名其妙套在新搜索上
  placeFilter.spaceIds = [];
  placeFilter.locationIds = [];

  app.innerHTML = `
    <div class="page">
      <div style="padding: var(--s-4) var(--s-4) 0; padding-top: calc(var(--safe-top) + var(--s-4));">
        <form class="search-bar" id="search-form">
          <span class="icon">🔍</span>
          <input type="search" id="q" placeholder="搜索你要找的东西" value="${esc(initialQ)}" autocomplete="off" enterkeyhint="search" />
          <button type="button" class="search-clear hidden" id="clear">✕</button>
        </form>

        <!-- 位置筛选条：点一下「客厅」就只看客厅的东西 -->
        <div class="chip-row mt-3 hidden" id="place-row"></div>

        <div class="chip-row mt-3" id="mode-row">
          <button class="chip" data-mode="keyword">关键词</button>
          <button class="chip chip-grey" data-mode="category">按分类</button>
          <button class="chip chip-grey" data-mode="tag">按标签</button>
        </div>
      </div>

      <div class="page-body" id="search-body" style="padding-top: var(--s-4);">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  renderBottomNav();

  const input = document.getElementById('q');
  const clearBtn = document.getElementById('clear');

  const syncClear = () => clearBtn.classList.toggle('hidden', !input.value);
  input.addEventListener('input', syncClear);
  syncClear();

  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncClear();
    input.focus();
    setMode('keyword');
    showHot();
  });

  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    // 打字搜索永远是关键词模式 —— 用户直接输入时不该还停在「按分类」
    setMode('keyword');
    doSearch(q, 'keyword');
  });

  let currentMode = 'keyword';

  function setMode(mode) {
    currentMode = mode;
    // 只扫模式那一行，别把结果里渲染出的分类/标签 chip 也当成模式按钮
    document.querySelectorAll('#mode-row [data-mode]').forEach((b) => {
      b.className = `chip ${b.dataset.mode === currentMode ? '' : 'chip-grey'}`;
    });
  }

  /* ---------------- 位置筛选条 ---------------- */

  /**
   * 加载家里的空间与区域，铺成一排可点的 chip。
   *
   * 【为什么要有】
   * 用户想找「书房里面的电池」，以前只能自己把「书房」两个字打进搜索词，
   * 还得指望后端认得出来。点一下 chip 就能限定位置，不用猜词。
   */
  async function loadPlaceChips() {
    const row = document.getElementById('place-row');
    if (!row) return;
    let spaces = [];
    let locations = [];
    try {
      const [s, l] = await Promise.all([api.listSpaces(), api.listLocations()]);
      spaces = s.data || [];
      locations = l.data || [];
    } catch {
      return; // 拿不到就不显示这排，不影响搜索本身
    }
    if (!spaces.length && !locations.length) return;

    renderPlaceChips(spaces, locations);
  }

  /**
   * 画位置筛选条。
   *
   * 【为什么必须整体重画，而不是只 toggle 选中样式】
   * 「清除」按钮的存在与否取决于当前有没有选中位置。
   * 之前点 chip 只做 class 切换，从不重画这一行，
   * 结果「清除」按钮永远出不来 —— 用户选了位置就再也退不出去，
   * 只能刷新页面重置。
   * 所以这里做成「数据一变就整行重画」，选中态也跟着数据走。
   */
  function renderPlaceChips(spaces, locations) {
    const row = document.getElementById('place-row');
    if (!row) return;

    const hasFilter = placeFilter.spaceIds.length > 0 || placeFilter.locationIds.length > 0;

    row.innerHTML = `
      <span class="xs muted" style="align-self:center;margin-right:2px;">位置</span>
      ${spaces
        .map((sp) => {
          const on = placeFilter.spaceIds.includes(sp.id);
          return `<button class="chip ${on ? '' : 'chip-grey'}" data-place="space" data-id="${sp.id}">${esc(sp.name)}</button>`;
        })
        .join('')}
      ${locations
        .map((lo) => {
          const on = placeFilter.locationIds.includes(lo.id);
          return `<button class="chip ${on ? '' : 'chip-grey'}" data-place="location" data-id="${lo.id}">${esc(lo.name)}</button>`;
        })
        .join('')}
      ${hasFilter ? '<button class="chip chip-danger" data-place-clear="1">清除</button>' : ''}
    `;
    row.classList.remove('hidden');

    row.querySelectorAll('[data-place]').forEach((b) => {
      b.addEventListener('click', () => {
        const type = b.dataset.place;
        const id = Number(b.dataset.id);
        const arr = type === 'space' ? placeFilter.spaceIds : placeFilter.locationIds;
        const idx = arr.indexOf(id);
        if (idx === -1) arr.push(id);
        else arr.splice(idx, 1);
        // 整行重画：选中态 + 「清除」按钮一起更新
        renderPlaceChips(spaces, locations);
        // 位置变了，重新搜一遍
        rerunSearch();
      });
    });

    row.querySelector('[data-place-clear]')?.addEventListener('click', () => {
      placeFilter.spaceIds = [];
      placeFilter.locationIds = [];
      renderPlaceChips(spaces, locations);
      rerunSearch();
    });
  }

  /** 位置筛选变化后重新搜 —— 有词就按词搜，没词就列出该位置下的所有东西 */
  function rerunSearch() {
    const q = input.value.trim();
    if (q) doSearch(q, 'keyword');
    else if (placeFilter.spaceIds.length || placeFilter.locationIds.length) doSearch('', 'keyword');
    else showHot();
  }

  document.querySelectorAll('#mode-row [data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setMode(mode);
      // 按分类 / 按标签不靠打字，直接列出所有可选项让用户点
      if (mode === 'category') return showCategoryPicker();
      if (mode === 'tag') return showTagPicker();
      const q = input.value.trim();
      if (q) doSearch(q, 'keyword');
      else showHot();
    });
  });

  // 位置筛选条：加载家里的空间与区域，铺成一排可点的 chip
  loadPlaceChips();

  // 带 ?q= 进来：可能是别人分享的搜索链接
  const mode = query?.mode;
  if (initialQ) {
    doSearch(initialQ, 'keyword');
  } else if (mode === 'category') {
    setMode('category');
    showCategoryPicker();
  } else if (mode === 'tag') {
    setMode('tag');
    showTagPicker();
  } else {
    showHot();
  }

  async function showHot() {
    const recent = loadRecentSearches();

    document.getElementById('search-body').innerHTML = `
      ${
        recent.length
          ? `<div class="section" style="margin-top:0;">
               <div class="section-head">
                 <span class="section-title">最近找过的</span>
                 <button class="section-more" id="btn-clear-recent">清空</button>
               </div>
               <div class="card">
                 ${recent
                   .map(
                     (w) => `
                   <button class="row-item" data-recent="${esc(w)}" style="width:100%;text-align:left;">
                     <span style="font-size:16px;opacity:.5;">🕘</span>
                     <div class="grow ellipsis">${esc(w)}</div>
                     <span class="muted">›</span>
                   </button>`
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="section" style="${recent.length ? '' : 'margin-top:0;'}">
        <div class="section-head"><span class="section-title">常找的东西</span></div>
        <div class="chip-row">
          ${HOT.map((w) => `<button class="chip" data-hot="${esc(w)}">${esc(w)}</button>`).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">所有东西</span>
          <span class="section-more" id="all-count"></span>
        </div>
        <div class="item-grid" id="all-grid">
          <div class="loading" style="grid-column:1/-1;"><span class="spinner"></span>加载中</div>
        </div>
      </div>
    `;

    document.querySelectorAll('[data-hot]').forEach((b) => {
      b.addEventListener('click', () => {
        input.value = b.dataset.hot;
        syncClear();
        doSearch(b.dataset.hot, 'keyword');
      });
    });

    document.querySelectorAll('[data-recent]').forEach((b) => {
      b.addEventListener('click', () => {
        input.value = b.dataset.recent;
        syncClear();
        doSearch(b.dataset.recent, 'keyword');
      });
    });

    document.getElementById('btn-clear-recent')?.addEventListener('click', () => {
      clearRecentSearches();
      showHot();
    });

    loadAllItems();
  }

  /**
   * 把「所有东西」直接铺成图片墙。
   * 只出图，不带名字/位置/数量 —— 想看清是哪件、在哪，点一下进详情页。
   */
  async function loadAllItems() {
    const grid = document.getElementById('all-grid');
    if (!grid) return;
    try {
      const { data } = await api.listItems({ limit: 200 });
      const items = data || [];
      const countEl = document.getElementById('all-count');
      if (countEl) countEl.textContent = items.length ? `共 ${items.length} 样` : '';

      if (!items.length) {
        grid.innerHTML = `<div class="xs muted" style="grid-column:1/-1;">还没有东西，拍一张存进来吧</div>`;
        return;
      }

      grid.innerHTML = items.map(itemCell).join('');
      grid.querySelectorAll('[data-item]').forEach((el) => {
        el.addEventListener('click', () => navigate(`/items/${el.dataset.item}`));
      });
    } catch (err) {
      grid.innerHTML = `<div class="xs muted" style="grid-column:1/-1;">没加载出来：${esc(err.message)}</div>`;
    }
  }

  /** 按分类：把分类直接铺出来，点一下就出结果（不用打字） */
  async function showCategoryPicker() {
    const body = document.getElementById('search-body');
    body.innerHTML = '<div class="loading"><span class="spinner"></span>正在列分类…</div>';
    try {
      const { data } = await api.listCategories();
      const list = (data || []).filter((c) => c.item_count > 0);
      const empty = (data || []).filter((c) => !c.item_count);

      if (!(data || []).length) {
        body.innerHTML = emptyCard('🏷️', '还没有分类', '拍点东西存进来，AI 会自动分类');
        return;
      }

      body.innerHTML = `
        <div class="section" style="margin-top:0;">
          <div class="section-head">
            <span class="section-title">点一个分类看东西</span>
            <span class="section-more">${list.length} 个有东西</span>
          </div>
          <div class="card">
            ${list
              .map(
                (c) => `
              <button class="row-item" data-cat="${c.id}" style="width:100%;text-align:left;">
                <span style="font-size:22px;">${esc(c.icon || '🏷️')}</span>
                <div class="grow">
                  <div style="font-weight:600;">${esc(c.name)}</div>
                  <div class="xs muted mt-1">${c.item_count} 样东西</div>
                </div>
                <span class="muted">›</span>
              </button>`
              )
              .join('')}
          </div>
        </div>
        ${
          empty.length
            ? `<div class="section">
                 <div class="section-head"><span class="section-title">空分类</span></div>
                 <div class="chip-row">
                   ${empty.map((c) => `<span class="chip chip-grey">${esc(c.icon || '🏷️')} ${esc(c.name)}</span>`).join('')}
                 </div>
               </div>`
            : ''
        }
      `;

      body.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => doSearch('', 'category', false, el.dataset.cat));
      });
    } catch (err) {
      body.innerHTML = emptyCard('😵', '分类没加载出来', err.message);
    }
  }

  /** 按标签：同样铺成可点列表 */
  async function showTagPicker() {
    const body = document.getElementById('search-body');
    body.innerHTML = '<div class="loading"><span class="spinner"></span>正在列标签…</div>';
    try {
      const { data } = await api.listTags();
      const list = (data || []).filter((t) => t.item_count > 0);
      if (!list.length) {
        body.innerHTML = emptyCard('🔖', '还没有标签', '存东西的时候 AI 会顺手打上标签');
        return;
      }

      body.innerHTML = `
        <div class="section" style="margin-top:0;">
          <div class="section-head">
            <span class="section-title">点一个标签看东西</span>
            <span class="section-more">${list.length} 个标签</span>
          </div>
          <div class="card" style="padding:var(--s-4);">
            <div class="chip-row">
              ${list
                .map(
                  (t) => `<button class="chip" data-tag="${esc(t.name)}"># ${esc(t.name)}
                    <span class="muted">${t.item_count}</span></button>`
                )
                .join('')}
            </div>
          </div>
        </div>
      `;

      body.querySelectorAll('[data-tag]').forEach((el) => {
        el.addEventListener('click', () => {
          input.value = el.dataset.tag;
          syncClear();
          doSearch(el.dataset.tag, 'tag');
        });
      });
    } catch (err) {
      body.innerHTML = emptyCard('😵', '标签没加载出来', err.message);
    }
  }
}

/** 统一的空状态卡片 */
function emptyCard(emoji, title, desc) {
  return `
    <div class="card">
      <div class="empty">
        <div class="emoji">${emoji}</div>
        <div class="title">${esc(title)}</div>
        <div class="desc">${esc(desc || '')}</div>
      </div>
    </div>`;
}

async function doSearch(q, mode = 'keyword', all = false, categoryId = null) {
  const body = document.getElementById('search-body');
  body.innerHTML = '<div class="loading"><span class="spinner"></span>正在找…</div>';

  // 记一笔搜索历史（「看看所有东西」不算，它不是关键词搜索）
  if (!all) rememberSearch(q);

  try {
    if (all) {
      const { data } = await api.listItems({ limit: 100 });
      renderResults(body, { items: data, query: '', type: 'keyword' });
      return;
    }
    const { data } = await api.search({
      q,
      type: mode,
      limit: 50,
      categoryId,
      // 位置筛选条选中的位置一起传过去
      spaceIds: placeFilter.spaceIds.join(','),
      locationIds: placeFilter.locationIds.join(','),
    });
    renderResults(body, data);
  } catch (err) {
    body.innerHTML = `
      <div class="card card-pad">
        <div class="sub small">没搜出来：${esc(err.message)}</div>
        <button class="btn btn-ghost btn-block mt-3" onclick="location.reload()">重试</button>
      </div>`;
  }
}

function renderResults(body, data) {
  // 语义搜索未接入：明确说明，不做假命中
  if (data.type === 'semantic' && data.available === false) {
    body.innerHTML = emptyCard('🧠', '语义搜索还没接入', data.message || '先试试直接用物品名或关键词搜');
    return;
  }

  const items = data.items || [];

  if (!items.length) {
    const filtered = placeFilter.spaceIds.length || placeFilter.locationIds.length;
    body.innerHTML = `
      <div class="card">
        <div class="empty">
          <div class="emoji">🔍</div>
          <div class="title">${filtered ? '这个位置里没找到' : `没找到「${esc(data.query || '')}」`}</div>
          <div class="desc">${
            filtered
              ? '换个位置看看，或者把位置筛选清掉再搜'
              : '换个说法试试，或者先拍照存进系统'
          }</div>
        </div>
        <div style="padding:0 var(--s-4) var(--s-4);">
          <button class="btn btn-primary btn-block" id="btn-snap-empty">📷 拍一张存起来</button>
        </div>
      </div>`;
    // 就地走统一拍照流程（先定位置再拍）—— 不跳中间页
    document.getElementById('btn-snap-empty')?.addEventListener('click', () => {
      startPhotoFlow();
    });
    return;
  }

  let html = `<div class="section" style="margin-top:0;">
    <div class="section-head">
      <span class="section-title">找到 ${items.length} 样东西</span>
      ${data.query ? `<span class="section-more">「${esc(data.query)}」</span>` : ''}
    </div>
    ${
      // 后端把「书房」「电视柜」这类位置词从查询里摘出来当过滤条件了。
      // 必须明确告诉用户「限定了这些地方」，不然他会以为搜索出错了。
      data.place_filter?.length
        ? `<div class="chip-row" style="margin-bottom:var(--s-3);">
             <span class="xs muted" style="align-self:center;margin-right:2px;">只找</span>
             ${data.place_filter.map((p) => `<span class="chip xs">📍 ${esc(p)}</span>`).join('')}
           </div>`
        : ''
    }
    ${
      // 用户自己在筛选条上点的位置 —— 也得说清楚「结果是限定过的」
      placeFilter.spaceIds.length || placeFilter.locationIds.length
        ? `<div class="xs muted" style="margin-bottom:var(--s-3);">
             结果已限定在所选位置内
           </div>`
        : ''
    }
    <div class="card" id="result-list"></div>
  </div>`;

  // 相关分类 / 标签 / 盒子：给用户第二种找法
  const sug = data.suggestions || {};
  const hasSug = (sug.categories?.length || 0) + (sug.tags?.length || 0) + (sug.containers?.length || 0) > 0;
  if (hasSug) {
    html += `<div class="section"><div class="section-head"><span class="section-title">你可能也在找</span></div><div class="chip-row">`;
    (sug.categories || []).forEach((c) => {
      html += `<button class="chip chip-grey" data-cat="${c.id}">${esc(c.icon || '🏷️')} ${esc(c.name)}</button>`;
    });
    (sug.tags || []).forEach((t) => {
      html += `<button class="chip chip-grey" data-tag="${esc(t.name)}"># ${esc(t.name)}</button>`;
    });
    (sug.containers || []).forEach((c) => {
      html += `<button class="chip chip-grey" data-box="${c.id}">📦 ${esc(c.name)}</button>`;
    });
    html += `</div></div>`;
  }

  body.innerHTML = html;

  const list = document.getElementById('result-list');
  list.innerHTML = items.map(resultRow).join('');

  list.querySelectorAll('[data-item]').forEach((el) => {
    el.addEventListener('click', () => navigate(`/items/${el.dataset.item}`));
  });

  body.querySelectorAll('[data-box]').forEach((el) => {
    el.addEventListener('click', () => navigate(`/boxes/${el.dataset.box}`));
  });
  body.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      const input = document.getElementById('q');
      if (input) input.value = el.dataset.tag;
      doSearch(el.dataset.tag, 'tag');
    });
  });
  body.querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', () => doSearch('', 'category', false, el.dataset.cat));
  });

  bindZoom(list); // 点缩略图看大图（不会误触进详情）
}

/**
 * 图片墙里的一个格子：正方形，只放图。
 * 没封面图时给个灰底相机占位，不然格子会塌掉、网格会错位。
 */
function itemCell(item) {
  const url = item.cover_thumb_url;
  const inner = url
    ? `<img src="${esc(url)}" alt="${esc(item.name || '')}" loading="lazy" decoding="async" />`
    : `<span class="item-cell-empty">📷</span>`;
  return `<button class="item-cell" data-item="${item.id}" aria-label="${esc(item.name || '')}">${inner}</button>`;
}

/**
 * 单条搜索结果。
 * 关键：位置是最重要的信息，所以路径放在显眼位置，
 * 并且「不在盒子里」的物品要明确标出来（否则用户照盒子找会扑空）。
 */
function resultRow(item) {
  const places = item.places || [];
  const inBoxPlaces = places.filter((p) => p.in_box);
  const loosePlaces = places.filter((p) => !p.in_box);

  // 【位置筛选时只显示命中的位置】
  // 一件东西可以同时在好几个地方（AA电池：客厅盒子08节 + 储藏室盒子08节）。
  // 用户选了「储藏室」筛选，如果下面还并列显示「客厅/电视柜/盒子02」，
  // 他会怀疑是不是筛错了。命中位置排前面，其余的折叠成一行「另外还有 N 处」。
  const filtering = placeFilter.spaceIds.length > 0 || placeFilter.locationIds.length > 0;
  const spaceIds = new Set(placeFilter.spaceIds.map(Number));
  const locationIds = new Set(placeFilter.locationIds.map(Number));
  const isHit = (p) =>
    spaceIds.has(Number(p.space_id)) || locationIds.has(Number(p.location_id));

  const hitPlaces = filtering ? inBoxPlaces.filter(isHit) : inBoxPlaces;
  const otherPlaces = filtering ? inBoxPlaces.filter((p) => !isHit(p)) : [];

  let locationHtml = '';
  if (hitPlaces.length) {
    locationHtml = hitPlaces
      .map(
        (p) => `
      <div class="flex gap-2" style="align-items:center;">
        ${pathHtml(p.full_path)}
        ${hitPlaces.length > 1 || p.quantity > 1 ? `<span class="chip chip-grey xs">${esc(fmtQty(p.quantity, item.unit))}</span>` : ''}
      </div>`
      )
      .join('');
  }

  // 没命中任何位置却还是被搜出来了 —— 说明它同时在别处有存量，
  // 这里只提示数量，不展开路径（路径属于别的位置，与本次筛选无关）
  const otherHtml = otherPlaces.length
    ? `<div class="xs muted mt-1">另外还有 ${otherPlaces.length} 处存放</div>`
    : '';

  const looseHtml = loosePlaces.length
    ? loosePlaces
        .map(
          (p) => `
      <div class="xs mt-1" style="color:#b26a00;">
        ⚠️ ${esc(p.note || STATUS_LABEL[p.status] || '不在盒子里')}
      </div>`
        )
        .join('')
    : '';

  const noPlace = !places.length ? `<div class="xs muted mt-1">还没有存放记录</div>` : '';

  return `
    <button class="row-item" data-item="${item.id}" style="width:100%;text-align:left;">
      ${thumbHtml(item.cover_thumb_url, { alt: item.name, cls: 'thumb', zoom: true })}
      <div class="grow" style="min-width:0;">
        <div class="flex gap-2" style="align-items:baseline;">
          <span style="font-weight:600;">${esc(item.name)}</span>
          ${item.category_name ? `<span class="xs muted">${esc(item.category_name)}</span>` : ''}
          ${item.need_confirm ? '<span class="chip chip-warn xs">待确认</span>' : ''}
        </div>
        <div class="mt-1">${locationHtml}${otherHtml}${looseHtml}${noPlace}</div>
      </div>
      <span class="muted">›</span>
    </button>`;
}
