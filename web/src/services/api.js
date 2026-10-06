/**
 * 统一数据入口 —— 页面里不准直接 fetch，一律走这里。
 *
 * 这样做的好处：
 *   1. 换后端地址、加鉴权、加缓存只需改这一个文件
 *   2. 后端统一的 { ok, data, error } 形状在这里被消化掉，
 *      页面拿到的是纯数据或抛出带人话的 Error
 *   3. 弱网重试、上传进度、超时都能集中处理
 */

import { getToken, expireAuth } from './auth.js';

const TIMEOUT = 20000;

/** 后端返回的错误，带 code 与可执行动作，便于页面给出「重试 / 手动填写 / 取消」 */
export class ApiError extends Error {
  constructor(message, code = 'ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 把后端响应统一消化成 data，失败则抛出可读错误 */
async function unwrap(res) {
  let payload = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('服务器返回的内容看不懂，请稍后重试', 'BAD_RESPONSE', res.status);
  }
  // 401 = 令牌没了或失效了（服务端重启、口令被改、令牌过期）。
  // 在这里统一清令牌并广播 auth:expired，由 main.js 负责跳登录页 ——
  // 页面代码就不必各自判断登录态，也就不会出现「有的页面跳、有的页面干瞪眼」。
  if (res.status === 401) {
    expireAuth();
    throw new ApiError(payload?.error?.message || '登录已过期，请重新输入口令', 'UNAUTHORIZED', 401);
  }
  if (!payload || payload.ok !== true) {
    const err = payload?.error || {};
    throw new ApiError(err.message || '操作没成功，请稍后重试', err.code || 'ERROR', res.status);
  }
  return payload;
}

async function request(method, path, { body, params, timeout = TIMEOUT, retry = 0 } = {}) {
  let url = path;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const init = { method, headers: {} };
  // 每个请求都带上令牌。没令牌时不带，让服务端自己判 401 —— 登录接口本来就无令牌。
  const token = getToken();
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    // 网络断了自动重试一次 —— 对应「弱网自动重试」要求
    if (retry > 0) {
      await new Promise((r) => setTimeout(r, 600));
      return request(method, path, { body, params, timeout, retry: retry - 1 });
    }
    if (err.name === 'AbortError') {
      throw new ApiError('网络有点慢，请求超时了，请重试', 'TIMEOUT');
    }
    throw new ApiError('连不上服务器，请检查网络', 'NETWORK');
  }
  clearTimeout(timer);
  return unwrap(res);
}

/* ---------------- GET 去重与短缓存 ---------------- */

/**
 * 同一屏里多处要同一份数据是常态，而这条线路上真正贵的是「往返」而不是服务端。
 * 这里做两件事：
 *   1. 同一 URL 的在途请求合并成一次 —— 并发重复打只发一个包
 *   2. 结果 3 秒内复用 —— 「返回上一页又立刻进来」时不必白跑一趟
 * 写操作（POST/PATCH/DELETE）一律清空缓存，绝不读到已被改动的旧数据。
 */
const GET_CACHE_MS = 3000;
const getCache = new Map(); // key -> { at, promise }
const inflight = new Map(); // key -> promise

function readGetCache(key) {
  const rec = getCache.get(key);
  if (!rec) return null;
  if (Date.now() - rec.at > GET_CACHE_MS) {
    getCache.delete(key);
    return null;
  }
  return rec.promise;
}

function writeGetCache(key, promise) {
  getCache.set(key, { at: Date.now(), promise });
  promise.catch(() => getCache.delete(key));
}

/** 写操作之后调用，避免读到旧数据 */
export function clearGetCache() {
  getCache.clear();
}

async function cachedGet(path, params) {
  let url = path;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const cached = readGetCache(url);
  if (cached) return cached;

  const running = inflight.get(url);
  if (running) return running;

  const p = request('GET', path, { params, retry: 1 });
  inflight.set(url, p);
  writeGetCache(url, p);
  p.finally(() => inflight.delete(url));
  return p;
}

const get = cachedGet;
// 写操作成功后清 GET 缓存 —— 否则刚改完马上读，读到的还是 3 秒前的旧值
const post = (path, body) =>
  request('POST', path, { body, retry: 1 }).then((r) => (clearGetCache(), r));
const patch = (path, body) =>
  request('PATCH', path, { body, retry: 1 }).then((r) => (clearGetCache(), r));
const del = (path) => request('DELETE', path, { retry: 0 }).then((r) => (clearGetCache(), r));

export const api = {
  // ---------- 登录 ----------
  login: (passcode) => request('POST', '/api/auth/login', { body: { passcode } }),
  authCheck: () => request('GET', '/api/auth/check'),

  // ---------- 基础 ----------
  health: () => get('/api/health'),
  family: () => get('/api/families/current'),
  overview: () => get('/api/overview'),

  // ---------- 空间 / 区域 ----------
  listSpaces: () => get('/api/spaces'),
  getSpace: (id) => get(`/api/spaces/${id}`),
  createSpace: (data) => post('/api/spaces', data),
  updateSpace: (id, data) => patch(`/api/spaces/${id}`, data),
  deleteSpace: (id) => del(`/api/spaces/${id}`),

  listLocations: (spaceId) => get('/api/locations', { spaceId }),
  createLocation: (data) => post('/api/locations', data),
  updateLocation: (id, data) => patch(`/api/locations/${id}`, data),
  deleteLocation: (id) => del(`/api/locations/${id}`),

  // ---------- 盒子 ----------
  listContainers: (params) => get('/api/containers', params),
  getContainer: (id) => get(`/api/containers/${id}`),
  getContainerByCode: (code) => get(`/api/containers/code/${encodeURIComponent(code)}`),
  nextContainerCode: () => get('/api/containers/next-code'),
  createContainer: (data) => post('/api/containers', data),
  updateContainer: (id, data) => patch(`/api/containers/${id}`, data),
  deleteContainer: (id) => del(`/api/containers/${id}`),
  containerQrcode: (id) => get(`/api/containers/${id}/qrcode`, { format: 'json' }),

  // ---------- 物品 ----------
  listItems: (params) => get('/api/items', params),
  getItem: (id) => get(`/api/items/${id}`),
  createItem: (data) => post('/api/items', data),
  updateItem: (id, data) => patch(`/api/items/${id}`, data),
  deleteItem: (id) => del(`/api/items/${id}`),

  // ---------- 库存（多位置） ----------
  addStock: (data) => post('/api/stocks', data),
  updateStock: (id, data) => patch(`/api/stocks/${id}`, data),
  removeStock: (id) => del(`/api/stocks/${id}`),

  // ---------- 搜索 ----------
  search: (params) => get('/api/search', params),

  // ---------- 分类 / 标签 ----------
  listCategories: () => get('/api/categories'),
  createCategory: (data) => post('/api/categories', data),
  updateCategory: (id, data) => patch(`/api/categories/${id}`, data),
  deleteCategory: (id) => del(`/api/categories/${id}`),
  listTags: () => get('/api/tags'),

  // ---------- 日志 ----------
  listLogs: (limit = 20) => get('/api/activity-logs', { limit }),

  // ---------- 上传 ----------
  /** 单张上传，带进度回调 */
  uploadImage(file, { itemId, containerId, onProgress } = {}) {
    const fd = new FormData();
    fd.append('file', file);
    if (itemId) fd.append('itemId', itemId);
    if (containerId) fd.append('containerId', containerId);
    return uploadWithProgress('/api/uploads/image', fd, onProgress);
  },

  /** 连拍批量上传 */
  uploadBatch(files, { onProgress } = {}) {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    return uploadWithProgress('/api/uploads/batch', fd, onProgress);
  },

  // ---------- AI ----------
  recognize: (imageIds) =>
    post('/api/recognize', Array.isArray(imageIds) ? { imageIds } : { imageId: imageIds }),
  whatIsThis: (imageId) => post('/api/recognize/what-is-this', { imageId }),
  batchInbound: (data) => post('/api/inbound/batch', data),
};

/**
 * XHR 上传（fetch 无法获取上传进度）。
 * 手机连拍几十张图时进度条很重要，否则用户不知道卡住了还是在传。
 */
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 120000;

    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        return reject(new ApiError('服务器返回的内容看不懂', 'BAD_RESPONSE', xhr.status));
      }
      if (xhr.status === 401) {
        expireAuth();
        return reject(new ApiError(payload?.error?.message || '登录已过期', 'UNAUTHORIZED', 401));
      }
      if (payload?.ok === true) {
        // 上传会改变数据，清掉 GET 缓存
        clearGetCache();
        return resolve(payload);
      }
      reject(new ApiError(payload?.error?.message || '上传失败', payload?.error?.code || 'UPLOAD_FAILED', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('上传失败，请检查网络后重试', 'NETWORK'));
    xhr.ontimeout = () => reject(new ApiError('上传超时了，图片可能太大或网络太慢', 'TIMEOUT'));
    xhr.send(formData);
  });
}

/** 计算可访问的完整图片地址（开发环境下 /files 由 vite 代理） */
export function fileUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return path;
}
