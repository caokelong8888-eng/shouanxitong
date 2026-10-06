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
  bindZoom,
} from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';
import { openCamera } from '../services/camera.js';

/**
 * 盒子详情 —— 查看「这个盒子里面有什么」。
 *
 * 首屏最重要的三件事：
 *   1. 盒子的现实照片（确认「对，就是这个盒子」）
 *   2. 它在哪儿（完整路径）
 *   3. 里面装了什么（带缩略图的物品列表）
 */
export async function boxDetailPage({ app, params }) {
  const id = params.id;
  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title" id="hdr-title">盒子</div>
        <button class="btn btn-ghost" id="btn-menu" style="height:34px;padding:0 12px;font-size:var(--f-sm);">⋯</button>
      </header>
      <div class="page-body" id="detail-body">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  renderBottomNav();

  let box = null;

  await load();

  async function load() {
    const body = document.getElementById('detail-body');
    try {
      const { data } = await api.getContainer(id);
      box = data;
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
    document.getElementById('hdr-title').textContent = box.name;

    const items = box.items || [];
    const photos = box.images || [];

    // 盒子照片墙：盒子自己的照片 + 里面东西的照片
    const ownPhotos = photos.filter((p) => p.source === 'container');
    const itemPhotos = photos.filter((p) => p.source !== 'container');

    document.getElementById('detail-body').innerHTML = `
      <!-- 盒子名 + 位置（放在照片上方，一眼看清「这是哪个盒子、在哪」） -->
      <div style="margin-bottom:var(--s-3);">
        <div class="flex gap-2" style="align-items:baseline;">
          <span style="font-size:var(--f-xl);font-weight:700;">${esc(box.name)}</span>
          <span class="chip chip-grey">${esc(box.code)}</span>
        </div>
        <div class="mt-2">${pathHtml(box.full_path)}</div>
        ${box.note ? `<div class="xs muted mt-2">${esc(box.note)}</div>` : ''}
      </div>

      <!-- 盒子封面大图 -->
      ${
        ownPhotos.length
          ? `<img src="${esc(ownPhotos[0].thumb_url || ownPhotos[0].url)}" alt="${esc(box.name)}"
               id="box-cover"
               style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r-lg);background:var(--c-border);margin-bottom:var(--s-4);box-shadow:var(--sh-sm);" />`
          : `<div id="box-cover-add" style="width:100%;aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:var(--c-surface-soft);border:1px dashed var(--c-border-strong);border-radius:var(--r-lg);margin-bottom:var(--s-4);color:var(--c-text-muted);">
               <span style="font-size:32px;">📷</span>
               <span class="small">拍一张盒子照片，找的时候一眼认出来</span>
             </div>`
      }

      <!-- 里面的东西 -->
      <div class="section">
        <div class="section-head">
          <span class="section-title">里面的东西 ${items.length ? `(${items.length})` : ''}</span>
          <button class="section-more" id="btn-add-here">＋ 往这里放</button>
        </div>
        ${
          items.length
            ? `<div class="card">
                 ${items
                   .map(
                     (it) => `
                   <div class="row-item row-item-actions">
                     <button class="row-main" data-item="${it.item_id}">
                       ${thumbHtml(it.cover_thumb_url, { alt: it.item_name, zoom: true, fullUrl: it.cover_url })}
                       <div class="grow" style="min-width:0;">
                         <div class="flex gap-2" style="align-items:baseline;">
                           <span style="font-weight:600;">${esc(it.item_name)}</span>
                           ${
                             it.item_status && it.item_status !== 'in_box'
                               ? `<span class="chip ${statusChipClass(it.item_status)} xs">${esc(STATUS_LABEL[it.item_status] || it.item_status)}</span>`
                               : ''
                           }
                         </div>
                         <div class="xs muted mt-1">
                           ${esc(fmtQty(it.quantity, it.unit))}
                           ${it.category_name ? ` · ${esc(it.category_name)}` : ''}
                         </div>
                       </div>
                     </button>
                     <button class="row-del" data-del-item="${it.item_id}" data-name="${esc(it.item_name)}"
                             aria-label="删除${esc(it.item_name)}">🗑️</button>
                   </div>`
                   )
                   .join('')}
               </div>`
            : `<div class="card">
                 <div class="empty">
                   <div class="emoji">🫙</div>
                   <div class="title">这个盒子还是空的</div>
                   <div class="desc">拍照往里放点东西吧</div>
                 </div>
               </div>`
        }
      </div>

      <!-- 照片墙 -->
      ${
        itemPhotos.length
          ? `<div class="section">
               <div class="section-head"><span class="section-title">里面的东西长这样</span></div>
               <div class="photo-grid" id="photo-wall">
                 ${itemPhotos
                   .map(
                     (p) =>
                       `<img src="${esc(p.thumb_url || p.url)}" alt="${esc(p.item_name || '物品照片')}" loading="lazy" data-full="${esc(p.url)}" />`
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="section">
        <div class="xs muted" style="text-align:center;">
          最后更新 ${esc(box.updated_at || '')}
        </div>
      </div>
    `;

    bind();
  }

  function bind() {
    const body = document.getElementById('detail-body');

    // 点盒子封面看大图
    const cover = document.getElementById('box-cover');
    if (cover) {
      const own = (box.images || []).find((p) => p.source === 'container');
      cover.addEventListener('click', () => openViewer(own?.url || cover.src));
    }

    // 没有封面 → 点一下去传
    document.getElementById('box-cover-add')?.addEventListener('click', () => uploadBoxPhoto());

    // 点物品主体 → 进详情
    body.querySelectorAll('[data-item]').forEach((el) => {
      el.addEventListener('click', () => navigate(`/items/${el.dataset.item}`));
    });

    // 点垃圾桶 → 就地删掉，不用进详情
    body.querySelectorAll('[data-del-item]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeItemFromBox(el.dataset.delItem, el.dataset.name);
      });
    });

    body.querySelectorAll('#photo-wall img').forEach((img) => {
      img.addEventListener('click', () => openViewer(img.dataset.full || img.src));
    });

    bindZoom(body); // 里面的东西缩略图也能点开看

    document.getElementById('btn-add-here')?.addEventListener('click', () => {
      // 就地唤起相机，拍完带着照片去入库页 —— 不先跳页面，否则浏览器会拦掉弹窗
      openCamera({
        onDone: (files) => {
          if (!files.length) return; // 用户取消了
          navigate(`/inbound?containerId=${box.id}`);
        },
      });
    });

    document.getElementById('btn-menu')?.addEventListener('click', showMenu);
  }

  /**
   * 就地删除一件物品。
   *
   * 注意语义：这里是「彻底删掉这个东西」，不是「从盒子里拿出来」。
   * 所以确认文案要说清楚它所有存放记录都会没，避免用户以为只是移出盒子。
   */
  async function removeItemFromBox(itemId, name) {
    const yes = await confirmSheet(
      '删除物品',
      `「${name}」会从收纳库里彻底删掉，所有存放记录都会没有。确定吗？`,
      '删除',
      { danger: true }
    );
    if (!yes) return;

    try {
      await api.deleteItem(itemId);
      toast('已删除');
      await load(); // 重新拉一次，列表立刻少一条
    } catch (err) {
      toast(err.message, true);
    }
  }

  /** 给盒子拍/传一张照片 */
  async function uploadBoxPhoto() {    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      toast('正在上传…');
      try {
        await api.uploadImage(file, { containerId: box.id });
        toast('盒子照片已保存');
        await load();
      } catch (err) {
        toast(err.message, true);
      }
    });
    input.click();
  }

  /** 二维码：现场展示，方便截图打印贴到盒子上 */
  async function showQr() {
    try {
      const { data } = await api.containerQrcode(box.id);
      const mask = document.createElement('div');
      mask.className = 'sheet-mask';
      mask.style.alignItems = 'center';
      mask.innerHTML = `
        <div class="sheet" style="border-radius:var(--r-xl);max-width:340px;text-align:center;">
          <div class="sheet-title" style="margin-bottom:var(--s-2);">${esc(box.name)} 的二维码</div>
          <p class="xs muted" style="margin:0 0 var(--s-4);">打印出来贴到盒子上，以后扫一下就知道里面有啥</p>
          <img src="${esc(data.data_url)}" alt="二维码" style="width:220px;height:220px;margin:0 auto;border-radius:var(--r-md);" />
          <div class="xs muted mt-3" style="word-break:break-all;">${esc(data.scan_url)}</div>
          <button class="btn btn-primary btn-block mt-5" data-act="close">知道了</button>
        </div>`;
      mask.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="close"]') || e.target === mask) mask.remove();
      });
      document.body.appendChild(mask);
    } catch (err) {
      toast(err.message, true);
    }
  }

  /** 移动盒子 —— 只改盒子自己，里面的物品自动跟随 */
  async function moveBox() {
    let spaces = [];
    let locations = [];
    try {
      const [s, l] = await Promise.all([api.listSpaces(), api.listLocations()]);
      spaces = s.data || [];
      locations = l.data || [];
    } catch (err) {
      return toast(err.message, true);
    }

    // 第一步：选空间
    const spaceId = await pickSheet(
      '移到哪个空间',
      spaces.map((s) => ({ value: s.id, label: s.name, desc: `${s.container_count || 0} 个盒子`, icon: s.icon })),
      { emptyText: '还没有空间，先去建一个' }
    );
    if (!spaceId) return;

    // 第二步：选区域（可以跳过）
    const locs = locations.filter((l) => String(l.space_id) === String(spaceId));
    let locationId = null;
    if (locs.length) {
      const picked = await pickSheet(
        '具体放在哪里（可跳过）',
        [{ value: '__skip', label: '不指定，就放这个空间', desc: '' }, ...locs.map((l) => ({ value: l.id, label: l.name, desc: `${l.container_count || 0} 个盒子` }))]
      );
      if (picked === null) return; // 取消
      if (picked !== '__skip') locationId = Number(picked);
    }

    try {
      await api.updateContainer(box.id, { spaceId: Number(spaceId), locationId });
      toast('位置改好了，里面的东西跟着一起搬过去了');
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function showMenu() {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">${esc(box.name)}</div>
        <button class="row-item" data-act="rename" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
          <span style="font-size:20px;">✏️</span><div class="grow">改名字 / 备注</div>
        </button>
        <button class="row-item" data-act="photo" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
          <span style="font-size:20px;">📷</span><div class="grow">拍盒子照片</div>
        </button>
        <button class="row-item" data-act="move" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
          <span style="font-size:20px;">📍</span><div class="grow">改位置</div>
        </button>
        <button class="row-item" data-act="qr" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;">
          <span style="font-size:20px;">📱</span><div class="grow">二维码</div>
        </button>
        <button class="row-item" data-act="delete" style="width:100%;text-align:left;border-radius:var(--r-md);border:1px solid var(--c-border);margin-bottom:6px;color:#b42318;">
          <span style="font-size:20px;">🗑️</span><div class="grow">删除这个盒子</div>
        </button>
        <button class="btn btn-secondary btn-block mt-3" data-act="cancel">取消</button>
      </div>`;

    mask.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel' || e.target === mask) return mask.remove();
      mask.remove();

      if (act === 'photo') return uploadBoxPhoto();
      if (act === 'move') return moveBox();
      if (act === 'qr') return showQr();

      if (act === 'rename') {
        const name = prompt('新的盒子名字', box.name);
        if (name === null) return;
        if (!name.trim()) return toast('名字不能为空', true);
        try {
          await api.updateContainer(box.id, { name: name.trim() });
          toast('改好了');
          load();
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }

      if (act === 'delete') {
        const yes = await confirmSheet('删除盒子', `删除后，里面的物品会从盒子里移除。确定删除「${box.name}」吗？`, '删除', { danger: true });
        if (!yes) return;
        try {
          await api.deleteContainer(box.id);
          toast('盒子已删除');
          navigate('/boxes');
        } catch (err) {
          toast(err.message, true);
        }
      }
    });

    document.body.appendChild(mask);
  }
}
