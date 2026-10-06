import { api } from '../services/api.js';
import { esc, thumbHtml, pathHtml, timeAgo, toast, bindZoom } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 首页。
 * 第一眼只有两样东西：大搜索框、最近盒子。
 * 不做仪表盘，不堆统计数字 —— 打开就是「找东西」。
 * 存东西统一走底部导航的「＋」，首页不再放重复的拍照按钮。
 */
export async function homePage({ app }) {
  app.innerHTML = `
    <div class="page">
      <div class="hero">
        <h1>家庭收纳</h1>
        <p>记录家里的东西是什么、放在哪里</p>
      </div>

      <div class="page-body" style="padding-top:0;">
        <!-- 最大的搜索框 —— 首页第一操作 -->
        <form class="search-bar" id="home-search">
          <span class="icon">🔍</span>
          <input
            type="search"
            id="q"
            placeholder="搜索你要找的东西"
            autocomplete="off"
            enterkeyhint="search"
          />
        </form>

        <div class="chip-row mt-3" id="quick-tags"></div>

        <!-- 家里的整体情况：放在上面而不是页面底部 ——
             底部那位置正好被悬浮的「＋」压着，数字根本看不清 -->
        <div class="section" id="stats-section" style="display:none;margin-top:var(--s-4);">
          <div class="card card-pad">
            <div class="stats-grid" id="stats-inner"></div>
          </div>
        </div>

        <!-- 拍照入口统一收在底部导航的「＋」里，首页不再重复放按钮 -->

        <div class="section">
          <div class="section-head">
            <span class="section-title">最近放进去的</span>
            <!-- 新建盒子放首页：想加盒子时不用先切到「盒子」页 -->
            <button class="section-action" id="btn-new-box">＋ 新建</button>
          </div>
          <div id="recent-boxes">
            <div class="loading"><span class="spinner"></span>加载中</div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderBottomNav();

  // 搜索：直接跳搜索页并带上关键词
  const form = document.getElementById('home-search');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  });

  app.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });

  // 新建盒子：直接跳新建页，不用先切到「盒子」标签
  document.getElementById('btn-new-box').addEventListener('click', () => navigate('/boxes/new'));

  // 常用搜索词：点一下就搜，省去打字
  renderQuickTags();

  // 加载最近内容
  loadRecent();
}

function renderQuickTags() {
  const words = ['电池', '数据线', 'HDMI', '充电头', '工具'];
  const box = document.getElementById('quick-tags');
  box.innerHTML = words.map((w) => `<button class="chip chip-grey" data-q="${esc(w)}">${esc(w)}</button>`).join('');
  box.querySelectorAll('[data-q]').forEach((b) => {
    b.addEventListener('click', () => navigate(`/search?q=${encodeURIComponent(b.dataset.q)}`));
  });
}

async function loadRecent() {
  const box = document.getElementById('recent-boxes');
  try {
    const { data } = await api.overview();
    const containers = data.recentContainers || [];

    if (!containers.length) {
      box.innerHTML = `
        <div class="card">
          <div class="empty">
            <div class="emoji">📦</div>
            <div class="title">还没有盒子</div>
            <div class="desc">先建一个盒子，再往里拍照存东西</div>
          </div>
          <div style="padding:0 var(--s-4) var(--s-4);">
            <button class="btn btn-primary btn-block" onclick="location.hash='#/boxes/new'">建第一个盒子</button>
          </div>
        </div>`;
      return;
    }

    box.innerHTML = `<div class="card">${containers.map(containerRow).join('')}</div>`;

    box.querySelectorAll('[data-box]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/boxes/${el.dataset.box}`));
    });

    bindZoom(box); // 点缩略图看大图（不会误触进详情）

    renderStats(data.counts);
  } catch (err) {
    box.innerHTML = `
      <div class="card card-pad">
        <div class="sub small">内容没加载出来：${esc(err.message)}</div>
        <button class="btn btn-ghost btn-block mt-3" id="retry-recent">重试</button>
      </div>`;
    document.getElementById('retry-recent')?.addEventListener('click', () => {
      box.innerHTML = '<div class="loading"><span class="spinner"></span>加载中</div>';
      loadRecent();
    });
  }
}

function containerRow(c) {
  const count = c.item_kind_count || 0;
  const total = c.item_total_qty || 0;
  return `
    <button class="row-item" data-box="${c.id}" style="width:100%;text-align:left;">
      ${thumbHtml(c.cover_thumb_url, { alt: c.name, zoom: true })}
      <div class="grow" style="min-width:0;">
        <div class="flex gap-2" style="align-items:baseline;">
          <span style="font-weight:600;">${esc(c.name)}</span>
          <span class="xs muted">${esc(c.code)}</span>
        </div>
        <div class="mt-1">${pathHtml(c.full_path)}</div>
        ${
          count
            ? `<div class="xs mt-1" style="color:var(--c-primary);font-weight:600;">${count} 种 · ${total} 件</div>`
            : '<div class="xs muted mt-1">还是空的</div>'
        }
      </div>
      <span class="muted">›</span>
    </button>`;
}

function renderStats(counts) {
  if (!counts) return;
  const section = document.getElementById('stats-section');
  const inner = document.getElementById('stats-inner');
  section.style.display = 'block';
  const cells = [
    { n: counts.containers, l: '个盒子' },
    { n: counts.items, l: '种东西' },
    { n: counts.pieces, l: '件总数' },
    { n: counts.spaces, l: '个空间' },
  ];
  inner.innerHTML = cells
    .map(
      (c) => `
      <div class="stats-cell">
        <div class="stats-num">${c.n ?? 0}</div>
        <div class="xs muted">${c.l}</div>
      </div>`
    )
    .join('');
}
