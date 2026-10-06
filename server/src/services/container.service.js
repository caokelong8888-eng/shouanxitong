import * as containerRepo from '../db/repositories/container.repo.js';
import * as spaceRepo from '../db/repositories/space.repo.js';
import * as locationRepo from '../db/repositories/location.repo.js';
import * as stockRepo from '../db/repositories/stock.repo.js';
import * as imageRepo from '../db/repositories/image.repo.js';
import * as logRepo from '../db/repositories/activity.repo.js';
import * as imageGc from './image-gc.service.js';
import { badRequest, notFound } from '../utils/response.js';

/**
 * 容器（收纳盒）业务逻辑。
 *
 * 【关键设计】full_path 路径缓存：
 *   盒子存一份完整路径文本（如「书房 / 柜子A / 第二层 / 盒子03」），
 *   好处是列表页和搜索结果不用联表就能直接显示位置。
 *   代价是父子结构改名后必须重算 —— 所以重算逻辑集中在本文件，
 *   不准在其他地方直接 UPDATE full_path。
 */

/**
 * 组装单个盒子的路径文本。
 *
 * 规则（对应「不要求所有层级都必须填写」）：
 *   - detail 是盒子自身的层级描述，紧贴在盒子名前面，中间不插空层级
 *   - 若有区域：空间 / 区域 / 细节 / 盒子名
 *   - 若无区域：空间 / 细节 / 盒子名
 *   - 无空间无区域：细节 / 盒子名（或仅盒子名）
 * 反例：有空间没区域时不能拼成「厨房 / 第一层 / 测试盒子09」这种让人误以为第一层是区域的路径。
 */
export function buildPath({ spaceName, locationName, detail, name }) {
  const parts = [];
  if (spaceName) parts.push(spaceName);
  if (locationName) parts.push(locationName);
  if (detail) parts.push(detail);
  if (name) parts.push(name);
  return parts.join(' / ');
}

/** 重算并写入单个盒子的路径 */
export function refreshContainerPath(containerId) {
  const c = containerRepo.getContainerByIdRaw(containerId);
  if (!c) return null;
  const space = c.space_id ? spaceRepo.getSpace(c.space_id, c.family_id) : null;
  const loc = c.location_id ? locationRepo.getLocation(c.location_id, c.family_id) : null;
  const fullPath = buildPath({
    spaceName: space?.name,
    locationName: loc?.name,
    detail: c.detail,
    name: c.name,
  });
  containerRepo.updateContainerPath(containerId, fullPath);
  return fullPath;
}

/** 重算某个家庭下所有盒子的路径（改空间名/区域名之后调用） */
export function refreshAllPaths(familyId) {
  const rows = containerRepo.listContainersForPath(familyId);
  for (const r of rows) {
    const fullPath = buildPath({
      spaceName: r.space_name,
      locationName: r.location_name,
      detail: r.detail,
      name: r.name,
    });
    containerRepo.updateContainerPath(r.id, fullPath);
  }
  return rows.length;
}

/**
 * 自动生成下一个盒号：B01 / B02 ...
 * 规则：取现有 Bxx 里的最大数字 +1。不重复、可读、方便贴标签。
 */
export function nextContainerCode(familyId) {
  const codes = containerRepo.listAllCodes(familyId);
  let max = 0;
  for (const code of codes) {
    const m = /^B?(\d+)$/i.exec(String(code).trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `B${String(max + 1).padStart(2, '0')}`;
}

export function listContainers(familyId, filters) {
  return containerRepo.listContainers(familyId, filters);
}

/** 盒子详情：盒子本身 + 里面所有物品 + 盒子照片 */
export function getContainerDetail(id, familyId) {
  const container = containerRepo.getContainer(id, familyId);
  if (!container) throw notFound('盒子');
  const items = stockRepo.listStockByContainer(id);
  const images = imageRepo.listContainerPhotoWall(id);
  return { ...container, items, images };
}

/** 扫码直达：按 code 取盒子详情 */
export function getContainerDetailByCode(code) {
  const container = containerRepo.getContainerByCode(code);
  if (!container) throw notFound(`盒子 ${code}`);
  const items = stockRepo.listStockByContainer(container.id);
  const images = imageRepo.listContainerPhotoWall(container.id);
  return { ...container, items, images };
}

export function createContainer(familyId, userId, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('盒子名称不能为空');

  // 校验空间 / 区域归属，避免挂到别人家（或不存在）的节点上
  let spaceId = payload.spaceId ?? null;
  let locationId = payload.locationId ?? null;
  if (spaceId && !spaceRepo.getSpace(spaceId, familyId)) throw badRequest('指定的空间不存在');
  if (locationId) {
    const loc = locationRepo.getLocation(locationId, familyId);
    if (!loc) throw badRequest('指定的区域不存在');
    // 只选了区域没选空间时，自动继承区域所属空间
    if (!spaceId) spaceId = loc.space_id;
  }

  const code = String(payload.code || '').trim() || nextContainerCode(familyId);

  const created = containerRepo.createContainer({
    familyId,
    spaceId,
    locationId,
    code,
    name,
    detail: payload.detail ?? null,
    note: payload.note ?? null,
    sortOrder: payload.sortOrder ?? 0,
    userId,
  });
  refreshContainerPath(created.id);
  logRepo.log({
    familyId,
    userId,
    action: 'create',
    entityType: 'container',
    entityId: created.id,
    summary: `创建了${name}`,
  });
  return getContainerDetail(created.id, familyId);
}

/**
 * 更新盒子 —— 支持「移动盒子」。
 * 移动只改 container 自己这一行，里面的物品通过 stock.container_id 自动跟随，
 * 不需要（也绝不允许）逐个改物品位置。
 */
export function updateContainer(id, familyId, userId, payload) {
  const existing = containerRepo.getContainer(id, familyId);
  if (!existing) throw notFound('盒子');

  const patch = {};
  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) throw badRequest('盒子名称不能为空');
    patch.name = name;
  }
  if (payload.code !== undefined) patch.code = String(payload.code).trim();
  if (payload.detail !== undefined) patch.detail = payload.detail;
  if (payload.note !== undefined) patch.note = payload.note;
  if (payload.sortOrder !== undefined) patch.sortOrder = payload.sortOrder;

  if (payload.spaceId !== undefined) {
    const spaceId = payload.spaceId === null || payload.spaceId === '' ? null : Number(payload.spaceId);
    if (spaceId && !spaceRepo.getSpace(spaceId, familyId)) throw badRequest('指定的空间不存在');
    patch.spaceId = spaceId;
  }
  if (payload.locationId !== undefined) {
    const locationId = payload.locationId === null || payload.locationId === '' ? null : Number(payload.locationId);
    if (locationId) {
      const loc = locationRepo.getLocation(locationId, familyId);
      if (!loc) throw badRequest('指定的区域不存在');
      // 区域换了但没指定空间 → 继承新区域的空间
      if (payload.spaceId === undefined) patch.spaceId = loc.space_id;
    }
    patch.locationId = locationId;
  }
  patch.userId = userId;

  containerRepo.updateContainer(id, familyId, patch);
  refreshContainerPath(id); // 路径缓存统一重算

  const movedSpace = payload.spaceId !== undefined || payload.locationId !== undefined;
  logRepo.log({
    familyId,
    userId,
    action: movedSpace ? 'move' : 'update',
    entityType: 'container',
    entityId: id,
    summary: movedSpace ? `移动了${existing.name}` : `修改了${existing.name}`,
  });

  return getContainerDetail(id, familyId);
}

export function deleteContainer(id, familyId, userId) {
  const existing = containerRepo.getContainer(id, familyId);
  if (!existing) throw notFound('盒子');
  const stockCount = containerRepo.countStockInContainer(id);

  // 只收盒子自己拍的那些照片（container_id = id）。
  // 里面物品的照片属于物品、不属于盒子 —— 删盒子不该让物品也没照片。
  const imageRows = imageGc.collectImageRowsOfContainer(id);

  containerRepo.deleteContainer(id, familyId);

  // 磁盘文件同步清（级联只管数据库）
  imageGc.removeFilesForImages(imageRows).catch((err) => {
    console.warn('[container] 盒子照片清理未完全成功:', err.message);
  });

  logRepo.log({
    familyId,
    userId,
    action: 'delete',
    entityType: 'container',
    entityId: id,
    summary: `删除了${existing.name}（连带 ${stockCount} 条库存记录）`,
  });
  return { deleted: true, removedStock: stockCount };
}
