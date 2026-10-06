import { api } from '../services/api.js';
import { esc, thumbHtml, toast, pickSheet, fmtQty } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 手动新增物品（AI 不灵时的兜底）。
 * 也可以作为「我就想快速录一件东西」的捷径。
 */
export async function itemNewPage({ app, query }) {
  renderBottomNav();

  let categories = [];
  let containers = [];
  try {
    const [c, b] = await Promise.all([api.listCategories(), api.listContainers()]);
    categories = c.data || [];
    containers = b.data || [];
  } catch {
    /* 拿不到也能用，分类可手输 */
  }

  // 从盒子详情点进来时，预选那个盒子
  const preferred = query?.containerId || sessionStorage.getItem('preferredContainerId') || '';

  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title">手动添加</div>
      </header>
      <div class="page-body">
        <div class="card card-pad">
          <div class="field">
            <label>名称 *</label>
            <input class="input" id="f-name" placeholder="这是什么" />
          </div>

          <div class="field">
            <label>分类</label>
            <input class="input" id="f-category" list="cat-list" placeholder="选一个或直接输入" />
            <datalist id="cat-list">${categories.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
          </div>

          <div class="flex gap-3">
            <div class="field grow">
              <label>数量</label>
              <input class="input" id="f-qty" type="number" min="1" value="1" />
            </div>
            <div class="field grow">
              <label>单位</label>
              <input class="input" id="f-unit" placeholder="个 / 条 / 节" />
            </div>
          </div>

          <div class="field">
            <label>放进哪个盒子</label>
            <select class="select" id="f-box">
              <option value="">暂不放盒子</option>
              ${containers
                .map((c) => `<option value="${c.id}" ${String(preferred) === String(c.id) ? 'selected' : ''}>${esc(c.name)} · ${esc(c.full_path || '')}</option>`)
                .join('')}
            </select>
          </div>

          <div class="field">
            <label>标签（逗号分隔）</label>
            <input class="input" id="f-tags" placeholder="比如：USB-C, 数据线" />
          </div>

          <div class="field">
            <label>备注</label>
            <textarea class="textarea" id="f-desc" placeholder="随手记点什么"></textarea>
          </div>

          <button class="btn btn-primary btn-lg btn-block mt-4" id="f-save">保存</button>
        </div>

        <div class="card card-pad mt-4">
          <div class="xs muted">💡 想让 AI 帮你认，回到「添加」页拍照就行。</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('f-save').addEventListener('click', save);

  async function save() {
    const name = document.getElementById('f-name').value.trim();
    if (!name) return toast('名称不能为空', true);

    const tags = document
      .getElementById('f-tags')
      .value.split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const boxId = document.getElementById('f-box').value;

    const btn = document.getElementById('f-save');
    btn.disabled = true;
    btn.textContent = '保存中…';

    try {
      const { data } = await api.createItem({
        name,
        category: document.getElementById('f-category').value.trim(),
        quantity: Number(document.getElementById('f-qty').value) || 1,
        unit: document.getElementById('f-unit').value.trim() || null,
        containerId: boxId ? Number(boxId) : null,
        tags,
        description: document.getElementById('f-desc').value.trim() || null,
      });
      sessionStorage.removeItem('preferredContainerId');
      toast('存好了');

      // 有盒子就回盒子详情，让用户马上看到东西在里面
      const place = (data.places || []).find((p) => p.in_box);
      if (place) navigate(`/boxes/${place.container_id}`);
      else navigate(`/items/${data.id}`);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = '保存';
    }
  }
}
