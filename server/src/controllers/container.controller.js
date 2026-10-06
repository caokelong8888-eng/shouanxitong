import * as containerService from '../services/container.service.js';
import * as imageRepo from '../db/repositories/image.repo.js';
import { ok, notFound, badRequest } from '../utils/response.js';
import { parseId, parseNullableInt, parseLimit } from '../middleware/family.js';
import { makeQrPng, makeQrDataUrl, buildScanUrl } from '../utils/qrcode.js';

export function listContainers(req, res) {
  const rows = containerService.listContainers(req.familyId, {
    locationId: parseNullableInt(req.query.locationId),
    spaceId: parseNullableInt(req.query.spaceId),
    keyword: req.query.keyword ? String(req.query.keyword).trim() : null,
  });
  return ok(res, rows, { total: rows.length });
}

export function getContainer(req, res) {
  return ok(res, containerService.getContainerDetail(parseId(req.params.id), req.familyId));
}

/** 扫码直达：GET /api/containers/code/B03 */
export function getContainerByCode(req, res) {
  const code = String(req.params.code || '').trim();
  if (!code) throw badRequest('缺少盒子编号');
  return ok(res, containerService.getContainerDetailByCode(code));
}

export function createContainer(req, res) {
  return ok(res, containerService.createContainer(req.familyId, req.userId, req.body || {}));
}

export function updateContainer(req, res) {
  return ok(res, containerService.updateContainer(parseId(req.params.id), req.familyId, req.userId, req.body || {}));
}

export function deleteContainer(req, res) {
  return ok(res, containerService.deleteContainer(parseId(req.params.id), req.familyId, req.userId));
}

/** 盒子的下一个可用编号（新建盒子时前端预填） */
export function nextCode(req, res) {
  return ok(res, { code: containerService.nextContainerCode(req.familyId) });
}

/** 盒子二维码：默认返回图片流，?format=json 返回信息 + DataURL */
export async function getContainerQrcode(req, res) {
  const container = containerService.getContainerDetail(parseId(req.params.id), req.familyId);
  if (!container) throw notFound('盒子');

  if (String(req.query.format || '') === 'json') {
    return ok(res, {
      code: container.code,
      name: container.name,
      scan_url: buildScanUrl(container.code),
      data_url: await makeQrDataUrl(container.code, { width: Number(req.query.width) || 480 }),
    });
  }

  const png = await makeQrPng(container.code, { width: Number(req.query.width) || 480 });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(png);
}

/** 盒子照片墙：单独更新封面/照片顺序（第二阶段做拖拽，这里先支持替换） */
export function listContainerImages(req, res) {
  const id = parseId(req.params.id);
  return ok(res, imageRepo.listImagesByContainer(id));
}
