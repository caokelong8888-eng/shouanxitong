import { api } from '../services/api.js';
import { esc, thumbHtml, toast, pickSheet, confirmSheet, STATUS_LABEL, bindZoom } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';
import { openCamera, takePendingFiles, peekPendingMark, clearPendingMark } from '../services/camera.js';

/**
 * 入库页（/inbound）——「拍照 → 确认 → 放进盒子」的后半段。
 *
 * 用户不会主动走到这个页面：它是点底部「＋」拍完照之后自动落地的界面。
 * 所以这里不摆任何"开始拍照"的入口卡片，直接就是结果。
 *
 * 流程：
 *   照片已在相机页拍好 → 上传（带进度）→ AI 逐张识别
 *   → 快速改名称/分类/数量 → 选盒子 → 批量入库
 *
 * 两种进入方式都会走到这：
 *   1. 底部加号拍照（照片在 camera.js 的 pendingFiles 里）
 *   2. 盒子详情点「往这里放」（预选好盒子，再拍）
 */

const state = {
  photos: [], // { id, thumbUrl, url, file, status, result, error }
  containerId: null,
  containerName: null,
  busy: false,
};

export async function inboundPage({ app, query }) {
  // 每次进入重置状态，避免上一次的残留
  state.photos = [];
  state.containerId = null;
  state.containerName = null;
  state.busy = false;

  // 从盒子详情进来时预选盒子，省一次点击
  const preferredId = query?.containerId || sessionStorage.getItem('preferredContainerId') || '';
  if (preferredId) {
    state.containerId = Number(preferredId);
    sessionStorage.removeItem('preferredContainerId');
    // 名字稍后异步补上，先占位
    state.containerName = '';
  }

  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title">放进去</div>
      </header>

      <div class="page-body">
        <!-- 空状态：直接进来（没照片）时给个兜底，不做成主入口 -->
        <div class="card hidden" id="empty-card" style="padding:var(--s-6);text-align:center;">
          <div style="font-size:34px;line-height:1;">📷</div>
          <div class="sub small mt-3" id="empty-text">还没有照片</div>
          <button class="btn btn-primary btn-block mt-4" id="btn-camera-empty">拍一张</button>
        </div>

        <!-- 拍照结果区 -->
        <div class="section hidden" id="photo-section" style="margin-top:0;">
          <div class="section-head">
            <span class="section-title">已拍 <span id="photo-count">0</span> 张</span>
            <div class="flex gap-3">
              <button class="section-more" id="btn-add-more">＋ 再拍</button>
              <button class="section-more" id="btn-clear-photos">清空</button>
            </div>
          </div>
          <div class="photo-grid" id="photo-grid"></div>
          <div id="upload-progress" class="mt-3 hidden">
            <div class="flex between xs muted"><span>上传中…</span><span id="progress-text">0%</span></div>
            <div style="height:6px;background:var(--c-border);border-radius:var(--r-full);overflow:hidden;margin-top:6px;">
              <div id="progress-bar" style="height:100%;width:0;background:var(--c-primary);transition:width .2s;"></div>
            </div>
          </div>
        </div>

        <!-- AI 识别结果区 -->
        <div class="section hidden" id="result-section">
          <div class="section-head">
            <span class="section-title">AI 认出来的东西</span>
            <span class="section-more" id="recognize-progress"></span>
          </div>
          <div id="result-list"></div>
        </div>

        <!-- 选盒子 + 提交 -->
        <div class="section hidden" id="submit-section">
          <div class="card card-pad">
            <div class="flex between">
              <div class="grow">
                <div class="xs muted">放进哪个盒子</div>
                <div id="chosen-box" style="font-weight:600;margin-top:2px;">还没选</div>
              </div>
              <button class="btn btn-ghost" id="btn-pick-box">选择</button>
            </div>
          </div>
          <button class="btn btn-primary btn-lg btn-block mt-4" id="btn-submit" disabled>全部放进去</button>
        </div>
      </div>
    </div>
  `;

  renderBottomNav();

  document.getElementById('btn-add-more').addEventListener('click', () => {
    openCamera({
      onDone: (files) => {
        if (files.length) handleFiles(files);
      },
    });
  });
  document.getElementById('btn-camera-empty').addEventListener('click', () => {
    openCamera({
      onDone: (files) => {
        if (files.length) handleFiles(files);
      },
    });
  });

  document.getElementById('btn-clear-photos').addEventListener('click', async () => {
    if (state.photos.length) {
      const yes = await confirmSheet(
        '清空照片',
        `这 ${state.photos.length} 张照片会全部丢掉，AI 认出来的结果也会一起没。确定吗？`,
        '清空',
        { danger: true }
      );
      if (!yes) return;
    }
    state.photos.forEach((p) => {
      if (p.localUrl) URL.revokeObjectURL(p.localUrl);
    });
    state.photos = [];
    const prog = document.getElementById('recognize-progress');
    if (prog) prog.textContent = '';
    renderPhotos();
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('submit-section').classList.add('hidden');
    document.getElementById('empty-card').classList.remove('hidden');
  });

  document.getElementById('btn-pick-box').addEventListener('click', pickBox);
  document.getElementById('btn-submit').addEventListener('click', submitAll);

  // 拍好的照片从 camera.js 取过来，直接开始上传识别
  const files = takePendingFiles();
  if (files?.length) {
    handleFiles(files);
    if (state.containerId) restorePreferredBox();
  } else {
    // 再也拿不到照片了，但标记显示刚才拍过 —— 说明中途切页面丢掉了，得说清楚
    const lost = peekPendingMark();
    clearPendingMark();
    const text = document.getElementById('empty-text');
    if (lost?.count && text) {
      text.innerHTML = `刚才拍的 <b>${lost.count}</b> 张照片没能留住<br><span class="xs muted">切到别的页面会把还没入库的照片丢掉，拍完要接着往下走</span>`;
    }
    document.getElementById('empty-card').classList.remove('hidden');
  }
}

/** 盒子详情带过来的预选盒子：补上名字和路径 */
async function restorePreferredBox() {
  try {
    const { data } = await api.listContainers();
    const c = (data || []).find((x) => Number(x.id) === Number(state.containerId));
    if (!c) return;
    state.containerName = c.name;
    const el = document.getElementById('chosen-box');
    if (el) el.innerHTML = `${esc(c.name)} <span class="xs muted">${esc(c.full_path || '')}</span>`;
  } catch {
    /* 拿不到就算了，用户还能手动选 */
  }
}

/* ---------------- 拍照 ---------------- */

/** 把选好的文件加入队列并开始上传 */
async function handleFiles(files) {
  if (state.busy) {
    toast('正在处理上一批，稍等一下');
    return;
  }
  state.busy = true;
  document.getElementById('empty-card').classList.add('hidden');

  // 先本地预览出来，用户能立刻看到自己的照片，不用等上传
  const startIdx = state.photos.length;
  files.forEach((f) => {
    state.photos.push({
      file: f,
      localUrl: URL.createObjectURL(f),
      thumbUrl: URL.createObjectURL(f),
      status: 'pending',
      result: null,
    });
  });
  renderPhotos();
  showProgress(true);
  setProgress(0);

  try {
    // 一次性批量上传，比逐张传更快也更稳
    const { data } = await api.uploadBatch(files, { onProgress: setProgress });

    (data.images || []).forEach((img, i) => {
      const p = state.photos[startIdx + i];
      if (p) {
        p.id = img.id;
        p.url = img.url;
        p.thumbUrl = img.thumb_url || img.url;
        p.status = 'uploaded';
      }
    });

    // 上传失败的单独标出来，不影响成功的那些
    if (data.failed?.length) {
      data.failed.forEach((f, i) => {
        const p = state.photos[startIdx + (data.images?.length || 0) + i];
        if (p) {
          p.status = 'failed';
          p.error = f.message;
        }
      });
    }

    renderPhotos();

    const ids = state.photos.filter((p) => p.id).map((p) => p.id);
    if (!ids.length) throw new Error('图片都没传上去');

    showProgress(false);
    await recognizePhotos(ids);
  } catch (err) {
    showProgress(false);
    toast(err.message, true);
    // 保留已拍的本地预览，让用户能重试 —— 「不要因为一次网络错误让用户重新拍一遍」
    state.photos.forEach((p) => {
      if (!p.id) p.status = 'failed';
    });
    renderPhotos();
    const section = document.getElementById('photo-section');
    if (!section.querySelector('#retry-upload')) {
      const btn = document.createElement('button');
      btn.id = 'retry-upload';
      btn.className = 'btn btn-ghost btn-block mt-3';
      btn.textContent = '重新上传这些照片';
      btn.addEventListener('click', retryUpload);
      section.appendChild(btn);
    }
  } finally {
    state.busy = false;
  }
}

/** 上传失败后重试：只重传没成功的那些 */
async function retryUpload() {
  const pending = state.photos.filter((p) => !p.id && p.file);
  if (!pending.length) return toast('没有需要重传的照片');
  if (state.busy) return;
  state.busy = true;
  showProgress(true);
  try {
    const { data } = await api.uploadBatch(
      pending.map((p) => p.file),
      { onProgress: setProgress }
    );
    (data.images || []).forEach((img, i) => {
      const p = pending[i];
      p.id = img.id;
      p.url = img.url;
      p.thumbUrl = img.thumb_url || img.url;
      p.status = 'uploaded';
    });
    document.getElementById('retry-upload')?.remove();
    renderPhotos();
    showProgress(false);
    await recognizePhotos(state.photos.filter((p) => p.id).map((p) => p.id));
  } catch (err) {
    showProgress(false);
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

function showProgress(show) {
  document.getElementById('upload-progress').classList.toggle('hidden', !show);
}

function setProgress(pct) {
  const bar = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = `${pct}%`;
}

/* ---------------- 识别 ---------------- */

/**
 * 逐张识别，并发 2 路。
 *
 * 【为什么改】
 * 原来是把所有 id 一次性丢给后端，后端串行 for 循环逐张 await。
 * 实测单张 2.0~14.3 秒、5 张串行 34.6 秒，而前端只有一个整块转圈 ——
 * 用户盯着 35 秒会以为卡死了，然后反复点「重新识别」或者干脆退出去。
 *
 * 【怎么改】
 * 一次只发 2 个请求，第 1 张认完立刻出结果，用户马上就能开始改名字，
 * 不用等最后那张。识别中的卡片上直接显示「正在认 2/5」。
 * 单张失败只影响那一张，其它张照常。
 *
 * 后端 /api/recognize 的单张接口本来就是现成的，这里只是前端编排变了。
 */
const RECOGNIZE_CONCURRENCY = 2;

async function recognizePhotos(ids) {
  const section = document.getElementById('result-section');
  const list = document.getElementById('result-list');
  section.classList.remove('hidden');
  list.innerHTML = `<div class="loading"><span class="spinner"></span>AI 正在认，稍等一会儿…</div>`;

  // 队列里先放全部，done 计数用来显示「正在认 3/5」
  const queue = ids.map((id) => ({ id, done: false }));
  const total = queue.length;
  let finished = 0;

  const renderProgress = () => {
    const el = document.getElementById('recognize-progress');
    if (!el) return;
    if (finished >= total) {
      el.textContent = `AI 认完了 ${total} 张`;
      return;
    }
    el.textContent = `正在认 ${Math.min(finished + 1, total)}/${total} 张…`;
  };

  const recognizeOne = async (entry) => {
    const p = state.photos.find((x) => x.id === entry.id);
    try {
      const { data } = await api.recognize(entry.id);
      const r = data.results?.[0] || data;
      if (r?.status === 'ok' || r?.result) {
        if (p) {
          p.status = 'recognized';
          p.result = r.result || r;
        }
      } else if (p) {
        p.status = 'error';
        p.error = r?.error || '还是没认出来';
      }
    } catch (err) {
      if (p) {
        p.status = 'error';
        p.error = err.message;
      }
    } finally {
      entry.done = true;
      finished += 1;
      renderProgress();
      // 一张出结果就重画一次：用户能马上看到、能马上改
      renderPhotos();
      renderResults();
    }
  };

  renderProgress();

  // worker 池：始终保持 RECOGNIZE_CONCURRENCY 个在跑
  const worker = async () => {
    while (true) {
      const entry = queue.shift();
      if (!entry) return;
      await recognizeOne(entry);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(RECOGNIZE_CONCURRENCY, total) }, () => worker())
  );

  // 全部跑完，把「清空」按钮和无用的进度文案收掉
  const prog = document.getElementById('recognize-progress');
  if (prog) prog.textContent = total ? `AI 认完了 ${total} 张` : '';

  renderPhotos();
  renderResults();
}

/* ---------------- 渲染 ---------------- */

function renderPhotos() {
  const section = document.getElementById('photo-section');
  const grid = document.getElementById('photo-grid');
  const count = document.getElementById('photo-count');
  if (!section) return;

  section.classList.toggle('hidden', state.photos.length === 0);
  count.textContent = String(state.photos.length);

  grid.innerHTML = state.photos
    .map((p, i) => {
      const badge =
        p.status === 'failed'
          ? '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(239,68,68,.55);color:#fff;font-size:20px;border-radius:var(--r-sm);">!</span>'
          : '';
      return `
        <div style="position:relative;">
          ${thumbHtml(p.thumbUrl, { alt: `第${i + 1}张`, zoom: true, fullUrl: p.localUrl || p.url || p.thumbUrl })}
          ${badge}
        </div>`;
    })
    .join('');

  // 照片区域用网格铺满，覆盖默认 thumb 尺寸
  grid.querySelectorAll('img').forEach((img) => {
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.aspectRatio = '1';
    img.style.objectFit = 'cover';
  });

  bindZoom(grid); // 点照片看大图
}

function renderResults() {
  const section = document.getElementById('result-section');
  const list = document.getElementById('result-list');
  // 「上传完但还在排队等 AI」的照片也要占个位，
  // 否则用户会以为照片丢了 —— 尤其现在改成逐张出结果，中间会有等待间隙。
  const pending = state.photos.filter((p) => p.status === 'uploaded');
  const recognizable = state.photos.filter((p) => p.status === 'recognized' || p.status === 'error');
  if (!recognizable.length && !pending.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  // 【必须保住正在输入的框】
  // 改成了逐张并发识别之后，每认完一张就会整块重画。
  // 如果这时候用户正在改上一张的名字，光标会被重画冲掉、输入的字也会丢。
  // 所以重画前记住「哪一行的哪个字段」，画完还原回去。
  const active = document.activeElement;
  let refocus = null;
  if (active && list.contains(active) && active.dataset?.field) {
    refocus = { row: active.closest('[data-row]')?.dataset.row, field: active.dataset.field, pos: active.selectionStart };
  }

  list.innerHTML = `<div class="card">${pending.map(pendingCard).join('')}${recognizable.map(resultCard).join('')}</div>`;
  bindResultEvents();
  bindZoom(list); // 识别结果里的照片也能点开看

  if (refocus?.row) {
    const next = list.querySelector(`[data-row="${refocus.row}"] [data-field="${refocus.field}"]`);
    if (next) {
      next.focus();
      const pos = typeof refocus.pos === 'number' ? refocus.pos : next.value.length;
      try {
        next.setSelectionRange(pos, pos);
      } catch {
        /* number 类型 input 不支持选区，忽略 */
      }
    }
  }

  updateSubmitState();
}

/** 还在排队的照片：给个明确状态，别让用户以为卡住了 */
function pendingCard(p) {
  return `
    <div class="card-pad" style="border-bottom:1px solid var(--c-border);" data-row="${p.id}">
      <div class="flex gap-3" style="align-items:center;">
        ${thumbHtml(p.thumbUrl, { alt: '待识别', cls: 'thumb', zoom: true, fullUrl: p.localUrl || p.url || p.thumbUrl })}
        <div class="grow">
          <div class="flex gap-2" style="align-items:center;">
            <span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>
            <span class="small" style="font-weight:600;">AI 正在认这张…</span>
          </div>
          <div class="xs muted mt-1">不用等它，别的照片可以先改</div>
        </div>
        <button class="row-del" data-drop="${p.id}" aria-label="不要这张">🗑️</button>
      </div>
    </div>`;
}

/**
 * 结果卡片右上角的「不要这张」。
 * 连拍难免有拍糊的、手挡住的 —— 以前只能硬给它编个名字存进库，
 * 现在可以整张丢掉不入库。
 */
function dropButton(id) {
  return `<button class="row-del" data-drop="${id}" aria-label="不要这张"
            style="position:absolute;top:8px;right:8px;width:30px;height:30px;flex-shrink:0;">✕</button>`;
}

function resultCard(p) {
  const r = p.result;

  if (p.status === 'error') {
    return `
      <div class="card-pad" style="border-bottom:1px solid var(--c-border);position:relative;">
        ${dropButton(p.id)}
        <div class="flex gap-3">
          ${thumbHtml(p.thumbUrl, { alt: '照片', cls: 'thumb', zoom: true, fullUrl: p.localUrl || p.url || p.thumbUrl })}
          <div class="grow">
            <div class="chip chip-danger xs">暂时认不出来</div>
            <div class="xs muted mt-1">${esc(p.error || '这张图 AI 没看懂')}</div>
            <div class="flex gap-2 mt-3">
              <button class="chip chip-grey" data-retry="${p.id}">重新识别</button>
              <button class="chip chip-grey" data-manual="${p.id}">手动填写</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="card-pad" style="border-bottom:1px solid var(--c-border);position:relative;" data-row="${p.id}">
      ${dropButton(p.id)}
      <div class="flex gap-3" style="align-items:flex-start;">
        ${thumbHtml(p.thumbUrl, { alt: r.name, cls: 'thumb', zoom: true, fullUrl: p.localUrl || p.url || p.thumbUrl })}
        <div class="grow" style="min-width:0;padding-right:26px;">
          <div class="flex gap-2" style="align-items:baseline;">
            <input class="input" data-field="name" value="${esc(r.name)}"
                   style="padding:8px 10px;font-weight:600;border-radius:var(--r-sm);" />
          </div>
          <div class="flex gap-2 mt-2">
            <input class="input" data-field="category" value="${esc(r.category || '')}"
                   placeholder="分类" style="padding:7px 10px;font-size:var(--f-sm);border-radius:var(--r-sm);" />
            <input class="input" data-field="quantity" type="number" min="1" value="${esc(r.quantity ?? 1)}"
                   style="padding:7px 10px;font-size:var(--f-sm);border-radius:var(--r-sm);width:74px;flex-shrink:0;" />
            <input class="input" data-field="unit" value="${esc(r.unit || '')}" placeholder="单位"
                   style="padding:7px 10px;font-size:var(--f-sm);border-radius:var(--r-sm);width:64px;flex-shrink:0;" />
          </div>
          <div class="chip-row mt-2">
            ${(r.tags || []).map((t) => `<span class="chip chip-grey xs">${esc(t)}</span>`).join('')}
            ${r.needConfirm ? '<span class="chip chip-warn xs">AI 也不太确定</span>' : ''}
            ${
              r.confidence !== undefined && r.confidence !== null
                ? `<span class="chip chip-grey xs">把握 ${Math.round(r.confidence * 100)}%</span>`
                : ''
            }
          </div>
        </div>
      </div>
    </div>`;
}

function bindResultEvents() {
  const list = document.getElementById('result-list');

  // 输入即同步到 state —— AI 的结果只是建议，用户改什么就是什么
  list.querySelectorAll('[data-row]').forEach((row) => {
    const p = state.photos.find((x) => String(x.id) === row.dataset.row);
    if (!p?.result) return;
    row.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const f = input.dataset.field;
        if (f === 'quantity') p.result.quantity = Number(input.value) || 1;
        else p.result[f] = input.value;
        // 用户动过手就别再标「待确认」
        if (f === 'name' || f === 'category') p.result.needConfirm = false;
      });
    });
  });

  list.querySelectorAll('[data-retry]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.retry);
      btn.textContent = '识别中…';
      try {
        const { data } = await api.recognize(id);
        const p = state.photos.find((x) => x.id === id);
        const r = data.results?.[0] || data;
        if (r?.status === 'ok' || r?.result) {
          p.status = 'recognized';
          p.result = r.result || r;
        } else {
          toast(r?.error || '还是没认出来', true);
        }
      } catch (err) {
        toast(err.message, true);
      }
      renderResults();
    });
  });

  list.querySelectorAll('[data-manual]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.photos.find((x) => String(x.id) === btn.dataset.manual);
      p.status = 'recognized';
      p.result = { name: '', category: '待确认', tags: [], quantity: 1, unit: null, needConfirm: false };
      renderResults();
      // 聚焦到名称输入框，省一次点击
      const row = document.querySelector(`[data-row="${btn.dataset.manual}"]`);
      row?.querySelector('[data-field="name"]')?.focus();
    });
  });

  // 「不要这张」—— 从队列里踢掉，不入库。
  // 只是本地移除：服务端那张图片记录留着，交给每日清理任务收，
  // 免得用户反悔时已经传上去了、文件也删了找不回来。
  list.querySelectorAll('[data-drop]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropPhoto(Number(btn.dataset.drop));
    });
  });
}

/** 把一张照片从本次入库队列里移除 */
function dropPhoto(id) {
  const idx = state.photos.findIndex((x) => Number(x.id) === Number(id));
  if (idx === -1) return;
  const [p] = state.photos.splice(idx, 1);
  if (p?.localUrl) URL.revokeObjectURL(p.localUrl);
  if (p?.thumbUrl && p.thumbUrl !== p.localUrl) URL.revokeObjectURL(p.thumbUrl);

  const count = state.photos.length;
  document.getElementById('photo-count').textContent = String(count);
  renderPhotos();

  if (!count) {
    // 全删完了 → 回到空状态
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('submit-section').classList.add('hidden');
    document.getElementById('empty-card').classList.remove('hidden');
    return;
  }
  renderResults();
}

function updateSubmitState() {
  const section = document.getElementById('submit-section');
  const btn = document.getElementById('btn-submit');
  const hasItems = state.photos.some((p) => p.status === 'recognized' && p.result);
  section.classList.toggle('hidden', !hasItems);
  // 正在提交时不要把按钮重新放开
  if (btn && !state.busy) btn.disabled = !hasItems || !state.containerId;
}

/* ---------------- 选盒子 & 入库 ---------------- */

async function pickBox() {
  let containers = [];
  try {
    const { data } = await api.listContainers();
    containers = data || [];
  } catch (err) {
    return toast(err.message, true);
  }

  const picked = await pickSheet(
    '放进哪个盒子',
    containers.map((c) => ({ value: c.id, label: c.name, desc: c.full_path, icon: c.code })),
    { emptyText: '还没有盒子，先去建一个' }
  );

  if (picked === '__new') return;
  if (!picked) {
    // 用户取消选择时，如果还没有盒子，引导去新建
    if (!containers.length) navigate('/boxes/new');
    return;
  }

  const c = containers.find((x) => String(x.id) === String(picked));
  state.containerId = Number(picked);
  state.containerName = c?.name || '';
  document.getElementById('chosen-box').innerHTML =
    `${esc(c?.name || '')} <span class="xs muted">${esc(c?.full_path || '')}</span>`;
  updateSubmitState();
}

async function submitAll() {
  // 防连点要放在最前面：等算完再禁用，手快的人已经点了第二下
  const btn = document.getElementById('btn-submit');
  if (btn.disabled) return;

  const items = state.photos
    .filter((p) => p.status === 'recognized' && p.result)
    .map((p) => ({
      imageIds: [p.id],
      name: (p.result.name || '').trim(),
      category: p.result.category,
      tags: p.result.tags || [],
      quantity: Number(p.result.quantity) || 1,
      unit: p.result.unit,
      description: p.result.description,
      brand: p.result.brand,
      model: p.result.model,
      color: p.result.color,
      confidence: p.result.confidence,
      needConfirm: p.result.needConfirm,
    }))
    .filter((x) => x.name);

  if (!items.length) return toast('还有东西没填名称', true);
  if (!state.containerId) return toast('先选一个盒子', true);

  btn.disabled = true;
  btn.textContent = '正在放进去…';

  try {
    const { data } = await api.batchInbound({ containerId: state.containerId, items });
    toast(`放进去了 ${data.createdCount} 件东西`);
    if (data.failed?.length) {
      console.warn('部分失败', data.failed);
      toast(`有 ${data.failed.length} 件没存上`, true);
    }
    // 入库成功：照片已经落地，把本地预览的 objectURL 回收掉，别一直占内存
    state.photos.forEach((p) => {
      if (p.localUrl) URL.revokeObjectURL(p.localUrl);
    });
    clearPendingMark();
    // 直接跳到盒子详情，让用户看到结果
    navigate(`/boxes/${data.containerId}`);
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = '全部放进去';
  }
}
