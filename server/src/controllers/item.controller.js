import * as itemService from '../services/item.service.js';
import { ok } from '../utils/response.js';
import { parseId, parseNullableInt, parseLimit } from '../middleware/family.js';

export function listItems(req, res) {
  const { items, total } = itemService.listItems(req.familyId, {
    categoryId: parseNullableInt(req.query.categoryId),
    status: req.query.status ? String(req.query.status) : null,
    keyword: req.query.keyword ? String(req.query.keyword).trim() : null,
    limit: parseLimit(req.query.limit, 50),
    offset: Number(req.query.offset) || 0,
  });
  return ok(res, items, { total });
}

export function getItem(req, res) {
  return ok(res, itemService.getItemDetail(parseId(req.params.id), req.familyId));
}

export function createItem(req, res) {
  return ok(res, itemService.createItem(req.familyId, req.userId, req.body || {}));
}

export function updateItem(req, res) {
  return ok(res, itemService.updateItem(parseId(req.params.id), req.familyId, req.userId, req.body || {}));
}

export function deleteItem(req, res) {
  return ok(res, itemService.deleteItem(parseId(req.params.id), req.familyId, req.userId));
}

/* ---------------- 库存（多位置） ---------------- */

export function createStock(req, res) {
  return ok(res, itemService.addStock(req.familyId, req.userId, req.body || {}));
}

export function updateStock(req, res) {
  return ok(res, itemService.updateStock(req.familyId, req.userId, parseId(req.params.id), req.body || {}));
}

export function deleteStock(req, res) {
  return ok(res, itemService.removeStock(req.familyId, req.userId, parseId(req.params.id)));
}
