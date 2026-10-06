import './camera-sheet.css';
import { esc, toast } from '../components/ui.js';

/**
 * 页面内自绘相机面板。
 *
 * 【为什么不用 input capture】
 * 手机自带浏览器（小米 / 华为 / OPPO / vivo）很多不认 capture 属性，
 * 点下去永远弹「拍照 / 相册」二选一菜单，而不是直接开相机。
 * 只有自己用 getUserMedia 画取景框，才能真正做到「点一下直接拍」。
 * 需要 HTTPS（非安全上下文拿不到媒体设备）。
 *
 * 【交互】
 *   - 中间方形取景框，框外用超大 box-shadow 压暗，引导「只拍框里的东西」
 *   - 底部：相册 / 快门 / 完成；右上角 ✕ 关闭；Esc 也能关
 *   - 拍完可连续拍，缩略图排在快门上方，可单张删掉
 *
 * 【返回值约定】（调用方 camera.js 依赖它）
 *   File[]                 用户拍完点「完成」；空数组表示取消
 *   { retry: true }        内置相机打不开，用户点了「重试」→ 调用方重新开一轮
 *   { fallback: true }     用户点了「用系统拍照」→ 调用方退回 input capture
 */

/** 拍下来的照片最长边压到 1600，够看清又不会把上传撑爆 */
const MAX_CAPTURE_EDGE = 1600;

/** 页面内相机可用吗 —— 非安全上下文（http）拿不到媒体设备 */
export function canUseBuiltinCamera() {
  return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

/**
 * 打开全屏取景面板。
 * 必须在用户手势里同步调用（否则浏览器会拦掉摄像头授权弹窗）。
 */
export function openCameraSheet() {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'cam-sheet';
    sheet.innerHTML = `
      <div class="cam-stage">
        <video class="cam-video" playsinline autoplay muted></video>
        <div class="cam-mask">
          <div class="cam-frame"></div>
        </div>
        <div class="cam-hint" id="cam-hint">对准要收的东西</div>
      </div>

      <div class="cam-thumbs" id="cam-thumbs"></div>

      <div class="cam-bar">
        <button class="cam-side" id="cam-album" aria-label="从相册选">
          <span>🖼️</span><em>相册</em>
        </button>
        <button class="cam-shutter" id="cam-shoot" aria-label="拍照"></button>
        <button class="cam-side" id="cam-done" aria-label="完成">
          <span id="cam-done-n">✓</span><em>完成</em>
        </button>
      </div>

      <button class="cam-close" id="cam-close" aria-label="关闭">✕</button>
    `;
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';

    const video = sheet.querySelector('.cam-video');
    const hint = sheet.querySelector('#cam-hint');
    const thumbsEl = sheet.querySelector('#cam-thumbs');
    const doneCount = sheet.querySelector('#cam-done-n');
    const canvas = document.createElement('canvas');

    let files = [];
    let stream = null;
    let closed = false;
    let shooting = false;
    const urlCache = new Map();

    /** 缩略图预览地址（同一张只建一次，避免反复 createObjectURL 泄漏） */
    function thumbUrl(file) {
      let u = urlCache.get(file);
      if (!u) {
        u = URL.createObjectURL(file);
        urlCache.set(file, u);
      }
      return u;
    }

    function revokeAll() {
      urlCache.forEach((u) => URL.revokeObjectURL(u));
      urlCache.clear();
    }

    /** 收尾：停摄像头、释放预览地址、恢复滚动、摘掉键盘监听 */
    function close() {
      if (closed) return;
      closed = true;
      stream?.getTracks().forEach((t) => t.stop());
      revokeAll();
      document.body.style.overflow = '';
      sheet.remove();
      document.removeEventListener('keydown', onKey);
    }

    function finish(result) {
      close();
      resolve(result || []);
    }

    function onKey(e) {
      if (e.key === 'Escape') finish([]);
    }
    document.addEventListener('keydown', onKey);

    /* ---------------- 打开摄像头 ---------------- */

    (async () => {
      if (!window.isSecureContext) {
        return showError('需要 HTTPS 才能用相机', '当前页面不是安全连接');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        return showError('这个浏览器不支持网页相机', '');
      }

      // 权限已被明确拒绝时，直接给可操作的指引，不用等 getUserMedia 抛错
      try {
        if (navigator.permissions?.query) {
          const st = await navigator.permissions.query({ name: 'camera' });
          if (st.state === 'denied') {
            return showError(
              '摄像头权限被禁止了',
              '之前可能点了"拒绝"。请在浏览器的地址栏左侧（锁图标/⚙）里把摄像头改成"允许"，然后刷新页面'
            );
          }
        }
      } catch {
        /* 个别浏览器不支持 query，忽略 */
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        video.srcObject = stream;
        await video.play().catch(() => {});
        hint.textContent = '对准要收的东西';
      } catch (err) {
        handleCameraError(err);
      }
    })();

    /** 按错误类型给不同出路，别让用户只看到一句「打不开」 */
    async function handleCameraError(err) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        showError(
          '摄像头权限被禁止了',
          '请在浏览器地址栏左侧的锁图标/设置里，把摄像头权限改成"允许"，然后刷新页面'
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        showError('没找到摄像头', '这台设备没有可用的摄像头');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showError('摄像头被占用了', '先关掉其他正在用相机的 App（比如相机、微信视频），再点重试');
      } else if (name === 'OverconstrainedError') {
        // 理想参数不被支持（常见于外接摄像头）→ 退回最宽松的约束再试一次
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          video.srcObject = stream;
          await video.play().catch(() => {});
          hint.textContent = '对准要收的东西';
        } catch (err2) {
          showError('打不开摄像头', err2?.name || '未知原因');
        }
      } else {
        showError('打不开摄像头', name ? `原因：${name}` : '未知原因');
      }
    }

    function showError(title, detail) {
      if (closed) return;
      hint.innerHTML = `
        <div class="cam-err">${esc(title)}</div>
        ${detail ? `<div class="cam-err-detail">${esc(detail)}</div>` : ''}
        <div class="cam-err-acts">
          <span class="cam-fallback" id="cam-retry">重试</span>
          <span class="cam-fallback" id="cam-fallback">用系统拍照</span>
        </div>`;
      sheet.querySelector('#cam-shoot')?.setAttribute('disabled', 'disabled');
      sheet.querySelector('#cam-retry')?.addEventListener('click', () => finish({ retry: true }));
      sheet.querySelector('#cam-fallback')?.addEventListener('click', () => finish({ fallback: true }));
    }

    /* ---------------- 拍照 ---------------- */

    /**
     * 按取景框裁切后再存。
     *
     * 视频是 object-fit:cover 铺满的，显示尺寸和流的原始尺寸对不上，
     * 所以要把取景框的屏幕坐标按 cover 的缩放比例换算回流的像素坐标，
     * 再 drawImage 那一块 —— 否则拍出来的范围会和用户在框里看到的对不上。
     */
    function shoot() {
      if (shooting || closed) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        toast('相机还没准备好，稍等一下');
        return;
      }
      shooting = true;

      const frame = sheet.querySelector('.cam-frame');
      const stage = sheet.querySelector('.cam-stage');

      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;

      if (frame && stage) {
        const box = stage.getBoundingClientRect();
        const cut = frame.getBoundingClientRect();
        // cover 取较大缩放比才能铺满
        const scale = Math.max(box.width / vw, box.height / vh);
        const shownW = vw * scale;
        const shownH = vh * scale;
        const offX = (box.width - shownW) / 2;
        const offY = (box.height - shownH) / 2;

        sx = Math.max(0, Math.round((cut.left - box.left - offX) / scale));
        sy = Math.max(0, Math.round((cut.top - box.top - offY) / scale));
        sw = Math.min(vw - sx, Math.round(cut.width / scale));
        sh = Math.min(vh - sy, Math.round(cut.height / scale));
      }

      const shrink = Math.min(1, MAX_CAPTURE_EDGE / Math.max(sw, sh));
      canvas.width = Math.round(sw * shrink);
      canvas.height = Math.round(sh * shrink);
      canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          shooting = false;
          if (!blob || closed) return;
          files.push(new File([blob], `snap-${Date.now()}.jpg`, { type: 'image/jpeg' }));
          renderThumbs();
          sheet.classList.add('flash');
          setTimeout(() => sheet.classList.remove('flash'), 160);
          navigator.vibrate?.(20);
        },
        'image/jpeg',
        0.88
      );
    }

    /** 重画快门上方的缩略图条 */
    function renderThumbs() {
      doneCount.textContent = files.length ? `✓${files.length}` : '✓';
      thumbsEl.innerHTML = files
        .map(
          (f, i) => `<div class="cam-thumb" data-thumb="${i}">
            <img src="${thumbUrl(f)}" alt="第${i + 1}张" />
            <button class="cam-thumb-x" data-del="${i}" aria-label="删掉这张">✕</button>
          </div>`
        )
        .join('');
      thumbsEl.classList.toggle('is-empty', files.length === 0);

      thumbsEl.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const i = Number(btn.dataset.del);
          const f = files[i];
          if (f && urlCache.has(f)) {
            URL.revokeObjectURL(urlCache.get(f));
            urlCache.delete(f);
          }
          files.splice(i, 1);
          renderThumbs();
        });
      });
    }

    /* ---------------- 事件绑定 ---------------- */

    sheet.querySelector('#cam-shoot').addEventListener('click', shoot);
    sheet.querySelector('#cam-close').addEventListener('click', () => finish([]));
    sheet.querySelector('#cam-done').addEventListener('click', () => {
      if (!files.length) {
        toast('还没拍呢');
        return;
      }
      finish(files);
    });

    // 相册：临时造个 file input，选完追加到已拍列表（可以拍照 + 选图混着来）
    sheet.querySelector('#cam-album').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.cssText = 'position:fixed;left:-9999px;';
      input.addEventListener('change', () => {
        const picked = Array.from(input.files || []);
        input.remove();
        if (picked.length) {
          files = files.concat(picked);
          renderThumbs();
        }
      });
      document.body.appendChild(input);
      input.click();
    });

    renderThumbs();
  });
}
