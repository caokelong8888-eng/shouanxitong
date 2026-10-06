import { route, startRouter, navigate, parseHash } from './router.js';
import { renderBottomNav } from './components/bottom-nav.js';
import { api } from './services/api.js';
import { getToken, clearToken } from './services/auth.js';

import { loginPage } from './pages/login.js';
import { homePage } from './pages/home.js';
import { searchPage } from './pages/search.js';
import { inboundPage } from './pages/inbound.js';
import { boxesPage } from './pages/boxes.js';
import { boxDetailPage } from './pages/box-detail.js';
import { boxNewPage } from './pages/box-new.js';
import { itemDetailPage } from './pages/item-detail.js';
import { itemNewPage } from './pages/item-new.js';
import { spacesPage } from './pages/spaces.js';
import { whatPage } from './pages/what.js';
import { mePage } from './pages/me.js';
import { categoriesPage } from './pages/categories.js';

/**
 * 路由表。
 * 顺序有讲究：具体路径要放在带参数的通配路径前面，
 * 否则 /boxes/new 会被 /boxes/:id 吃掉。
 */

route('/login', loginPage);
route('/', homePage);
route('/search', searchPage);

// 拍照入库页。路径叫 /inbound 而不是 /add ——
// 它做的其实是「把刚拍的东西入库」，不是「新增一张表单」。
route('/inbound', inboundPage);
route('/what', whatPage);

route('/boxes', boxesPage);
route('/boxes/new', boxNewPage);
route('/boxes/code/:code', scanEntry);
route('/boxes/:id/edit', boxNewPage);
route('/boxes/:id', boxDetailPage);

route('/items/new', itemNewPage);
route('/items/:id', itemDetailPage);

route('/spaces', spacesPage);
route('/categories', categoriesPage);
route('/me', mePage);

/* ---------------- 登录守卫 ---------------- */

/**
 * 三层防线，缺一层都会闪：
 *   1. index.html 里的内联脚本 —— 还没加载 JS 就先把没令牌的人挡在门外
 *   2. 这里 hash 变化时的守卫 —— 拦「地址栏手输」「扫码进来」这类入口
 *   3. api 收到 401 时广播 auth:expired —— 拦住「令牌中途失效」
 */
function gotoLogin() {
  if (parseHash().path !== '/login') navigate('/login', { replace: true });
}

// 令牌中途失效（服务端重启 / 口令被改 / 令牌过期）：清干净再送回登录页
window.addEventListener('auth:expired', () => {
  clearToken();
  gotoLogin();
});

/**
 * 检查当前登录态。
 * 返回 true = 放行。
 *
 * 注意「服务端没配口令」这种情况：此时没有任何保护，也不该逼用户登录，
 * 所以先问 /api/auth/check 的 required 字段。这条请求本身会 401（因为 check 需要令牌），
 * 但响应里带着 required —— 所以对 401 也要读一下再决定，而不是一律赶去登录页。
 */
async function ensureAuthed() {
  if (parseHash().path === '/login') return true;

  if (!getToken()) {
    try {
      const { data } = await api.authCheck();
      if (data?.required === false) return true;
    } catch (err) {
      // 不是「未登录」的错（比如断网）就别拦，让页面自己报错
      if (err?.code !== 'UNAUTHORIZED') return true;
    }
    gotoLogin();
    return false;
  }

  try {
    await api.authCheck();
    return true;
  } catch (err) {
    if (err?.code === 'UNAUTHORIZED') {
      gotoLogin();
      return false;
    }
    return true;
  }
}

// 捕获阶段先拦一道，避免页面已经渲染出来又跳走（会闪）
let checking = false;
window.addEventListener(
  'hashchange',
  async () => {
    if (checking) return;
    checking = true;
    if (parseHash().path === '/login') {
      checking = false;
      return;
    }
    if (!getToken() && !(await ensureAuthed().catch(() => true))) {
      checking = false;
      return;
    }
    checking = false;
  },
  { capture: true }
);

/**
 * 扫码入口。
 * 实际盒子上贴的二维码指向 #/boxes/code/B03，
 * 扫到之后直接跳转到盒子详情（URL 保持干净，方便再分享）。
 */
async function scanEntry({ params }) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="loading" style="padding-top:120px;">
        <span class="spinner"></span>正在打开盒子 ${escapeHtml(params.code)}…
      </div>
    </div>`;
  renderBottomNav();

  // 用 replace，避免后退时又回到这个中转页
  try {
    const { data } = await api.getContainerByCode(params.code);
    navigate(`/boxes/${data.id}`, { replace: true });
  } catch (err) {
    app.innerHTML = `
      <div class="page">
        <div class="page-body">
          <div class="card">
            <div class="empty">
              <div class="emoji">📦</div>
              <div class="title">找不到这个盒子</div>
              <div class="desc">编号 ${escapeHtml(params.code)} 不存在，可能已经被删掉了</div>
            </div>
            <div style="padding:0 var(--s-4) var(--s-4);">
              <button class="btn btn-primary btn-block" onclick="location.hash='#/boxes'">去看看所有盒子</button>
            </div>
          </div>
        </div>
      </div>`;
    renderBottomNav();
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 顶栏滚动到底部时加分隔线（细节，但让页面显得更精致）
window.addEventListener(
  'scroll',
  () => {
    document.querySelectorAll('.app-header').forEach((h) => {
      h.classList.toggle('is-scrolled', window.scrollY > 4);
    });
  },
  { passive: true }
);

// 每次路由变化后重画底部导航，保证高亮状态正确
window.addEventListener('hashchange', () => {
  setTimeout(() => renderBottomNav(), 0);
});

startRouter();

// 首屏也要查一次 —— hashchange 在首次进入时不一定触发
ensureAuthed().then((ok) => {
  if (!ok) navigate('/login', { replace: true });
});

/**
 * 注册 Service Worker（PWA，可加到手机桌面）。
 *
 * 这里做「自动更新」：手机上 PWA 常年不关，光靠注册是拿不到新版本的 ——
 * 用户会一直看到旧界面，然后抱怨「你改了没用」。
 * 所以：每次启动主动 update()，发现新 SW 接管后自己 reload 一次；
 * 另外页面重新可见时也 update()，确保切回来就能拿到新版。
 */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'activated' && navigator.serviceWorker.controller) {
            console.info('[sw] 发现新版本，正在更新…');
            location.reload();
          }
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch {
      /* 注册失败不影响使用 */
    }
  });
}
