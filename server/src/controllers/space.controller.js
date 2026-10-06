import * as spaceRepo from '../db/repositories/space.repo.js';
import * as locationRepo from '../db/repositories/location.repo.js';
import { ok, notFound, badRequest } from '../utils/response.js';
import { parseId, parseNullableInt } from '../middleware/family.js';
import { refreshAllPaths } from '../services/container.service.js';

/* ---------------- 空间 ---------------- */

export function listSpaces(req, res) {
  return ok(res, spaceRepo.listSpaces(req.familyId));
}

export function getSpace(req, res) {
  const space = spaceRepo.getSpace(parseId(req.params.id), req.familyId);
  if (!space) throw notFound('空间');
  const locations = locationRepo.listLocations(req.familyId, space.id);
  return ok(res, { ...space, locations });
}

export function createSpace(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('空间名称不能为空');
  const created = spaceRepo.createSpace({
    familyId: req.familyId,
    name,
    icon: req.body?.icon ?? null,
    sortOrder: req.body?.sortOrder ?? 0,
  });
  return ok(res, created);
}

export function updateSpace(req, res) {
  const id = parseId(req.params.id);
  if (!spaceRepo.getSpace(id, req.familyId)) throw notFound('空间');
  const updated = spaceRepo.updateSpace(id, req.familyId, {
    name: req.body?.name,
    icon: req.body?.icon,
    sortOrder: req.body?.sortOrder,
  });
  // 空间名变了 → 所有盒子的路径缓存必须重算，否则显示的位置还是旧名字
  if (req.body?.name !== undefined) refreshAllPaths(req.familyId);
  return ok(res, updated);
}

export function deleteSpace(req, res) {
  const id = parseId(req.params.id);
  if (!spaceRepo.getSpace(id, req.familyId)) throw notFound('空间');
  const containerCount = spaceRepo.countContainersInSpace(id);
  spaceRepo.deleteSpace(id, req.familyId);
  refreshAllPaths(req.familyId);
  return ok(res, { deleted: true, detachedContainers: containerCount });
}

/* ---------------- 区域 / 家具 ---------------- */

export function listLocations(req, res) {
  const spaceId = parseNullableInt(req.query.spaceId);
  return ok(res, locationRepo.listLocations(req.familyId, spaceId));
}

export function getLocation(req, res) {
  const loc = locationRepo.getLocation(parseId(req.params.id), req.familyId);
  if (!loc) throw notFound('区域');
  return ok(res, loc);
}

export function createLocation(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('区域名称不能为空');
  const created = locationRepo.createLocation({
    familyId: req.familyId,
    spaceId: parseNullableInt(req.body?.spaceId),
    name,
    note: req.body?.note ?? null,
    sortOrder: req.body?.sortOrder ?? 0,
  });
  return ok(res, created);
}

export function updateLocation(req, res) {
  const id = parseId(req.params.id);
  if (!locationRepo.getLocation(id, req.familyId)) throw notFound('区域');
  const patch = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body?.spaceId !== undefined) patch.spaceId = parseNullableInt(req.body.spaceId);
  if (req.body?.note !== undefined) patch.note = req.body.note;
  if (req.body?.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;
  const updated = locationRepo.updateLocation(id, req.familyId, patch);
  // 区域名或归属变了 → 重算路径
  refreshAllPaths(req.familyId);
  return ok(res, updated);
}

export function deleteLocation(req, res) {
  const id = parseId(req.params.id);
  if (!locationRepo.getLocation(id, req.familyId)) throw notFound('区域');
  locationRepo.deleteLocation(id, req.familyId);
  refreshAllPaths(req.familyId);
  return ok(res, { deleted: true });
}
