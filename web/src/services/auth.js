/**
 * 登录态 —— 令牌的存取与失效广播。
 *
 * 令牌放 localStorage，不是 sessionStorage：
 * 「一次输入，这台手机记住一年」，家里人不该每次打开都输口令。
 *
 * 令牌会失效的几种情况：
 *   1. 服务端重启 —— 签名用的 seed 是进程内随机生成的，重启即换
 *   2. 口令被改
 *   3. 令牌本身过期（默认一年）
 * 前两种只能重新输口令，所以这里要能把用户干净地送回登录页。
 */

const TOKEN_KEY = 'home_inv_token';

/** 读令牌。隐私模式下 localStorage 会抛异常，当成没登录处理 */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/** 写令牌；传空串即删除 */
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 存不了就算了，用户重开一次会再输一遍口令 */
  }
}

export function clearToken() {
  setToken('');
}

/**
 * 令牌失效：清掉本地令牌，并广播 auth:expired。
 * 由 main.js 统一监听并跳登录页 —— 各处调用点不用各自处理跳转。
 */
export function expireAuth() {
  clearToken();
  window.dispatchEvent(new CustomEvent('auth:expired'));
}
