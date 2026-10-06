import { currentPath, navigate } from '../router.js';
import { openCamera } from '../services/camera.js';

/**
 * 底部固定导航。
 * 5 项：首页 / 搜索 / 拍照 / 盒子 / 我的
 *
 * 「拍照」是视觉上最明显的核心入口 —— 凸起的圆形主按钮。
 * 它不再是一个跳转页：点了直接唤起相机，拍完才进入库页，
 * 中间那一步「先到一个只有加号的页面」是多余的。
 */

const ITEMS = [
  { key: 'home', label: '首页', icon: '🏠', path: '/' },
  { key: 'search', label: '搜索', icon: '🔍', path: '/search' },
  { key: 'add', label: '拍照', add: true },
  { key: 'boxes', label: '盒子', icon: '📦', path: '/boxes' },
  { key: 'me', label: '我的', icon: '👤', path: '/me' },
];

/** 判断当前路径属于哪个导航项 */
function activeKey(path) {
  if (path === '/' || path === '') return 'home';
  if (path.startsWith('/search') || path.startsWith('/items')) return 'search';
  if (path.startsWith('/inbound')) return 'add';
  if (path.startsWith('/boxes')) return 'boxes';
  if (path.startsWith('/me')) return 'me';
  return '';
}

export function renderBottomNav() {
  const path = currentPath();

  // 登录页是「门外」，不该看到屋里的导航
  if (path === '/login') {
    document.querySelector('.bottom-nav')?.remove();
    return;
  }

  const active = activeKey(path);

  const html = ITEMS.map((it) => {
    if (it.add) {
      return `
        <button class="nav-btn nav-add" id="nav-add">
          <span class="add-circle">＋</span>
          <span class="add-label">${it.label}</span>
        </button>`;
    }
    return `
      <button class="nav-btn ${active === it.key ? 'active' : ''}" data-go="${it.path}">
        <span class="nav-icon">${it.icon}</span>
        <span>${it.label}</span>
      </button>`;
  }).join('');

  let nav = document.querySelector('.bottom-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    document.body.appendChild(nav);
  }
  nav.innerHTML = html;

  // 点加号直接开相机，拍完带着照片去入库页
  document.getElementById('nav-add')?.addEventListener('click', () => {
    openCamera({
      onDone: (files) => {
        if (files?.length) navigate('/inbound');
      },
    });
  });

  nav.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.go;
      if (currentPath() === target) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      navigate(target);
    });
  });
}
