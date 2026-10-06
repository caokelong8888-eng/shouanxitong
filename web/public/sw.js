/**
 * Service Worker —— 只做两件保守的事：
 *   1. 断网时还能打开页面（缓存应用外壳）
 *   2. 图片走「缓存优先」，已看过的缩略图不再重复下载
 *
 * 【重要】绝不缓存 /api 请求 —— 收纳系统的数据必须实时，
 * 缓存了会导致「盒子里的东西明明是刚加的却看不到」这种最招人烦的问题。
 *
 * 【血泪教训 · v2 修掉】导航请求（index.html）以前是「缓存优先」，
 * 这是致命错误：index.html 里写着本次构建的 JS 文件名（带哈希），
 * 它一旦被缓存住，手机上就永远引用旧 JS —— 服务器改了也没用，
 * 页面还是老行为（本次"点加号仍弹选择菜单"就是这个原因）。
 *
 * 现在的规矩：
 *   - 导航请求 → 永远走网络，只有真断网才回退缓存
 *   - 带哈希的静态资源 → 文件名即版本号，可以放心缓存优先
 *   - VERSION 每次发版都变 → activate 时清掉所有旧缓存
 */

// 发版时改这里，保证缓存必失效
const VERSION = '1791261038301';
const SHELL_CACHE = `shell-${VERSION}`;
const IMG_CACHE = `img-${VERSION}`;

self.addEventListener('install', (event) => {
  // 不预缓存任何东西：反正导航请求必须走网络，预缓存只会引入陈旧风险。
  // 缓存全部在运行时按需写入（且只写带哈希、不会变的东西）。
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // 清掉所有旧版本缓存 —— 这是发版能生效的关键一步
        Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 接口请求：永不缓存，直接走网络
  if (url.pathname.startsWith('/api/')) return;

  // 导航请求：永远网络优先。这条是本次修复的核心。
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // 带内容哈希的静态资源（/assets/index-a1b2c3.js）：
  // 文件名就是版本号，内容永不改变，缓存优先最安全也最快。
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // 图片：缓存优先，省流量、加载快
  if (url.pathname.startsWith('/files/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(IMG_CACHE).then((cache) => cache.put(request, copy));
          return res;
        });
      })
    );
    return;
  }

  // 其余（manifest / icon 等）：网络优先，失败回退缓存
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
