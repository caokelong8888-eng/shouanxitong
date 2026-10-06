import { AppError } from '../utils/response.js';

/** 404 兜底 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: { message: `接口不存在: ${req.method} ${req.path}`, code: 'NOT_FOUND' },
  });
}

/**
 * 统一错误处理。
 * 原则（对应产品要求「不能出现『系统错误』然后什么都没有」）：
 *   - 业务异常（AppError）→ 把可读的中文原因返回给前端
 *   - 文件过大 / 类型不对 → 给出人话提示
 *   - 未知异常 → 记录日志，返回可重试的提示，而不是裸奔的堆栈
 */
export function errorHandler(err, req, res, _next) {
  // multer 的错误
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      ok: false,
      error: { message: '图片太大了，请压缩后再上传（单张不超过 20MB）', code: 'FILE_TOO_LARGE' },
    });
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      ok: false,
      error: { message: '上传字段名不正确', code: 'UPLOAD_FIELD' },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      ok: false,
      error: { message: err.message, code: err.code },
    });
  }

  // SQLite 约束错误转成人话
  const msg = String(err?.message || '');
  if (msg.includes('UNIQUE constraint failed')) {
    return res.status(409).json({
      ok: false,
      error: { message: '这条记录已存在，请不要重复添加', code: 'DUPLICATE' },
    });
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return res.status(400).json({
      ok: false,
      error: { message: '关联的数据不存在，可能已被删除', code: 'FK_FAILED' },
    });
  }

  console.error('[UNHANDLED]', req.method, req.originalUrl, err);
  return res.status(500).json({
    ok: false,
    error: { message: '服务暂时出了点问题，请稍后重试', code: 'INTERNAL' },
  });
}
