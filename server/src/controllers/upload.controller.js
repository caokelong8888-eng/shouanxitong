import multer from 'multer';
import { config } from '../config/index.js';
import * as imageRepo from '../db/repositories/image.repo.js';
import { getStorage } from '../adapters/storage/index.js';
import { makeThumbnail, normalizeOriginal, assertRealImage } from '../utils/thumbnail.js';
import { ok, AppError, badRequest } from '../utils/response.js';
import { parseId } from '../middleware/family.js';

/**
 * 图片上传。
 *
 * 关键点（对应「弱网 / 连拍 / 省流量」要求）：
 *   1. 内存接收，不落临时文件 —— 连拍多张时磁盘不会被塞满垃圾
 *   2. 上传即同步生成缩略图，手机列表页只加载缩略图
 *   3. 手机拍的 HEIC / 超大图统一转 JPEG，避免微信内置浏览器不认
 */

const memoryStorage = multer.memoryStorage();

function buildUploader(maxCount) {
  return multer({
    storage: memoryStorage,
    limits: { fileSize: config.storage.maxFileSize, files: maxCount },
    fileFilter(_req, file, cb) {
      const allowed = config.storage.allowedMime;
      if (!allowed.includes(file.mimetype)) {
        return cb(new AppError(`不支持的图片格式：${file.mimetype}`, 415, 'UNSUPPORTED_MEDIA'));
      }
      cb(null, true);
    },
  });
}

export const uploadMiddleware = buildUploader(1).single('file');
export const uploadArrayMiddleware = buildUploader(20).array('files', 20);

/** 把一张图片落盘 + 入库，返回图片记录 */
async function persistImage(file, { itemId = null, containerId = null } = {}) {
  const storage = getStorage();

  // 0) 验明正身 —— 不看后缀、不看客户端自报的 mimetype，只认文件头。
  //    改名伪装的文件在这里就被挡住，根本没机会落盘。
  const verdict = await assertRealImage(file.buffer);
  if (!verdict.ok) {
    throw new AppError(verdict.reason, 415, 'UNSUPPORTED_MEDIA');
  }

  // 1) 原图规范化（HEIC/超大图转 JPEG）
  const normalized = await normalizeOriginal(file.buffer, file.mimetype);

  // 2) 原图落盘
  const original = await storage.saveOriginal(normalized.buffer, normalized.ext);

  // 3) 缩略图落盘
  let thumb = null;
  try {
    const thumbBuf = await makeThumbnail(normalized.buffer);
    thumb = await storage.saveThumb(thumbBuf, '.jpg');
  } catch (err) {
    // 缩略图失败不应该让整个上传失败，降级为用原图当缩略图
    console.warn('[upload] 缩略图生成失败，降级使用原图:', err.message);
  }

  // 4) 入库。mime 存真实的格式，不存客户端自报的
  return imageRepo.createImage({
    itemId,
    containerId,
    originalPath: original.originalPath,
    thumbPath: thumb?.thumbPath ?? null,
    url: original.originalUrl,
    thumbUrl: thumb?.thumbUrl ?? original.originalUrl,
    storageDriver: storage.driver,
    width: normalized.width ?? verdict.width,
    height: normalized.height ?? verdict.height,
    mime: `image/${verdict.format === 'jpeg' ? 'jpeg' : verdict.format}`,
    size: normalized.buffer.length,
  });
}

/** POST /api/uploads/image  —— 单张上传 */
export async function uploadImage(req, res) {
  if (!req.file) throw badRequest('没有收到图片文件（字段名应为 file）');
  const image = await persistImage(req.file, {
    itemId: req.body?.itemId ? parseId(req.body.itemId, 'itemId') : null,
    containerId: req.body?.containerId ? parseId(req.body.containerId, 'containerId') : null,
  });
  return ok(res, image);
}

/**
 * POST /api/uploads/batch —— 连拍批量上传
 * 前端连拍多张后一次性传上来，逐个生成缩略图，返回各自的图片记录。
 * 单张失败不影响其他张，把失败信息一并返回给前端提示。
 */
export async function uploadBatch(req, res) {
  const files = req.files || [];
  if (!files.length) throw badRequest('没有收到图片文件（字段名应为 files）');

  const succeeded = [];
  const failed = [];
  for (const file of files) {
    try {
      succeeded.push(await persistImage(file));
    } catch (err) {
      failed.push({ name: file.originalname, message: err.message });
    }
  }

  return ok(res, { images: succeeded, failed, total: files.length });
}
