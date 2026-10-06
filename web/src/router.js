/**
 * 极简 hash 路由。
 * 为什么不用 history 模式：PWA 部署在子路径/静态托管时，hash 不需要服务端配合，
 * 扫码地址 #/boxes/code/B03 在任何环境都能直接打开。
 */

const routes = [];
let current = null;

export function route(pattern, handler) {
  // '/boxes/:id' → 正则 + 参数名
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern
        .replace(/\/:([A-Za-z0-9_]+)/g, (_m, k) => {
          keys.push(k);
          return '/([^/]+)';
        })
        .replace(/\*/g, '.*') +
      '$'
  );
  routes.push({ re, keys, handler, pattern });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = raw.split('?');
  const query = {};
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { path: path || '/', query };
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) location.replace(target);
  else location.hash = target;
}

function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { handler: r.handler, params, pattern: r.pattern };
    }
  }
  return null;
}

async function render() {
  const { path, query } = parseHash();
  const hit = match(path);
  const app = document.getElementById('app');

  if (!hit) {
    app.innerHTML = `
      <div class="page">
        ${headerHtml('页面不存在')}
        <div class="page-body">
          <div class="empty">
            <div class="emoji">🧭</div>
            <div class="title">找不到这个页面</div>
            <div class="desc">${path}</div>
          </div>
          <button class="btn btn-primary btn-block mt-4" onclick="location.hash='#/'">回到首页</button>
        </div>
      </div>`;
    return;
  }

  current = hit;
  // 先滚回顶部，避免从长列表进详情时停在页面中间
  window.scrollTo(0, 0);
  try {
    await hit.handler({ params: hit.params, query, app });
  } catch (err) {
    console.error('[route] 渲染失败', err);
    app.innerHTML = `
      <div class="page">
        ${headerHtml('出错了')}
        <div class="page-body">
          <div class="empty">
            <div class="emoji">😵</div>
            <div class="title">这个页面加载失败了</div>
            <div class="desc">${escapeText(err.message || '请稍后重试')}</div>
          </div>
          <button class="btn btn-primary btn-block mt-4" onclick="location.reload()">重新加载</button>
        </div>
      </div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function headerHtml(title) {
  return `<header class="app-header"><div class="title">${escapeText(title)}</div></header>`;
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/';
  render();
}

/** 当前路由信息（导航高亮用） */
export function currentPath() {
  return parseHash().path;
}
