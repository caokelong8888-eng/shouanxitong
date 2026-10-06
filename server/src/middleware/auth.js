import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../config/index.js';
import { AppError } from '../utils/response.js';

/**
 * 家庭访问口令（第一道门）。
 *
 * 【为什么要做】
 * 系统挂在公网上，以前任何人都能直接读写数据 —— 全家东西的照片和位置
 * 等于公开。家庭自用不需要复杂的账号体系，一个口令就够。
 *
 * 【怎么做】
 *   1. 家人在登录页输入口令
 *   2. 后端比对通过后，签发一个「签名令牌」（token）
 *   3. 令牌存在浏览器里，之后每次请求带上
 *   4. 令牌被 HMAC 签名过，改一个字符就失效 —— 不用存数据库
 *
 * 【安全性】
 *   - 口令用 timingSafeEqual 比对，防时序攻击
 *   - 令牌带过期时间（默认 1 年，家里用不折腾）
 *   - 令牌里带随机 jti，改口令后所有旧令牌自动失效
 *   - 失败次数限流，防止有人在线猜口令
 */

/* ---------------- 令牌签发与校验 ---------------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** 令牌主体：{ v, exp } —— seed 由 .env 持久化，改 AUTH_SEED 才全体失效 */
function sign(payload) {
  const body = b64url(JSON.stringify(payload));

  const seed = authSeed();
  const sig = b64url(crypto.createHmac('sha256', `${config.auth.passcode}:${seed}`).update(body).digest());

  return `${body}.${seed}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [body, , sig] = parts;

  // 【关键】必须用「服务端当前的 seed」重新算，而不是用令牌里自带的那个。
  // 早前这里校验的是令牌里的 seed，等于 seed 只是个装饰：
  // 谁拿到口令就能用任意 seed 签出一个永久有效的令牌，改 AUTH_SEED 也作废不了旧令牌。
  // 现在 seed 是服务端机密（.env），作用才真正成立 ——
  // 改 AUTH_SEED 或改 ACCESS_PASSCODE，全家人的旧令牌会一起失效。
  const expect = b64url(
    crypto.createHmac('sha256', `${config.auth.passcode}:${authSeed()}`).update(body).digest()
  );
  if (!safeEqual(sig, expect)) return false;

  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return false;
  }

  if (typeof payload?.exp !== 'number' || Date.now() > payload.exp) return false;
  return payload;
}

/** 定长比较，避免通过响应时间猜出口令 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------------- 启动随机 seed ---------------- */

/**
 * 签名 seed。
 *
 * 【为什么必须持久化】
 * seed 决定令牌签名。之前是进程内随机生成的，看着更安全，但有个致命后果：
 * 服务一重启（发版、OOM、机器重启），seed 就换了，
 * 全家人手机上「已登录」的状态会**同时失效**，全被弹回登录页。
 * 1G 内存的机器 + 批量 AI 识别，OOM 并不罕见。
 *
 * 所以改成：优先读 .env 里的 AUTH_SEED；
 * 没配就在首次启动时随机生成一个、写回 .env，然后一直用这个。
 * 安全性等价（seed 依然是保密的随机值），但重启不再掉登录。
 */
let _seed = null;
function authSeed() {
  if (_seed) return _seed;

  const fromEnv = (process.env.AUTH_SEED || '').trim();
  if (fromEnv.length >= 16) {
    _seed = fromEnv;
    return _seed;
  }

  // 没配 AUTH_SEED：生成一个并尝试写回 .env，下次启动就能读到
  _seed = crypto.randomBytes(16).toString('hex');
  try {
    const envPath = path.resolve(ROOT_DIR, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      if (!/^AUTH_SEED=/m.test(content)) {
        fs.appendFileSync(envPath, `\n# 令牌签名密钥（自动生成，删掉会导致全家人重新登录）\nAUTH_SEED=${_seed}\n`);
        console.log('  🔑 已生成 AUTH_SEED 并写入 .env（服务重启不再需要重新登录）');
      }
    } else {
      console.warn('  ⚠️ 找不到 .env，AUTH_SEED 无法持久化；服务重启后需要重新登录');
    }
  } catch (err) {
    // 写不进去只提示，不影响启动（本次进程内仍然有效）
    console.warn('  ⚠️ AUTH_SEED 写入 .env 失败（', err.message, '），服务重启后需要重新登录');
  }
  return _seed;
}

/* ---------------- 登录限流 ---------------- */

const attempts = new Map(); // ip -> { count, until }
const MAX_ATTEMPTS = 8;
const LOCK_MS = 5 * 60 * 1000;

function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.until) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const rec = attempts.get(ip) || { count: 0, until: Date.now() + LOCK_MS };
  rec.count += 1;
  rec.until = Date.now() + LOCK_MS;
  attempts.set(ip, rec);
}

/* ---------------- Cookie 支持（给 <img> 用） ---------------- */

/**
 * 【为什么需要 Cookie】
 * API 走 Authorization 头，前端 fetch 能带；
 * 但 <img src="/files/xxx.jpg"> 带不了任何请求头。
 * 结果就是图片只能走静态目录裸奔 —— 任何拿到链接的人不登录就能看全家的照片。
 *
 * 解决办法：登录时同时下发一个 HttpOnly Cookie，图片请求由浏览器自动带上。
 * 前端一行都不用改，图片照旧写 <img src="/files/...">。
 *
 * 为什么用 HttpOnly：
 *   页面里的 JS 读不到它，XSS 偷不走它（localStorage 里的 token 反而能被读走）。
 * SameSite=Strict：
 *   别的网站拿不到这个 Cookie，图片链接被转发到外部也加载不出来。
 */

const COOKIE_NAME = 'home_inv_session';

/** 手工拼 Set-Cookie，不引第三方依赖（这个项目刻意保持零运行时依赖） */
function buildCookie(value, { maxAgeSec } = {}) {
  const bits = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  // 只有走 https 才加 Secure。本地 http 调试时加了浏览器会拒收。
  if (config.publicBaseUrl.startsWith('https://')) bits.push('Secure');
  if (typeof maxAgeSec === 'number') bits.push(`Max-Age=${maxAgeSec}`);
  return bits.join('; ');
}

/** 读 Cookie（只取我们需要的那一个） */
function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

export { COOKIE_NAME, buildCookie, readCookie };

/* ---------------- 对外接口 ---------------- */

/** 是否开启了口令保护（没配口令 = 不启用，方便本地开发） */
export function authEnabled() {
  return !!config.auth.passcode;
}

/** POST /api/auth/login —— 用口令换令牌 */
export function login(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  if (tooManyAttempts(ip)) {
    throw new AppError('试错次数太多了，请 5 分钟后再试', 429, 'TOO_MANY_ATTEMPTS');
  }

  if (!authEnabled()) {
    throw new AppError('服务器还没设置访问口令', 503, 'AUTH_DISABLED');
  }

  const passcode = String(req.body?.passcode ?? '').trim();
  if (!passcode) throw new AppError('请输入访问口令', 400, 'BAD_REQUEST');

  if (!safeEqual(passcode, String(config.auth.passcode).trim())) {
    recordFailure(ip);
    // 不告诉对方"口令不对"还是"口令格式不对"，统一一句话
    throw new AppError('口令不对', 401, 'BAD_PASSCODE');
  }

  attempts.delete(ip);
  const expiresAt = Date.now() + config.auth.tokenTtlMs;
  const token = sign({ v: 1, exp: expiresAt });

  // 同时下发 Cookie，供 <img> 标签鉴权用（HttpOnly，页面 JS 读不到）
  res.setHeader('Set-Cookie', buildCookie(token, { maxAgeSec: Math.floor(config.auth.tokenTtlMs / 1000) }));

  return res.json({ ok: true, data: { token, expiresAt } });
}

/** GET /api/auth/check —— 前端启动时问一句"我还登录着吗" */
export function check(req, res) {
  return res.json({ ok: true, data: { authed: !!req.authed, required: authEnabled() } });
}

/** 退出登录：把 Cookie 收掉 */
export function logout(_req, res) {
  res.setHeader('Set-Cookie', buildCookie('', { maxAgeSec: 0 }));
  return res.json({ ok: true, data: { loggedOut: true } });
}

/**
 * 鉴权中间件（给 API 用）。
 * 挂在所有业务路由前面；/api/auth/* 自己在路由表里排在它后面（白名单）。
 */
export function requireAuth(req, res, next) {
  // 没配口令 → 不拦（本地开发/自测用）
  if (!authEnabled()) {
    req.authed = true;
    return next();
  }

  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // 两条路都认：fetch 用 Bearer，<img> 等只能带 Cookie 的场景用 Cookie
  const token = bearer || readCookie(req, COOKIE_NAME);

  if (!verify(token)) {
    // 顺手把过期 Cookie 清掉，避免用户清了 localStorage 之后 Cookie 还在反复 401
    res.setHeader('Set-Cookie', buildCookie('', { maxAgeSec: 0 }));
    return res.status(401).json({
      ok: false,
      error: { message: '登录已过期，请重新输入口令', code: 'UNAUTHORIZED' },
    });
  }

  req.authed = true;
  next();
}
