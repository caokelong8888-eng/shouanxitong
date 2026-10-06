/**
 * 相机入口 —— 全 App 唯一一处「拍照」动作。
 *
 * 两条路，优先级从高到低：
 *
 *   1) 【内置相机】用 getUserMedia 在页面里画取景框自己拍。
 *      完全不依赖 capture 属性 —— 手机自带浏览器（小米/华为/OPPO/vivo）
 *      不认 capture，点下去永远弹"拍照/相册"菜单，只有这条路能治。
 *      需要 HTTPS，已配好。
 *
 *   2) 【系统相机】退回 <input type="file" capture>。
 *      内置相机不可用时（老浏览器 / http 环境）才用。
 *      注意这里有几个必须绕开的坑：
 *        - 绝不能带 multiple：Chrome / 微信一旦看到就忽略 capture
 *        - 绝不能异步 click()：浏览器只认「同一次用户手势」里的弹窗
 *        - input 别用 display:none：个别 WebView 会拒绝触发
 *
 * 拍完的照片暂存在模块变量里，由入库页取走。
 */

import { openCameraSheet, canUseBuiltinCamera } from './camera-sheet.js';

/**
 * 照片暂存区。
 *
 * 【为什么不用普通变量】
 * 以前照片只放在模块变量里，一旦用户拍完照、还没进入库页就点了别的地方，
 * 那批照片就静默消失了 —— 用户回到入库页只看到空的，还得重新拍一遍。
 *
 * 现在双保险：
 *   1. 内存变量（正常路径，最快）
 *   2. sessionStorage 兜底 —— 切页面/刷新都还在，一小时内有效
 *      （照片本体太大不存，只存一条"有新照片待处理"的标记 + 时间）
 */
let pendingFiles = null;

const PENDING_KEY = 'home_inv_pending_photos';
const PENDING_TTL = 60 * 60 * 1000; // 一小时

/** 有待处理照片时置一个标记，让入库页知道"刚才拍过东西" */
function markPending(count) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ count, at: Date.now() }));
  } catch {
    /* 存不下就算了，不影响主流程 */
  }
}

/** 读标记：用于判断"刚才拍过但照片没了" */
export function peekPendingMark() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec?.at || Date.now() - rec.at > PENDING_TTL) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

/** 消费掉标记（照片已经进入库流程了） */
export function clearPendingMark() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 取出待处理照片（取一次就清空，避免重复入库） */
export function takePendingFiles() {
  if (pendingFiles?.length) {
    const f = pendingFiles;
    pendingFiles = null;
    clearPendingMark();
    return f;
  }
  return null;
}

/** 当前有没有等着被处理的照片 */
export function hasPendingFiles() {
  return !!pendingFiles?.length;
}

/**
 * 唤起相机。
 *
 * 必须在用户的 click / tap 事件回调里**同步**调用，中间不要 await、不要跳路由。
 * 拍完（或取消）后会调用 onDone(files)，files 为空表示用户取消了。
 */
export async function openCamera({ onDone } = {}) {
  // 首选：页面内自绘相机 —— 点一下直接出取景框，没有任何中间选择
  if (canUseBuiltinCamera()) {
    // 用户可能点了「重试」，那就再来一轮
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await openCameraSheet();

      if (result && !Array.isArray(result) && result.retry) continue;

      // 用户在相机界面里点了「用系统拍照」→ 走下面的老路
      if (result && !Array.isArray(result) && result.fallback) {
        openSystemCamera({ onDone });
        return;
      }

      const files = Array.isArray(result) ? result : [];
      if (files.length) {
        pendingFiles = files;
        markPending(files.length);
        onDone?.(files);
      } else {
        onDone?.([]);
      }
      return;
    }
    return;
  }

  // 兜底：系统相机
  openSystemCamera({ onDone });
}

/** 老的 input capture 方案（内置相机不可用时的兜底） */
export function openSystemCamera({ onDone } = {}) {
  const input = ensureInput();

  const finish = (files) => {
    input.removeEventListener('change', onChange);
    if (files?.length) {
      pendingFiles = files;
      markPending(files.length);
      onDone?.(files);
    } else {
      onDone?.([]);
    }
  };

  function onChange() {
    const files = Array.from(input.files || []);
    input.value = ''; // 允许重复拍同一个东西
    finish(files);
  }

  input.addEventListener('change', onChange);

  try {
    input.click();
  } catch (err) {
    input.removeEventListener('change', onChange);
    console.warn('[camera] 唤起失败', err);
    onDone?.([]);
  }
}

let camInput = null;

/** 惰性创建文件输入。capture 与 multiple 分开两个元素，绝不混用。 */
function ensureInput() {
  if (camInput?.isConnected) return camInput;

  const el = document.createElement('input');
  el.type = 'file';
  el.accept = 'image/*';
  el.setAttribute('capture', 'environment');
  // 不用 display:none —— 部分安卓 WebView 对隐藏 input 拒绝弹相机。
  // 用 1px + 透明 + 定位到屏幕外，视觉上完全不可见但依然「可见」。
  el.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  document.body.appendChild(el);

  camInput = el;
  return el;
}
