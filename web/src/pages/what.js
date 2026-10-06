import { api } from '../services/api.js';
import { compressImage } from '../services/image-compress.js';
import { esc, thumbHtml, toast, pickSheet, bindZoom, zoomAttr } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 「这是什么？」—— 独立于入库流程的识别入口。
 * 拿起一个不认识的东西拍一下，AI 说说这是啥、干什么用的。
 * 用户可以选择「存进收纳库」或「只看看不保存」。
 */
export async function whatPage({ app }) {
  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title">这是什么？</div>
      </header>

      <div class="page-body">
        <div class="card" style="padding:var(--s-5);text-align:center;background:linear-gradient(160deg,#eef7fc 0%,#eaf7f7 100%);border:1px solid #dcefee;">
          <div style="font-size:38px;line-height:1;">🤔</div>
          <div style="font-weight:600;margin-top:var(--s-3);font-size:var(--f-lg);">拿个不认识的东西拍一下</div>
          <div class="sub small mt-1">AI 会告诉你它是什么、能用来干嘛</div>
          <button class="btn btn-primary btn-lg btn-block mt-4" id="btn-snap">拍照识别</button>
        </div>

        <input type="file" id="file" accept="image/*" capture="environment" class="hidden" />

        <div id="result" class="section hidden"></div>
      </div>
    </div>
  `;

  renderBottomNav();

  document.getElementById('btn-snap').addEventListener('click', () => document.getElementById('file').click());
  document.getElementById('file').addEventListener('change', onPick);
}

let lastResult = null;

async function onPick(e) {
  const picked = e.target.files?.[0];
  e.target.value = '';
  if (!picked) return;

  const resultBox = document.getElementById('result');
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = '<div class="loading"><span class="spinner"></span>正在看这张图…</div>';

  try {
    // 手机原图 3~5MB，这条线路传不动，先压再传（AI 只需要看清东西长什么样）
    const file = await compressImage(picked);
    const up = await api.uploadImage(file);
    const imageId = up.data.id;

    const { data } = await api.whatIsThis(imageId);
    lastResult = { ...data, imageId };
    render(data);
  } catch (err) {
    resultBox.innerHTML = `
      <div class="card card-pad">
        <div class="chip chip-danger xs">没认出来</div>
        <div class="sub small mt-2">${esc(err.message)}</div>
        <div class="flex gap-2 mt-3">
          <button class="btn btn-ghost grow" id="retry">重新拍照</button>
        </div>
      </div>`;
    document.getElementById('retry')?.addEventListener('click', () => document.getElementById('file').click());
  }
}

function render(r) {
  const box = document.getElementById('result');
  box.innerHTML = `
    <div class="card">
      <img src="${esc(r.thumbUrl || r.url)}"${zoomAttr(r.url || r.thumbUrl)} alt="识别结果" style="width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--c-border);cursor:zoom-in;" />
      <div class="card-pad">
        <div class="flex gap-2" style="align-items:baseline;flex-wrap:wrap;">
          <span style="font-size:var(--f-lg);font-weight:700;">${esc(r.name || '认不出来')}</span>
          ${r.needConfirm ? '<span class="chip chip-warn xs">AI 也不太确定</span>' : ''}
          ${
            r.confidence !== undefined
              ? `<span class="chip chip-grey xs">把握 ${Math.round((r.confidence || 0) * 100)}%</span>`
              : ''
          }
        </div>

        ${r.category ? `<div class="chip-row mt-3"><span class="chip">🏷️ ${esc(r.category)}</span></div>` : ''}

        ${
          r.usage || r.description
            ? `<div class="section" style="margin-top:var(--s-4);">
                 <div class="xs muted" style="margin-bottom:4px;">这看起来像…</div>
                 <div class="small" style="line-height:1.7;">${esc(r.usage || r.description)}</div>
               </div>`
            : ''
        }

        ${
          (r.tags || []).length
            ? `<div class="chip-row mt-3">${(r.tags || []).map((t) => `<span class="chip chip-grey xs">${esc(t)}</span>`).join('')}</div>`
            : ''
        }

        ${
          (r.related || []).length
            ? `<div class="section" style="margin-top:var(--s-4);">
                 <div class="xs muted" style="margin-bottom:6px;">可能和这些一起出现</div>
                 <div class="chip-row">${(r.related || []).map((t) => `<span class="chip chip-grey">${esc(t)}</span>`).join('')}</div>
               </div>`
            : ''
        }
      </div>
    </div>

    <div class="section">
      <button class="btn btn-primary btn-lg btn-block" id="btn-save">📦 存进我的收纳库</button>
      <button class="btn btn-secondary btn-block mt-3" id="btn-again">再拍一个</button>
    </div>
  `;

  document.getElementById('btn-again').addEventListener('click', () => {
    box.classList.add('hidden');
    document.getElementById('file').click();
  });

  document.getElementById('btn-save').addEventListener('click', saveToLibrary);

  bindZoom(box); // 点识别结果大图看原图
}

/** 存进库：选一个盒子，然后复用批量入库接口 */
async function saveToLibrary() {
  if (!lastResult) return;

  let containers = [];
  try {
    const { data } = await api.listContainers();
    containers = data || [];
  } catch (err) {
    return toast(err.message, true);
  }

  if (!containers.length) {
    toast('还没有盒子，先去建一个');
    return navigate('/boxes/new');
  }

  const picked = await pickSheet(
    '存进哪个盒子',
    containers.map((c) => ({ value: c.id, label: c.name, desc: c.full_path, icon: c.code }))
  );
  if (!picked) return;

  try {
    const { data } = await api.batchInbound({
      containerId: Number(picked),
      items: [
        {
          imageIds: [lastResult.imageId],
          name: lastResult.name,
          category: lastResult.category,
          tags: lastResult.tags || [],
          quantity: lastResult.quantity || 1,
          unit: lastResult.unit,
          description: lastResult.description || lastResult.usage,
          brand: lastResult.brand,
          model: lastResult.model,
          color: lastResult.color,
          confidence: lastResult.confidence,
          needConfirm: lastResult.needConfirm,
        },
      ],
    });
    toast('存好了');
    navigate(`/boxes/${data.containerId}`);
  } catch (err) {
    toast(err.message, true);
  }
}
