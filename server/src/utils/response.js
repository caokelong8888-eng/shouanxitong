/**
 * 统一响应格式。全站 API 一律返回 { ok, data, error }，
 * 前端只需判断 ok，不用猜各家接口的形状。
 */
export function ok(res, data, meta) {
  const body = { ok: true, data };
  if (meta) body.meta = meta;
  return res.json(body);
}

export function fail(res, status, message, code) {
  return res.status(status).json({
    ok: false,
    error: { message, code: code || 'ERROR' },
  });
}

/** 异步路由包装，避免每个 controller 都写 try/catch */
export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** 业务异常：可携带 HTTP 状态码 */
export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 常见错误快捷抛出 */
export const notFound = (what = '资源') => new AppError(`${what}不存在`, 404, 'NOT_FOUND');
export const badRequest = (msg) => new AppError(msg, 400, 'BAD_REQUEST');
