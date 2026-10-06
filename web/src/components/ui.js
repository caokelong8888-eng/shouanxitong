/**
 * 通用 UI 小工具。
 * 保持极简：这些函数只负责拼 HTML 字符串与做 DOM 操作，
 * 不引入任何框架心智。
 */

/** HTML 转义，所有用户输入拼接前必须过一遍 */
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 物品状态 → 中文文案（与后端 STATUS_LABEL 保持一致） */
export const STATUS_LABEL = {
  in_box: '在盒子里',
  in_use: '在家使用',
  temp: '临时放置',
  lent: '借给别人',
  in_car: '在车里',
  discarded: '已丢弃',
  given_away: '已送人',
};

/** 物品状态 → 徽章样式 */
export function statusChipClass(status) {
  if (!status || status === 'in_box') return 'chip-grey';
  if (status === 'discarded' || status === 'given_away') return 'chip-danger';
  return 'chip-warn';
}

/** 底部轻提示 */
let toastTimer = null;
export function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  // 强制重绘，保证连续调用也有动画
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/** 相对时间：刚刚 / 5分钟前 / 昨天 / 3天前 */
export function timeAgo(input) {
  if (!input) return '';
  // 后端存的是 'YYYY-MM-DD HH:mm:ss' 本地时间，Safari 对横杠格式解析不稳，统一改成斜杠
  const t = new Date(String(input).replace(/-/g, '/')).getTime();
  if (Number.isNaN(t)) return String(input);
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 172800_000) return '昨天';
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 数字转友好单位展示：20 节 */
export function fmtQty(qty, unit) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return '';
  const num = Number.isInteger(n) ? n : Number(n.toFixed(2));
  return unit ? `${num} ${unit}` : String(num);
}

/** 生成缩略图 img 标签（懒加载 + 占位）
 *
 * zoom = true 时给图片打上 data-zoom，配合 bindZoom() 即可点击看大图。
 * fullUrl 用来指定放大后要显示的原图（默认与缩略图同地址）。
 */
export function thumbHtml(url, { size = 'thumb', alt = '', cls = 'thumb', zoom = false, fullUrl = '' } = {}) {
  const sizeCls = size === 'lg' ? 'thumb-lg' : '';
  if (!url) {
    return `<div class="${cls} ${sizeCls} thumb-empty">📷</div>`;
  }
  const zoomStyle = zoom ? ' style="cursor:zoom-in;"' : '';
  return `<img class="${cls} ${sizeCls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async"${zoom ? zoomAttr(url, fullUrl) : ''}${zoomStyle} />`;
}

/** 位置路径展示 */
export function pathHtml(text) {
  if (!text) return '<span class="path"><span class="pin">📍</span><span class="path-text muted">暂无位置</span></span>';
  return `<span class="path"><span class="pin">📍</span><span class="path-text">${esc(text)}</span></span>`;
}

/**
 * 全屏看大图。
 *
 * 交互（都为「想看清这张图到底是什么」服务）：
 *   - 点图片以外的黑色区域 / 右上角 ✕ → 关闭
 *   - 双击图片 → 原始尺寸与适屏来回切换
 *   - 双指捏合 / 滚轮 → 缩放
 *   - 放大后可拖动平移
 */
export function openViewer(url) {
  if (!url) return;

  const el = document.createElement('div');
  el.className = 'viewer';
  el.innerHTML = `
    <img src="${esc(url)}" alt="查看大图" />
    <button class="close" aria-label="关闭">✕</button>
    <div class="viewer-hint">双击放大 · 双指缩放</div>`;

  const img = el.querySelector('img');
  const HINT_MS = 2600;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let natural = false; // 是否处于「原始尺寸」状态

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const reset = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    natural = false;
    img.style.cursor = 'zoom-in';
    apply();
  };

  // ---- 滚轮缩放（桌面调试用） ----
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      scale = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 0.87)));
      if (scale === 1) {
        tx = 0;
        ty = 0;
      }
      apply();
    },
    { passive: false }
  );

  // ---- 双击切换原始尺寸 ----
  img.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (natural) {
      reset();
    } else {
      natural = true;
      scale = Math.max(1, (img.naturalWidth || 1) / (img.clientWidth || 1));
      scale = Math.min(scale, 8);
      tx = 0;
      ty = 0;
      img.style.cursor = 'zoom-out';
      apply();
    }
  });

  // ---- 拖拽平移 + 单指滑动 ----
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;

  const onDown = (e) => {
    const p = e.touches ? e.touches[0] : e;
    dragging = true;
    moved = false;
    startX = p.clientX - tx;
    startY = p.clientY - ty;
  };

  const onMove = (e) => {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const nx = p.clientX - startX;
    const ny = p.clientY - startY;
    if (Math.abs(nx - tx) > 4 || Math.abs(ny - ty) > 4) moved = true;
    if (scale > 1) {
      tx = nx;
      ty = ny;
      apply();
    }
  };

  const onUp = () => {
    dragging = false;
  };

  img.addEventListener('mousedown', onDown);
  img.addEventListener('touchstart', onDown, { passive: true });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);

  // ---- 双指捏合 ----
  let pinchStart = 0;
  let pinchScale = 1;

  img.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        pinchStart = dist(e.touches);
        pinchScale = scale;
      }
    },
    { passive: true }
  );

  img.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length === 2 && pinchStart) {
        const s = (pinchScale * dist(e.touches)) / pinchStart;
        scale = Math.min(6, Math.max(1, s));
        if (scale === 1) {
          tx = 0;
          ty = 0;
        }
        apply();
      }
    },
    { passive: true }
  );

  img.addEventListener('touchend', () => {
    pinchStart = 0;
  });

  // 单指轻点图片 → 不关闭（避免想看细节时误关）
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moved) return;
  });

  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchend', onUp);
    el.remove();
  };

  el.querySelector('.close').addEventListener('click', cleanup);
  el.addEventListener('click', (e) => {
    if (e.target === el) cleanup(); // 只有点到黑色背景才关
  });

  // 键盘 Esc 关闭
  const onKey = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      cleanup();
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(el);

  // 提示几秒后自动淡出
  setTimeout(() => el.querySelector('.viewer-hint')?.classList.add('fade'), HINT_MS);
}

function dist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy) || 1;
}

/**
 * 给一个容器里所有带 data-zoom 的图片挂上「点击看大图」。
 *
 * 【为什么要单独抽出来】
 * 之前只有盒子详情/物品详情能放大，首页、搜索、入库页点图片都没反应 ——
 * 用户不知道那张图到底拍成什么样。现在全 App 统一走这一条路。
 *
 * 【为什么用捕获阶段】
 * 缩略图常常嵌在「整行可点、点了跳详情」的按钮里。
 * 用捕获 + stopPropagation，保证点图片时只放大、不误跳详情；
 * 点卡片空白处依旧正常进详情。
 */
export function bindZoom(scope = document) {
  scope.querySelectorAll('[data-zoom]').forEach((img) => {
    if (img.dataset.zoomBound) return; // 防重复绑定
    img.dataset.zoomBound = '1';
    img.addEventListener(
      'click',
      (e) => {
        const url = img.dataset.zoom || img.dataset.full || img.currentSrc || img.src;
        if (!url) return;
        e.preventDefault();
        e.stopPropagation(); // 别让外面的「进详情」按钮也跟着响应
        openViewer(url);
      },
      true // 捕获阶段先拿到事件
    );
  });
}

/** 生成给 thumbHtml 用的放大属性（没有图就返回空串） */
export function zoomAttr(url, fullUrl) {
  if (!url) return '';
  const full = fullUrl || url;
  return ` data-zoom="${esc(full)}"`;
}

/**
 * 通用确认弹层（避免用原生 confirm 的丑陋样式）。
 *
 * danger = true 时确认按钮变红 —— 删除这类不可撤销的操作必须一眼看出是危险的。
 */
export function confirmSheet(title, message, confirmText = '确定', { danger = false } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = `
      <div class="sheet" style="border-radius:var(--r-xl);margin:auto;max-width:340px;">
        <div class="sheet-title">${esc(title)}</div>
        <p class="sub small" style="margin:0 0 var(--s-5);">${esc(message)}</p>
        <div class="flex gap-3">
          <button class="btn btn-secondary grow" data-act="cancel">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} grow" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    mask.style.alignItems = 'center';
    mask.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') {
        mask.remove();
        resolve(true);
      } else if (act === 'cancel' || e.target === mask) {
        mask.remove();
        resolve(false);
      }
    });
    document.body.appendChild(mask);
  });
}

/** 单行输入弹层：替代浏览器原生 prompt()，样式和其余弹层保持一致 */
export function inputSheet(title, { value = '', placeholder = '', confirmText = '保存', maxLength = 30 } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = `
      <div class="sheet" style="border-radius:var(--r-xl);margin:auto;max-width:340px;">
        <div class="sheet-title">${esc(title)}</div>
        <input class="input" id="sheet-input" value="${esc(value)}" placeholder="${esc(placeholder)}"
               maxlength="${Number(maxLength) || 30}" enterkeyhint="done"
               style="width:100%;text-align:center;font-size:var(--f-lg);font-weight:600;" />
        <div class="flex gap-3 mt-5">
          <button class="btn btn-secondary grow" data-act="cancel">取消</button>
          <button class="btn btn-primary grow" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    mask.style.alignItems = 'center';

    const input = mask.querySelector('#sheet-input');
    const finish = (v) => {
      mask.remove();
      resolve(v);
    };

    const submit = () => {
      const v = input.value.trim();
      if (!v) return toast('不能为空', true);
      finish(v);
    };

    mask.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') return submit();
      if (act === 'cancel' || e.target === mask) finish(null);
    });
    // 回车直接提交：手机上软键盘的「完成」键最顺手
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    document.body.appendChild(mask);
    input.focus();
    input.select();
  });
}

/** 单选底部弹层：用于「选择盒子」这类高频操作 */
export function pickSheet(title, options, { emptyText = '暂无可选项' } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    const list = options.length
      ? options
          .map(
            (o) => `
        <button class="row-item" data-id="${esc(o.value)}" style="width:100%;text-align:left;border-radius:var(--r-md);margin-bottom:6px;border:1px solid var(--c-border);">
          <div class="grow">
            <div style="font-weight:600;">${esc(o.label)}</div>
            ${o.desc ? `<div class="xs muted ellipsis">${esc(o.desc)}</div>` : ''}
          </div>
          ${o.icon ? `<span>${esc(o.icon)}</span>` : ''}
        </button>`
          )
          .join('')
      : `<div class="empty"><div class="emoji">📦</div><div class="desc">${esc(emptyText)}</div></div>`;

    mask.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">${esc(title)}</div>
        ${list}
        <button class="btn btn-secondary btn-block mt-4" data-act="cancel">取消</button>
      </div>`;
    mask.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn) {
        mask.remove();
        return resolve(btn.dataset.id);
      }
      if (e.target.closest('[data-act="cancel"]') || e.target === mask) {
        mask.remove();
        resolve(null);
      }
    });
    document.body.appendChild(mask);
  });
}
