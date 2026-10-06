import { api } from '../services/api.js';
import { esc, toast, confirmSheet } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/** 分类管理：看每个分类下有多少东西，能加、能删 */
export async function categoriesPage({ app }) {
  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <button class="back-btn" onclick="history.back()">‹</button>
        <div class="title">分类管理</div>
        <button class="btn btn-ghost" id="btn-new" style="height:34px;padding:0 12px;font-size:var(--f-sm);">＋ 新建</button>
      </header>
      <div class="page-body" id="body">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  renderBottomNav();
  document.getElementById('btn-new').addEventListener('click', create);

  await load();

  async function load() {
    const body = document.getElementById('body');
    try {
      const { data } = await api.listCategories();
      body.innerHTML = `
        <div class="card">
          ${data
            .map(
              (c) => `
            <div class="row-item">
              <span style="font-size:20px;">${esc(c.icon || '🏷️')}</span>
              <div class="grow">
                <div style="font-weight:600;">${esc(c.name)}</div>
                <div class="xs muted">${c.item_count || 0} 种东西</div>
              </div>
              ${
                c.is_system
                  ? '<span class="chip chip-grey xs">预置</span>'
                  : `<button class="chip chip-grey" data-del="${c.id}" data-name="${esc(c.name)}">删除</button>`
              }
            </div>`
            )
            .join('')}
        </div>
        <div class="xs muted mt-3" style="padding-left:var(--s-1);line-height:1.7;">
          分类是 AI 识别时自动建出来的。你可以随时改名或删掉多余的。
        </div>
      `;

      body.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const yes = await confirmSheet('删除分类', `确定删除「${btn.dataset.name}」吗？`, '删除');
          if (!yes) return;
          try {
            await api.deleteCategory(btn.dataset.del);
            toast('已删除');
            load();
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="card card-pad sub small">${esc(err.message)}</div>`;
    }
  }

  async function create() {
    const name = prompt('分类名字（比如：药品 / 玩具 / 厨房用品）');
    if (name === null) return;
    if (!name.trim()) return toast('名字不能为空', true);
    try {
      await api.createCategory({ name: name.trim() });
      toast('加好了');
      load();
    } catch (err) {
      toast(err.message, true);
    }
  }
}
