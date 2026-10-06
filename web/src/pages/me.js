import { api } from '../services/api.js';
import { esc, toast, confirmSheet } from '../components/ui.js';
import { navigate } from '../router.js';
import { renderBottomNav } from '../components/bottom-nav.js';

/**
 * 我的 —— 家庭成员、最近动态、设置。
 * 第一版只做展示与「预留」，不做权限系统。
 */
export async function mePage({ app }) {
  app.innerHTML = `
    <div class="page">
      <header class="app-header" style="padding-top:calc(var(--safe-top) + 0px);">
        <div class="title">我的</div>
      </header>
      <div class="page-body" id="body">
        <div class="loading"><span class="spinner"></span>加载中</div>
      </div>
    </div>
  `;

  renderBottomNav();
  await load();

  async function load() {
    const body = document.getElementById('body');
    try {
      const [{ data: family }, { data: logs }] = await Promise.all([api.family(), api.listLogs(12)]);

      body.innerHTML = `
        <!-- 家庭卡片 -->
        <div class="card card-pad">
          <div class="flex gap-3">
            <div style="width:52px;height:52px;border-radius:var(--r-full);background:linear-gradient(135deg,var(--c-primary),var(--c-accent));display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">🏠</div>
            <div class="grow">
              <div style="font-size:var(--f-lg);font-weight:700;">${esc(family.name)}</div>
              <div class="xs muted mt-1">${(family.members || []).length} 位家庭成员</div>
            </div>
          </div>

          <div class="section" style="margin-top:var(--s-4);">
            <div class="xs muted" style="margin-bottom:var(--s-2);">家庭成员</div>
            <div class="chip-row">
              ${(family.members || [])
                .map((m) => `<span class="chip">${esc(m.name)}${m.role === 'owner' ? ' 👑' : ''}</span>`)
                .join('')}
            </div>
            <div class="xs muted mt-2">第一版先记录谁添加/谁移动，权限体系后面再加</div>
          </div>
        </div>

        <!-- 快捷工具 -->
        <div class="section">
          <div class="section-head"><span class="section-title">记东西</span></div>
          <div class="card">
            <button class="row-item" data-go="/what" style="width:100%;text-align:left;">
              <span style="font-size:20px;">🤔</span>
              <div class="grow">
                <div>这是什么？</div>
                <div class="xs muted">不认识的东西，拍一下让 AI 说说它是什么、干什么用的</div>
              </div>
              <span class="muted">›</span>
            </button>
            <button class="row-item" data-go="/items/new" style="width:100%;text-align:left;">
              <span style="font-size:20px;">✍️</span>
              <div class="grow">
                <div>手动填写</div>
                <div class="xs muted">AI 没认出来，或者你本来就知道这是什么，直接填</div>
              </div>
              <span class="muted">›</span>
            </button>
          </div>
        </div>

        <!-- 管理入口 -->
        <div class="section">
          <div class="section-head"><span class="section-title">管理</span></div>
          <div class="card">
            <button class="row-item" data-go="/spaces" style="width:100%;text-align:left;">
              <span style="font-size:20px;">🗂️</span><div class="grow">空间与家具</div><span class="muted">›</span>
            </button>
            <button class="row-item" data-go="/boxes" style="width:100%;text-align:left;">
              <span style="font-size:20px;">📦</span><div class="grow">所有收纳盒</div><span class="muted">›</span>
            </button>
            <button class="row-item" data-go="/categories" style="width:100%;text-align:left;">
              <span style="font-size:20px;">🏷️</span><div class="grow">分类管理</div><span class="muted">›</span>
            </button>
          </div>
        </div>

        <!-- 最近动态 -->
        <div class="section">
          <div class="section-head"><span class="section-title">最近发生的事</span></div>
          <div class="card">
            ${
              (logs || []).length
                ? logs
                    .map(
                      (l) => `
                <div class="row-item" style="align-items:flex-start;">
                  <span style="font-size:18px;">${actionIcon(l.action)}</span>
                  <div class="grow">
                    <div class="small">${esc(l.summary || l.action)}</div>
                    <div class="xs muted mt-1">${esc(l.user_name || '有人')} · ${esc(String(l.created_at || '').slice(5, 16))}</div>
                  </div>
                </div>`
                    )
                    .join('')
                : '<div class="empty"><div class="desc">还没有记录</div></div>'
            }
          </div>
        </div>

        <!-- 关于 -->
        <div class="section">
          <div class="card card-pad">
            <div class="flex between">
              <span class="small sub">图片存储</span>
              <span class="chip chip-grey xs" id="storage-driver">…</span>
            </div>
            <div class="flex between mt-3">
              <span class="small sub">AI 识别</span>
              <span class="chip chip-grey xs" id="ai-driver">…</span>
            </div>
            <div class="flex between mt-3">
              <span class="small sub">版本</span>
              <span class="chip chip-grey xs">0.1.0</span>
            </div>
          </div>
          <div class="xs muted mt-3" style="text-align:center;line-height:1.7;">
            家庭智能收纳管理系统<br />
            记录家里的东西是什么、放在哪里
          </div>
        </div>
      `;

      body.querySelectorAll('[data-go]').forEach((el) => {
        el.addEventListener('click', () => navigate(el.dataset.go));
      });

      // 显示当前后端驱动状态，方便排查
      try {
        const { data: h } = await api.health();
        document.getElementById('storage-driver').textContent = h.storageDriver === 'cos' ? '腾讯云 COS' : '本地磁盘';
        document.getElementById('ai-driver').textContent = h.aiDriver === 'mock' ? '占位（未接真实模型）' : '已接入';
      } catch {
        /* 拿不到就不显示 */
      }
    } catch (err) {
      body.innerHTML = `
        <div class="card card-pad">
          <div class="sub small">没加载出来：${esc(err.message)}</div>
          <button class="btn btn-ghost btn-block mt-3" id="retry">重试</button>
        </div>`;
      document.getElementById('retry')?.addEventListener('click', load);
    }
  }
}

function actionIcon(action) {
  const map = {
    create: '➕',
    update: '✏️',
    move: '🔀',
    delete: '🗑️',
    inbound: '📥',
    scan: '📱',
    ai_recognize: '🤖',
  };
  return map[action] || '•';
}
