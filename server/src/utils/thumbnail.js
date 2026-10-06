import sharp from 'sharp';
import { config } from '../config/index.js';

/**
 * 图片处理工具。
 * 手机端体验的关键：列表永远只加载缩略图，原图只在点开大图/重新识别时用。
 */

/** 真正允许落盘的图片格式（以 sharp 读出来的真实格式为准，不是文件名） */
const REAL_ALLOWED_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'heif', 'avif'];

/**
 * 校验「文件真身」是不是图片。
 *
 * 【为什么不能只看 mimetype】
 * multer 给的 file.mimetype 是客户端自报的，随手就能伪造：
 * 把木马改名成 .jpg 再声明 image/jpeg，第一道校验照样通过，
 * 等 sharp 处理时才报错 —— 可那时候文件已经落盘了。
 *
 * 这里用 sharp 读文件头，认不出来就直接拒，绝不给它落盘的机会。
 *
 * @returns {Promise<{width:number|null,height:number|null,format:string}>}
 */
export async function assertRealImage(buffer) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    // sharp 都读不出来，说明根本不是图片
    return { ok: false, reason: '这个文件不是图片（内容与后缀不符）' };
  }

  const format = String(meta.format || '').toLowerCase();
  if (!format || !REAL_ALLOWED_FORMATS.includes(format)) {
    return { ok: false, reason: `不支持的图片格式：${format || '未知'}` };
  }
  if (!meta.width || !meta.height) {
    return { ok: false, reason: '这张图片没有有效尺寸，可能已损坏' };
  }
  return { ok: true, width: meta.width, height: meta.height, format };
}

/** 最长边压缩到 thumbMaxSize，转 JPEG，体积通常降到原来的 5%~15% */
export async function makeThumbnail(buffer) {
  return sharp(buffer)
    .rotate() // 按 EXIF 自动摆正手机拍的照片
    .resize({
      width: config.storage.thumbMaxSize,
      height: config.storage.thumbMaxSize,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78, progressive: true })
    .toBuffer();
}

/** 读取图片尺寸，存入数据库，前端可据此预留占位高度避免跳动 */
export async function readMeta(buffer) {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width || null, height: meta.height || null, format: meta.format || null };
}

/**
 * 原图规范化。
 *
 * 做三件事：
 *   1. 手机拍的 HEIC/超大图统一转 JPEG —— 微信内置浏览器与 AI 接口都认这个
 *   2. 限制最长边到 originalMaxSize（默认 1600px）—— 手机原图 4000px 对「看一眼这是什么」没有意义，
 *      限尺寸后体积通常只剩原来的 10%~20%，弱网下点开大图才打得开
 *   3. 已经够小、格式也常见的图原样返回，不做无谓的重编码（重编码反而会掉画质）
 */
export async function normalizeOriginal(buffer, mime) {
  const meta = await sharp(buffer).metadata();
  const fmt = String(meta.format).toLowerCase();
  const isCommon = ['jpeg', 'jpg', 'png', 'webp'].includes(fmt);
  const smallEnough = buffer.length <= 1.5 * 1024 * 1024;
  const longEdge = Math.max(meta.width || 0, meta.height || 0);
  const withinSize = longEdge <= config.storage.originalMaxSize;
  const isHeic = mime === 'image/heic' || mime === 'image/heif';

  if (isCommon && smallEnough && withinSize && !isHeic) {
    return { buffer, ext: `.${fmt === 'jpeg' ? 'jpg' : fmt}`, width: meta.width, height: meta.height };
  }

  // 摆正 → 限制最长边 → 转 JPEG（progressive 让弱网下能边下边渲染）
  const out = await sharp(buffer)
    .rotate()
    .resize({
      width: config.storage.originalMaxSize,
      height: config.storage.originalMaxSize,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: config.storage.originalQuality, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, ext: '.jpg', width: out.info.width, height: out.info.height };
}
