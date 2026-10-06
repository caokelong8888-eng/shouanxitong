import { api } from '../services/api.js';
import { esc, thumbHtml, pathHtml, toast, bindZoom, zoomAttr } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 盒子列表 —— 查看所有现实中的收纳盒。
 * 卡片式，图片优先，点进去就是「盒子里面有什么」。
 */
export async function boxesPage({ app }) {
  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <div class="title">收纳盒</div>
        <button class="section-action" id="btn-new">＋ 新建</button>
      </header>

      <div class="page-body">
        <form class="search-bar" id="box-filter" style="height:46px;">
          <span class="icon">🔍</span>
          <input type="search" id="bq" placeholder="找盒子（名称 / 编号）" autocomplete="off" />
        </form>

        <div class="section" id="box-section" style="margin-top:var(--s-4);">
          <div class="loading"><span class="spinner"></span>加载中</div>
        </div>
      </div>
    </div>
  `;

  renderBottomNav();
  document.getElementById('btn-new').addEventListener('click', () => navigate('/boxes/new'));

  let all = [];
  const input = document.getElementById('bq');
  input.addEventListener('input', () => {
    const kw = input.value.trim().toLowerCase();
    const filtered = kw
      ? all.filter(
          (c) =>
            c.name.toLowerCase().includes(kw) ||
            c.code.toLowerCase().includes(kw) ||
            (c.full_path || '').toLowerCase().includes(kw)
        )
      : all;
    renderList(filtered);
  });

  await load();

  async function load() {
    const section = document.getElementById('box-section');
    try {
      const { data } = await api.listContainers();
      all = data || [];
      renderList(all);
    } catch (err) {
      section.innerHTML = `
        <div class="card card-pad">
          <div class="sub small">没加载出来：${esc(err.message)}</div>
          <button class="btn btn-ghost btn-block mt-3" id="retry">重试</button>
        </div>`;
      document.getElementById('retry')?.addEventListener('click', load);
    }
  }

  function renderList(list) {
    const section = document.getElementById('box-section');
    if (!list.length) {
      section.innerHTML = `
        <div class="card">
          <div class="empty">
            <div class="emoji">📦</div>
            <div class="title">${all.length ? '没找到这个盒子' : '还没有盒子'}</div>
            <div class="desc">${all.length ? '换个词试试' : '建一个盒子，就能往里放东西了'}</div>
          </div>
          ${
            all.length
              ? ''
              : `<div style="padding:0 var(--s-4) var(--s-4);">
                   <button class="btn btn-primary btn-block" onclick="location.hash='#/boxes/new'">建第一个盒子</button>
                 </div>`
          }
        </div>`;
      return;
    }

    section.innerHTML = `
      <div class="section-head">
        <span class="section-title">共 ${list.length} 个盒子</span>
      </div>
      <div class="box-grid">
        ${list.map(boxCard).join('')}
      </div>`;

    section.querySelectorAll('[data-box]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/boxes/${el.dataset.box}`));
    });

    bindZoom(section); // 点封面图看大图（不会误触进详情）
  }
}

function boxCard(c) {
  const count = c.item_kind_count || 0;
  const total = c.item_total_qty || 0;
  // 三列下位置文字只剩两三行，全路径太长会被压成省略号看不出在哪。
  // 只留最后两段（「书房 / 柜子A」这种），第一段「客厅」去掉了反而更好认 —— 想看全的进详情页。
  const tailPath = String(c.full_path || '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join(' / ');
  return `
    <button data-box="${c.id}" class="box-card">
      ${
        c.cover_thumb_url
          ? `<img src="${esc(c.cover_thumb_url)}"${zoomAttr(c.cover_thumb_url)} alt="${esc(c.name)}" loading="lazy" />`
          : '<div class="box-card-noimg">📦</div>'
      }
      <div class="box-card-body">
        <div class="box-card-top">
          <span class="box-card-name">${esc(c.name)}</span>
          <span class="box-card-code">${esc(c.code)}</span>
        </div>
        <div class="box-card-path">${esc(tailPath || '还没设置位置')}</div>
        ${
          count
            ? `<div class="box-card-count">${count} 种 · ${total} 件</div>`
            : '<div class="box-card-count is-empty">空盒子</div>'
        }
      </div>
    </button>`;
}
