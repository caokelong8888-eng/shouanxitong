import { api } from '../services/api.js';
import { setToken } from '../services/auth.js';
import { esc, toast } from '../components/ui.js';

/**
 * 登录页 —— 全 App 唯一的入口。
 *
 * 只有一个口令输入框，不做账号密码：
 * 这是一家人自己用的系统，口令的作用是「别让公网上随便谁翻到我家东西」，
 * 不是身份识别。多加一层账号反而让家里人进不来。
 *
 * 登录成功后直接 location.reload()：
 * 让页面带着令牌从头跑一遍初始化，比在内存里补状态可靠。
 */
export async function loginPage({ app }) {
  app.innerHTML = `
    <div class="page login-page">
      <div class="login-wrap">
        <div class="login-logo">🏠</div>
        <h1 class="login-title">家庭收纳</h1>
        <p class="login-sub">输入家里的访问口令</p>

        <form id="login-form" autocomplete="off">
          <input
            class="input login-input"
            id="login-pass"
            type="password"
            inputmode="text"
            placeholder="访问口令"
            autocomplete="current-password"
            required
          />
          <button class="btn btn-primary btn-lg btn-block mt-4" id="login-btn" type="submit">
            进去
          </button>
        </form>

        <p class="login-note" id="login-note">
          一次输入，这台手机记住一年，之后不用再输。
        </p>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const input = document.getElementById('login-pass');
  const btn = document.getElementById('login-btn');
  const note = document.getElementById('login-note');

  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const passcode = input.value.trim();
    if (!passcode) return;

    btn.disabled = true;
    btn.textContent = '正在验证…';
    note.textContent = '一次输入，这台手机记住一年，之后不用再输。';

    try {
      const { data } = await api.login(passcode);
      setToken(data.token);
      // 带上原有的 path/search，避免把用户手输的深链接弄丢
      location.replace(`${location.pathname}${location.search}#/`);
      location.reload();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '进去';
      input.select();
      note.innerHTML = `<span class="login-err">${esc(err.message)}</span>`;
      toast(err.message, true);
    }
  });
}
