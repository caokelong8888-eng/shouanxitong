import * as searchService from '../services/search.service.js';
import * as categoryRepo from '../db/repositories/category.repo.js';
import * as tagRepo from '../db/repositories/tag.repo.js';
import * as activityRepo from '../db/repositories/activity.repo.js';
import * as containerRepo from '../db/repositories/container.repo.js';
import * as itemRepo from '../db/repositories/item.repo.js';
import { getDb } from '../db/connection.js';
import { ok, notFound, badRequest } from '../utils/response.js';
import { parseId, parseLimit } from '../middleware/family.js';
import { refreshAllPaths } from '../services/container.service.js';
import { config } from '../config/index.js';

/* ---------------- 搜索 ---------------- */

export function search(req, res) {
  const result = searchService.search(req.familyId, {
    q: req.query.q ?? req.query.keyword ?? '',
    type: String(req.query.type || 'keyword'),
    categoryId: req.query.categoryId,
    tag: req.query.tag,
    limit: parseLimit(req.query.limit, 30),
  });
  return ok(res, result);
}

/* ---------------- 分类 ---------------- */

export function listCategories(req, res) {
  return ok(res, categoryRepo.listCategories(req.familyId));
}

export function createCategory(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('分类名称不能为空');
  return ok(
    res,
    categoryRepo.createCategory({
      familyId: req.familyId,
      name,
      icon: req.body?.icon ?? null,
      parentId: req.body?.parentId ?? null,
      sortOrder: req.body?.sortOrder ?? 0,
    })
  );
}

export function updateCategory(req, res) {
  const id = parseId(req.params.id);
  if (!categoryRepo.getCategory(id, req.familyId)) throw notFound('分类');
  return ok(res, categoryRepo.updateCategory(id, req.familyId, req.body || {}));
}

export function deleteCategory(req, res) {
  const id = parseId(req.params.id);
  const cat = categoryRepo.getCategory(id, req.familyId);
  if (!cat) throw notFound('分类');
  if (cat.is_system) throw badRequest('系统预置分类不能删除');
  const used = categoryRepo.countItemsInCategory(id);
  if (used > 0) throw badRequest(`还有 ${used} 个物品属于这个分类，请先改掉再删除`);
  categoryRepo.deleteCategory(id, req.familyId);
  return ok(res, { deleted: true });
}

/* ---------------- 标签 ---------------- */

export function listTags(req, res) {
  return ok(res, tagRepo.listTags(req.familyId));
}

export function createTag(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('标签名称不能为空');
  return ok(res, tagRepo.ensureTag(req.familyId, name, req.body?.color ?? null));
}

export function deleteTag(req, res) {
  const id = parseId(req.params.id);
  tagRepo.deleteTag(id, req.familyId);
  return ok(res, { deleted: true });
}

/* ---------------- 操作日志 ---------------- */

export function listLogs(req, res) {
  return ok(res, activityRepo.listLogs(req.familyId, parseLimit(req.query.limit, 30)));
}

/* ---------------- 家庭信息 & 首页概览 ---------------- */

export function currentFamily(req, res) {
  const db = getDb();
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(req.familyId);
  if (!family) throw notFound('家庭');
  const users = db.prepare('SELECT id, name, role FROM users WHERE family_id = ? ORDER BY id').all(req.familyId);
  return ok(res, { ...family, members: users });
}

/** 首页概览：一次请求把首页需要的都拿到，减少手机端请求数 */
export function overview(req, res) {
  const familyId = req.familyId;
  const db = getDb();

  const counts = {
    spaces: db.prepare('SELECT COUNT(*) c FROM spaces WHERE family_id = ?').get(familyId).c,
    locations: db.prepare('SELECT COUNT(*) c FROM locations WHERE family_id = ?').get(familyId).c,
    containers: db.prepare('SELECT COUNT(*) c FROM containers WHERE family_id = ?').get(familyId).c,
    items: db.prepare('SELECT COUNT(*) c FROM items WHERE family_id = ?').get(familyId).c,
    pieces: db.prepare('SELECT COALESCE(SUM(quantity),0) c FROM stock WHERE item_id IN (SELECT id FROM items WHERE family_id = ?)').get(familyId).c,
  };

  const recentContainers = containerRepo.listContainers(familyId).slice(0, 6);
  const recentItems = itemRepo.listItems(familyId, { limit: 8 }).rows;
  const logs = activityRepo.listLogs(familyId, 6);

  return ok(res, { counts, recentContainers, recentItems, logs });
}

/** 手动触发路径重算（改名后兜底用） */
export function rebuildPaths(req, res) {
  return ok(res, { updated: refreshAllPaths(req.familyId) });
}

export function health(req, res) {
  return ok(res, {
    status: 'up',
    time: new Date().toISOString(),
    storageDriver: config.storage.driver,
    aiDriver: config.ai.driver,
  });
}
