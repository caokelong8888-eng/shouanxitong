import { api } from '../services/api.js';
import { esc, toast } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/** 新建 / 编辑盒子 */
export async function boxNewPage({ app, query, params }) {
  renderBottomNav();

  const editId = params?.id ? Number(params.id) : null;

  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title">${editId ? '编辑盒子' : '新建盒子'}</div>
      </header>
      <div class="page-body" id="body">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  let spaces = [];
  let locations = [];
  let existing = null;

  try {
    const [s, l] = await Promise.all([api.listSpaces(), api.listLocations()]);
    spaces = s.data || [];
    locations = l.data || [];
    if (editId) {
      const { data } = await api.getContainer(editId);
      existing = data;
    }
  } catch (err) {
    document.getElementById('body').innerHTML = `<div class="card card-pad sub small">${esc(err.message)}</div>`;
    return;
  }

  // 自动取下一个盒号，用户不用自己想编号
  let autoCode = existing?.code || '';
  if (!editId) {
    try {
      const { data } = await api.nextContainerCode();
      autoCode = data.code;
    } catch {
      /* 拿不到就让用户自己填 */
    }
  }

  const preselectedSpace = query?.spaceId ? Number(query.spaceId) : existing?.space_id ?? null;
  const preselectedLocation = query?.locationId ? Number(query.locationId) : existing?.location_id ?? null;

  render();

  function render() {
    const spaceOptions = spaces
      .map((s) => `<option value="${s.id}" ${String(preselectedSpace) === String(s.id) ? 'selected' : ''}>${esc(s.icon || '')} ${esc(s.name)}</option>`)
      .join('');

    document.getElementById('body').innerHTML = `
      <div class="card card-pad">
        <div class="field">
          <label>盒子名字</label>
          <input class="input" id="f-name" value="${esc(existing?.name || '')}" placeholder="比如：盒子03 / 透明收纳盒" />
        </div>

        <div class="field">
          <label>编号（贴在盒子上的号）</label>
          <input class="input" id="f-code" value="${esc(autoCode)}" placeholder="B03" />
          <div class="xs muted mt-1">扫码找盒子就靠它，一般不用改</div>
        </div>

        <div class="field">
          <label>放在哪个空间</label>
          <select class="select" id="f-space">
            <option value="">暂不指定</option>
            ${spaceOptions}
          </select>
        </div>

        <div class="field">
          <label>具体在哪个家具 / 区域</label>
          <select class="select" id="f-location">
            <option value="">暂不指定</option>
          </select>
        </div>

        <div class="field">
          <label>更细的位置（可选）</label>
          <input class="input" id="f-detail" value="${esc(existing?.detail || '')}" placeholder="比如：第二层" />
        </div>

        <div class="field">
          <label>备注（可选）</label>
          <textarea class="textarea" id="f-note" placeholder="随手记点什么">${esc(existing?.note || '')}</textarea>
        </div>

        <button class="btn btn-primary btn-lg btn-block mt-4" id="f-save">
          ${editId ? '保存修改' : '建好这个盒子'}
        </button>
      </div>

      <div class="card card-pad mt-4">
        <div class="xs muted" style="line-height:1.7;">
          💡 盒子建好后，可以给它拍张照片、生成二维码打印出来贴上去。<br />
          以后盒子搬位置了，只改这里就行，里面的东西会自动跟着走。
        </div>
      </div>
    `;

    const spaceSel = document.getElementById('f-space');
    const locSel = document.getElementById('f-location');

    function refreshLocations() {
      const sid = spaceSel.value;
      const list = sid ? locations.filter((l) => String(l.space_id) === String(sid)) : locations;
      locSel.innerHTML =
        `<option value="">暂不指定</option>` +
        list
          .map((l) => `<option value="${l.id}" ${String(preselectedLocation) === String(l.id) ? 'selected' : ''}>${esc(l.name)}</option>`)
          .join('');
    }
    refreshLocations();
    spaceSel.addEventListener('change', refreshLocations);

    document.getElementById('f-save').addEventListener('click', save);
  }

  async function save() {
    const name = document.getElementById('f-name').value.trim();
    const code = document.getElementById('f-code').value.trim();
    const spaceId = document.getElementById('f-space').value || null;
    const locationId = document.getElementById('f-location').value || null;
    const detail = document.getElementById('f-detail').value.trim();
    const note = document.getElementById('f-note').value.trim();

    if (!name) return toast('给盒子起个名字吧', true);

    const btn = document.getElementById('f-save');
    btn.disabled = true;
    btn.textContent = '保存中…';

    const payload = {
      name,
      code: code || undefined,
      spaceId: spaceId ? Number(spaceId) : null,
      locationId: locationId ? Number(locationId) : null,
      detail: detail || null,
      note: note || null,
    };

    try {
      if (editId) {
        await api.updateContainer(editId, payload);
        toast('改好了');
        navigate(`/boxes/${editId}`);
      } else {
        const { data } = await api.createContainer(payload);
        toast(`${data.name} 建好了`);
        // 新建完直接进盒子，用户可以马上往里放东西
        navigate(`/boxes/${data.id}`);
      }
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = editId ? '保存修改' : '建好这个盒子';
    }
  }
}
