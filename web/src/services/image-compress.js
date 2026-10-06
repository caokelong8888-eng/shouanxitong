/**
 * 统一图片压缩。
 *
 * 【为什么必须有这个】
 * 服务器在新加坡，国内手机连过去的上行只有 3~6 KB/s（实测），
 * 一张手机原图 3~5MB，照这个速度要传十几分钟。
 * 而 AI 识别看的是缩略图，1600px 已经足够 —— 压小上传是唯一有效的办法。
 *
 * 【为什么不放在api.js 里做】
 * 因为「压到什么尺寸」是拍摄体验的一部分（相机页要按尺寸裁切画面），
 * 而「从相册选的图要压」是上传前的补救，两者分开更清楚。
 */

/** 拍下来/上传的图片最长边压到多少（像素） */
export const MAX_EDGE = 1280;

/** JPEG质量。0.75 是肉眼几乎看不出差别、但体积能砍掉一半的点 */
const QUALITY = 0.75;

/** 小于这个体积（字节）就不压了，压了反而白花时间 */
const SKIP_UNDER = 60 * 1024;

/**
 * 把图片文件压到适合上传的体积。
 * 已经是小图的原样返回；压缩失败（格式怪/浏览器不支持）也原样返回 ——
 * 宁可上传慢，也不能让用户拍不了照。
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function compressImage(file) {
  if (!file || !file.type?.startsWith('image/')) return file;
  // GIF 压了会丢动画，svg 压了会糊，直接放行
  if (/gif|svg/i.test(file.type)) return file;
  if (file.size <= SKIP_UNDER) return file;

  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // 压完反而更大（比如本来就很小、只是没达到 SKIP_UNDER），就用原图
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // 白底：JPEG 不支持透明，转PNG 时透明区会变黑
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    // 手机内存紧张时 createImageBitmap 会失败，此时原样上传
    return file;
  }
}

/**
 * 优先用 createImageBitmap（快、不占内存），
 * Safari 老版本没有，退回 <img> 方案。
 */
function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读不出来'));
    };
    img.src = url;
  });
}