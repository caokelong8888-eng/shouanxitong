import * as itemRepo from '../db/repositories/item.repo.js';
import * as stockRepo from '../db/repositories/stock.repo.js';
import * as tagRepo from '../db/repositories/tag.repo.js';
import * as imageRepo from '../db/repositories/image.repo.js';
import * as containerRepo from '../db/repositories/container.repo.js';
import * as categoryRepo from '../db/repositories/category.repo.js';
import * as logRepo from '../db/repositories/activity.repo.js';
import * as imageGc from './image-gc.service.js';
import { getDb } from '../db/connection.js';
import { badRequest, notFound } from '../utils/response.js';
import { ITEM_STATUS } from '../middleware/family.js';

/**
 * 物品 + 库存业务逻辑。
 *
 * 【铁律】数量只存在 stock 层：
 *   一个 item（AA电池）可以有多条 stock（盒子02: 8节、盒子08: 12节）。
 *   item 表里绝不出现 quantity / container_id。
 */

function assertStatus(status) {
  if (status !== undefined && status !== null && !ITEM_STATUS.includes(status)) {
    throw badRequest(`物品状态不合法: ${status}`);
  }
}

export function listItems(familyId, filters) {
  const { rows, total } = itemRepo.listItems(familyId, filters);
  const tagMap = tagRepo.listTagsForItems(rows.map((r) => r.id));
  const items = rows.map((r) => attachCover({ ...r, tags: tagMap[r.id] || [] }));
  return { items, total };
}

/** 挂上封面缩略图地址，列表页直接用 */
function attachCover(item) {
  const cover = imageRepo.getCoverImageForItem(item.id);
  return {
    ...item,
    cover_thumb_url: cover?.thumb_url || cover?.url || null,
    cover_url: cover?.url || null,
  };
}

/** 物品详情：物品 + 所有位置库存 + 图片 + 标签 */
export function getItemDetail(id, familyId) {
  const item = itemRepo.getItem(id, familyId);
  if (!item) throw notFound('物品');
  const stocks = stockRepo.listStockByItem(id);
  const images = imageRepo.listImagesByItem(id);
  const tags = tagRepo.listItemTags(id);

  // 位置聚合：方便前端直接显示「盒子02: 8节 / 盒子08: 12节」
  const places = stocks.map((s) => ({
    stock_id: s.id,
    container_id: s.container_id,
    container_code: s.container_code,
    container_name: s.container_name,
    full_path: s.full_path,
    quantity: s.quantity,
    status: s.status,
    note: s.note,
    in_box: s.container_id !== null,
  }));

  return { ...item, tags, images, stocks: places, places };
}

export function createItem(familyId, userId, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw badRequest('物品名称不能为空');
  assertStatus(payload.status);

  // 分类：允许直接传分类名（AI 识别的结果通常就是名字）
  let categoryId = payload.categoryId ?? null;
  if (!categoryId && payload.category) {
    categoryId = categoryRepo.ensureCategory(familyId, String(payload.category).trim())?.id ?? null;
  } else if (categoryId && !categoryRepo.getCategory(categoryId, familyId)) {
    throw badRequest('指定的分类不存在');
  }

  // 指定了盒子就先把盒子查出来 —— 放在事务外查，
  // 校验失败可以直接抛错，不用先开事务再回滚
  let container = null;
  if (payload.containerId) {
    container = containerRepo.getContainer(Number(payload.containerId), familyId);
    if (!container) throw badRequest('指定的盒子不存在');
  }

  // 【为什么要事务】这里是 5 步写操作：建物品 → 写标签 → 刷新搜索词 → 写库存 → 绑图片。
  // 不包事务的话，中途任一步失败就会留下「东西建了但没进盒子」的半截数据 ——
  // 用户在盒子里找不到它，搜索里却又能搜到，非常难排查。
  // （入库那条路径 persistInboundItem 一直是这么做的，这里补齐，保持一致）
  const run = getDb().transaction(() => {
    const created = itemRepo.createItem({
      familyId,
      name,
      categoryId,
      description: payload.description ?? payload.desc ?? null,
      brand: payload.brand ?? null,
      model: payload.model ?? null,
      color: payload.color ?? null,
      unit: payload.unit ?? null,
      status: payload.status ?? 'in_box',
      aiConfidence: payload.confidence ?? payload.aiConfidence ?? null,
      needConfirm: payload.needConfirm ?? false,
      userId,
    });

    if (Array.isArray(payload.tags) && payload.tags.length) {
      tagRepo.setItemTags(created.id, familyId, payload.tags);
    }
    itemRepo.refreshSearchText(created.id);

    // 可选：直接放进某个盒子
    if (container) {
      stockRepo.upsertStock({
        itemId: created.id,
        containerId: container.id,
        quantity: payload.quantity ?? 1,
        status: 'in_box',
        note: payload.note ?? null,
      });
    }

    // 可选：绑定已上传的图片
    if (Array.isArray(payload.imageIds) && payload.imageIds.length) {
      const imgs = imageRepo.getImagesByIds(payload.imageIds);
      imageRepo.bindImagesToItem(payload.imageIds, created.id, imgs[0]?.id ?? null);
    }

    logRepo.log({
      familyId,
      userId,
      action: 'create',
      entityType: 'item',
      entityId: created.id,
      summary: `添加了${name}`,
    });

    return created.id;
  });

  const newId = run();
  return getItemDetail(newId, familyId);
}

export function updateItem(id, familyId, userId, payload) {
  const existing = itemRepo.getItem(id, familyId);
  if (!existing) throw notFound('物品');
  assertStatus(payload.status);

  const patch = {};
  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) throw badRequest('物品名称不能为空');
    patch.name = name;
  }
  for (const key of ['description', 'brand', 'model', 'color', 'unit', 'status']) {
    if (payload[key] !== undefined) patch[key] = payload[key];
  }
  if (payload.categoryId !== undefined) patch.categoryId = payload.categoryId;
  if (payload.category !== undefined && !payload.categoryId) {
    patch.categoryId = categoryRepo.ensureCategory(familyId, String(payload.category).trim())?.id ?? null;
  }
  if (payload.needConfirm !== undefined) patch.needConfirm = payload.needConfirm;
  // 人工修改后就不再是「待确认」状态
  if (payload.name !== undefined || payload.categoryId !== undefined || payload.category !== undefined) {
    if (payload.needConfirm === undefined) patch.needConfirm = false;
  }
  patch.userId = userId;

  itemRepo.updateItem(id, familyId, patch);

  if (Array.isArray(payload.tags)) {
    tagRepo.setItemTags(id, familyId, payload.tags);
  }
  itemRepo.refreshSearchText(id);

  logRepo.log({
    familyId,
    userId,
    action: 'update',
    entityType: 'item',
    entityId: id,
    summary: `修改了${patch.name || existing.name}`,
  });

  return getItemDetail(id, familyId);
}

export function deleteItem(id, familyId, userId) {
  const existing = itemRepo.getItem(id, familyId);
  if (!existing) throw notFound('物品');

  // 路径必须在这一步之前收好 —— 下面删完行，SQLite 的级联就把记录清没了
  const imageRows = imageGc.collectImageRowsOfItem(id);

  stockRepo.deleteStockByItem(id);
  itemRepo.deleteItem(id, familyId);

  // 磁盘文件单独清。级联只管数据库，管不到磁盘上的图片文件。
  // 这里刻意不 await —— 让删除接口立刻返回，文件清理在后台收尾。
  imageGc.removeFilesForImages(imageRows).catch((err) => {
    console.warn('[item] 图片文件清理未完全成功:', err.message);
  });

  logRepo.log({
    familyId,
    userId,
    action: 'delete',
    entityType: 'item',
    entityId: id,
    summary: `删除了${existing.name}`,
  });
  return { deleted: true };
}

/** 把物品放进某个盒子（新增位置） */
export function addStock(familyId, userId, payload) {
  const item = itemRepo.getItem(Number(payload.itemId), familyId);
  if (!item) throw badRequest('物品不存在');
  assertStatus(payload.status);

  let containerId = payload.containerId ?? null;
  if (containerId !== null && containerId !== '') {
    const container = containerRepo.getContainer(Number(containerId), familyId);
    if (!container) throw badRequest('盒子不存在');
    containerId = container.id;
  } else {
    containerId = null; // 不在任何盒子（在家使用 / 借出）
  }

  const stock = stockRepo.upsertStock({
    itemId: item.id,
    containerId,
    quantity: payload.quantity ?? 1,
    status: payload.status ?? (containerId ? 'in_box' : 'in_use'),
    note: payload.note ?? null,
  });

  logRepo.log({
    familyId,
    userId,
    action: 'create',
    entityType: 'stock',
    entityId: stock.id,
    summary: containerId
      ? `把${item.name}放进了${stock.container_name}`
      : `把${item.name}标记为不在盒子里`,
  });

  return getItemDetail(item.id, familyId);
}

/** 修改某条库存：改数量 / 改状态 / 换盒子 */
export function updateStock(familyId, userId, stockId, payload) {
  const existing = stockRepo.getStock(stockId);
  if (!existing) throw notFound('库存记录');
  const item = itemRepo.getItem(existing.item_id, familyId);
  if (!item) throw notFound('物品');
  assertStatus(payload.status);

  const patch = {};
  if (payload.quantity !== undefined) {
    const q = Number(payload.quantity);
    if (!Number.isFinite(q) || q < 0) throw badRequest('数量必须是不小于 0 的数字');
    patch.quantity = q;
  }
  if (payload.status !== undefined) patch.status = payload.status;
  if (payload.note !== undefined) patch.note = payload.note;

  let movedTo = null;
  if (payload.containerId !== undefined) {
    const raw = payload.containerId;
    if (raw === null || raw === '') {
      patch.containerId = null;
    } else {
      const container = containerRepo.getContainer(Number(raw), familyId);
      if (!container) throw badRequest('盒子不存在');
      patch.containerId = container.id;
      movedTo = container;
      // 换到别的盒子时，同物品同盒子已有记录 → 合并，避免重复行
      const clash = stockRepo.findStock(existing.item_id, container.id);
      if (clash && clash.id !== Number(stockId)) {
        stockRepo.updateStock(clash.id, {
          quantity: Number(clash.quantity) + Number(patch.quantity ?? existing.quantity),
        });
        stockRepo.deleteStock(stockId);
        logRepo.log({
          familyId,
          userId,
          action: 'move',
          entityType: 'stock',
          entityId: clash.id,
          summary: `把${item.name}合并到了${container.name}`,
        });
        return getItemDetail(item.id, familyId);
      }
    }
  }

  stockRepo.updateStock(stockId, patch);

  logRepo.log({
    familyId,
    userId,
    action: movedTo ? 'move' : 'update',
    entityType: 'stock',
    entityId: stockId,
    summary: movedTo ? `把${item.name}移动到${movedTo.name}` : `调整了${item.name}的数量`,
  });

  return getItemDetail(item.id, familyId);
}

export function removeStock(familyId, userId, stockId) {
  const existing = stockRepo.getStock(stockId);
  if (!existing) throw notFound('库存记录');
  if (!itemRepo.getItem(existing.item_id, familyId)) throw notFound('物品');
  stockRepo.deleteStock(stockId);
  logRepo.log({
    familyId,
    userId,
    action: 'delete',
    entityType: 'stock',
    entityId: stockId,
    summary: `移除了${existing.item_name}的一条存放记录`,
  });
  return getItemDetail(existing.item_id, familyId);
}
