import { api } from '../services/api.js';
import {
  esc,
  thumbHtml,
  pathHtml,
  toast,
  fmtQty,
  statusChipClass,
  STATUS_LABEL,
  openViewer,
  confirmSheet,
  pickSheet,
  timeAgo,
} from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 物品详情。
 * 这个页面要回答的核心问题是：这东西在哪儿？还有几件？在谁那儿？
 * 所以「所有存放位置」是页面的主体，而不是附属信息。
 */
export async function itemDetailPage({ app, params }) {
  const id = params.id;

  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title" id="hdr-title">物品</div>
        <button class="btn btn-ghost" id="btn-edit" style="height:34px;padding:0 12px;font-size:var(--f-sm);">编辑</button>
      </header>
      <div class="page-body" id="detail-body">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  renderBottomNav();

  let item = null;
  await load();

  async function load() {
    const body = document.getElementById('detail-body');
    try {
      const { data } = await api.getItem(id);
      item = data;
      render();
    } catch (err) {
      body.innerHTML = `
        <div class="card card-pad">
          <div class="sub small">没加载出来：${esc(err.message)}</div>
          <button class="btn btn-ghost btn-block mt-3" id="retry">重试</button>
        </div>`;
      document.getElementById('retry')?.addEventListener('click', load);
    }
  }

  function render() {
    document.getElementById('hdr-title').textContent = item.name;

    const places = item.places || [];
    const images = item.images || [];
    const cover = images[0];

    document.getElementById('detail-body').innerHTML = `
      <!-- 照片 -->
      ${
        cover
          ? `<img src="${esc(cover.thumb_url || cover.url)}" id="main-photo" alt="${esc(item.name)}"
               style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r-lg);background:var(--c-border);margin-bottom:var(--s-4);box-shadow:var(--sh-sm);" />`
          : `<div style="width:100%;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;background:var(--c-surface-soft);border:1px dashed var(--c-border-strong);border-radius:var(--r-lg);margin-bottom:var(--s-4);font-size:36px;">📷</div>`
      }

      <!-- 名称与基本信息 -->
      <div class="card card-pad">
        <div class="flex gap-2" style="align-items:baseline;flex-wrap:wrap;">
          <span style="font-size:var(--f-xl);font-weight:700;">${esc(item.name)}</span>
          ${
            item.need_confirm
              ? '<span class="chip chip-warn xs">待确认</span>'
              : ''
          }
        </div>

        <div class="chip-row mt-3">
          ${item.category_name ? `<span class="chip">${esc(item.category_icon || '🏷️')} ${esc(item.category_name)}</span>` : ''}
          ${item.brand ? `<span class="chip chip-grey">${esc(item.brand)}</span>` : ''}
          ${item.model ? `<span class="chip chip-grey">${esc(item.model)}</span>` : ''}
          ${item.color ? `<span class="chip chip-grey">${esc(item.color)}</span>` : ''}
          ${(item.tags || []).map((t) => `<span class="chip chip-grey"># ${esc(t.name)}</span>`).join('')}
        </div>

        ${item.description ? `<div class="sub small mt-3">${esc(item.description)}</div>` : ''}
      </div>

      <!-- 存放位置（本页核心） -->
      <div class="section">
        <div class="section-head">
          <span class="section-title">放在哪儿 ${places.length > 1 ? `（${places.length} 个地方）` : ''}</span>
          <button class="section-more" id="btn-add-place">＋ 加个位置</button>
        </div>
        ${
          places.length
            ? `<div class="card">${places.map(placeRow).join('')}</div>`
            : `<div class="card">
                 <div class="empty">
                   <div class="emoji">📍</div>
                   <div class="title">还没记录放在哪儿</div>
                   <div class="desc">点上面的「加个位置」告诉系统</div>
                 </div>
               </div>`
        }
        ${
          places.length > 1
            ? `<div class="xs muted mt-2" style="padding-left:var(--s-1);">
                 总共 ${esc(fmtQty(item.total_quantity, item.unit))}，分散在 ${places.length} 个地方
               </div>`
            : ''
        }
      </div>

      <!-- 数量与状态 -->
      <div class="section">
        <div class="card card-pad">
          <div class="flex between">
            <div>
              <div class="xs muted">总数量</div>
              <div style="font-size:var(--f-xl);font-weight:700;margin-top:2px;">
                ${esc(fmtQty(item.total_quantity, item.unit))}
              </div>
            </div>
            <div style="text-align:right;">
              <div class="xs muted">整体状态</div>
              <div class="mt-1">
                <span class="chip ${statusChipClass(item.status)}">${esc(STATUS_LABEL[item.status] || item.status)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 全部照片 -->
      ${
        images.length > 1
          ? `<div class="section">
               <div class="section-head"><span class="section-title">全部照片</span></div>
               <div class="photo-grid" id="photo-wall">
                 ${images
                   .map(
                     (p) => `<img src="${esc(p.thumb_url || p.url)}" alt="物品照片" loading="lazy" data-full="${esc(p.url)}" />`
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="section">
        <div class="xs muted" style="text-align:center;">
          添加于 ${esc(String(item.created_at || '').slice(0, 10))} · 更新于 ${esc(timeAgo(item.updated_at))}
        </div>
        <button class="btn btn-secondary btn-block mt-4" id="btn-delete" style="color:#b42318;">删除这个物品</button>
      </div>
    `;

    bind();
  }

  function placeRow(p) {
    if (p.in_box) {
      return `
        <button class="row-item" data-box="${p.container_id}" style="width:100%;text-align:left;">
          <span style="font-size:22px;">📦</span>
          <div class="grow" style="min-width:0;">
            <div class="flex gap-2" style="align-items:baseline;">
              <span style="font-weight:600;">${esc(p.container_name || '')}</span>
              <span class="chip chip-grey xs">${esc(fmtQty(p.quantity, item.unit))}</span>
            </div>
            <div class="mt-1">${pathHtml(p.full_path)}</div>
          </div>
          <span class="muted">›</span>
        </button>`;
    }
    // 不在盒子里：借出 / 在家使用 / 在车里 ……
    return `
      <div class="row-item" style="align-items:flex-start;">
        <span style="font-size:22px;">🚩</span>
        <div class="grow" style="min-width:0;">
          <div class="flex gap-2" style="align-items:baseline;">
            <span style="font-weight:600;">${esc(STATUS_LABEL[p.status] || '不在盒子里')}</span>
            <span class="chip chip-warn xs">${esc(fmtQty(p.quantity, item.unit))}</span>
          </div>
          ${p.note ? `<div class="xs mt-1" style="color:#b26a00;">${esc(p.note)}</div>` : ''}
        </div>
      </div>`;
  }

  function bind() {
    const body = document.getElementById('detail-body');

    document.getElementById('main-photo')?.addEventListener('click', () => {
      const c = (item.images || [])[0];
      if (c) openViewer(c.url);
    });

    body.querySelectorAll('[data-box]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/boxes/${el.dataset.box}`));
    });

    body.querySelectorAll('#photo-wall img').forEach((img) => {
      img.addEventListener('click', () => openViewer(img.dataset.full || img.src));
    });

    document.getElementById('btn-edit').addEventListener('click', showEdit);
    document.getElementById('btn-add-place').addEventListener('click', addPlace);
    document.getElementById('btn-delete').addEventListener('click', removeItem);
  }

  /** 编辑：名称/分类/数量/状态/标签 —— AI 给的全部可改 */
  async function showEdit() {
    let categories = [];
    try {
      const { data } = await api.listCategories();
      categories = data || [];
    } catch {
      /* 拿不到分类也不影响编辑 */
    }

    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">编辑物品</div>

        <div class="field">
          <label>名称</label>
          <input class="input" id="e-name" value="${esc(item.name)}" />
        </div>

        <div class="field">
          <label>分类</label>
          <input class="input" id="e-category" list="cat-list" value="${esc(item.category_name || '')}" placeholder="选一个或直接输入" />
          <datalist id="cat-list">
            ${categories.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}
          </datalist>
        </div>

        <div class="field">
          <label>标签（逗号分隔）</label>
          <input class="input" id="e-tags" value="${esc((item.tags || []).map((t) => t.name).join(', '))}" placeholder="比如：USB-C, 数据线" />
        </div>

        <div class="field">
          <label>整体状态</label>
          <select class="select" id="e-status">
            ${Object.entries(STATUS_LABEL)
              .map(([k, v]) => `<option value="${k}" ${item.status === k ? 'selected' : ''}>${v}</option>`)
              .join('')}
          </select>
        </div>

        <div class="field">
          <label>备注</label>
          <textarea class="textarea" id="e-desc" placeholder="随手记点什么">${esc(item.description || '')}</textarea>
        </div>

        <div class="flex gap-3 mt-4">
          <button class="btn btn-secondary grow" data-act="cancel">取消</button>
          <button class="btn btn-primary grow" data-act="save">保存</button>
        </div>
      </div>`;

    mask.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel' || e.target === mask) return mask.remove();
      if (act !== 'save') return;

      const name = mask.querySelector('#e-name').value.trim();
      if (!name) return toast('名称不能为空', true);

      const tags = mask
        .querySelector('#e-tags')
        .value.split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        await api.updateItem(item.id, {
          name,
          category: mask.querySelector('#e-category').value.trim(),
          tags,
          status: mask.querySelector('#e-status').value,
          description: mask.querySelector('#e-desc').value.trim(),
          needConfirm: false,
        });
        mask.remove();
        toast('改好了');
        await load();
      } catch (err) {
        toast(err.message, true);
      }
    });

    document.body.appendChild(mask);
  }

  /** 新增一个存放位置 —— 让「同一物品多处存放」用起来顺手 */
  async function addPlace() {
    let containers = [];
    try {
      const { data } = await api.listContainers();
      containers = data || [];
    } catch (err) {
      return toast(err.message, true);
    }

    const picked = await pickSheet(
      '放到哪个盒子',
      containers.map((c) => ({ value: c.id, label: c.name, desc: c.full_path, icon: c.code })),
      { emptyText: '还没有盒子' }
    );
    if (!picked) return;

    const qtyStr = prompt('放几个？', '1');
    if (qtyStr === null) return;
    const quantity = Number(qtyStr);
    if (!Number.isFinite(quantity) || quantity <= 0) return toast('数量要填个正数', true);

    try {
      await api.addStock({ itemId: item.id, containerId: Number(picked), quantity });
      toast('位置加好了');
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function removeItem() {
    const yes = await confirmSheet(
      '删除物品',
      `「${item.name}」的所有存放记录都会被移除，确定吗？`,
      '删除',
      { danger: true }
    );
    if (!yes) return;
    try {
      await api.deleteItem(item.id);
      toast('已删除');
      // 回到来时的页面，而不是硬跳到搜索页 ——
      // 从盒子详情点进来的话，用户还想回到那个盒子继续整理。
      // 兜底：直接刷新页面打开的（没有上一页）才去搜索页。
      if (window.history.length > 1) {
        history.back();
      } else {
        navigate('/search');
      }
    } catch (err) {
      toast(err.message, true);
    }
  }
}
