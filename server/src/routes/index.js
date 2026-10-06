import { Router } from 'express';
import { asyncRoute } from '../utils/response.js';
import { familyContext } from '../middleware/family.js';
import { requireAuth, login, check, logout } from '../middleware/auth.js';

import * as spaceCtrl from '../controllers/space.controller.js';
import * as containerCtrl from '../controllers/container.controller.js';
import * as itemCtrl from '../controllers/item.controller.js';
import * as miscCtrl from '../controllers/misc.controller.js';
import * as uploadCtrl from '../controllers/upload.controller.js';
import * as aiCtrl from '../controllers/ai.controller.js';

/**
 * API 路由总表。
 * 全部挂在 /api 下，统一走 familyContext 注入家庭上下文。
 *
 * 鉴权顺序：
 *   /auth/*  → 不需要令牌（否则没法登录）
 *   /health  → 不需要令牌（部署自检、负载均衡探活用）
 *   其余全部 → requireAuth
 */
export function buildRoutes() {
  const router = Router();

  router.use(familyContext);

  // ---- 公开：登录与自检 ----
  router.post('/auth/login', asyncRoute(login));
  router.get('/auth/check', requireAuth, asyncRoute(check));
  router.post('/auth/logout', asyncRoute(logout));
  router.get('/health', asyncRoute(miscCtrl.health));

  // ---- 以下全部需要登录 ----
  router.use(requireAuth);

  // 家庭
  router.get('/families/current', asyncRoute(miscCtrl.currentFamily));
  router.get('/overview', asyncRoute(miscCtrl.overview));
  router.post('/admin/rebuild-paths', asyncRoute(miscCtrl.rebuildPaths));

  // 空间
  router.get('/spaces', asyncRoute(spaceCtrl.listSpaces));
  router.post('/spaces', asyncRoute(spaceCtrl.createSpace));
  router.get('/spaces/:id', asyncRoute(spaceCtrl.getSpace));
  router.patch('/spaces/:id', asyncRoute(spaceCtrl.updateSpace));
  router.delete('/spaces/:id', asyncRoute(spaceCtrl.deleteSpace));

  // 区域 / 家具
  router.get('/locations', asyncRoute(spaceCtrl.listLocations));
  router.post('/locations', asyncRoute(spaceCtrl.createLocation));
  router.get('/locations/:id', asyncRoute(spaceCtrl.getLocation));
  router.patch('/locations/:id', asyncRoute(spaceCtrl.updateLocation));
  router.delete('/locations/:id', asyncRoute(spaceCtrl.deleteLocation));

  // 盒子（容器）
  // 注意：/code/:code 必须放在 /:id 之前，否则会被 :id 吃掉
  router.get('/containers', asyncRoute(containerCtrl.listContainers));
  router.get('/containers/next-code', asyncRoute(containerCtrl.nextCode));
  router.get('/containers/code/:code', asyncRoute(containerCtrl.getContainerByCode));
  router.post('/containers', asyncRoute(containerCtrl.createContainer));
  router.get('/containers/:id', asyncRoute(containerCtrl.getContainer));
  router.patch('/containers/:id', asyncRoute(containerCtrl.updateContainer));
  router.delete('/containers/:id', asyncRoute(containerCtrl.deleteContainer));
  router.get('/containers/:id/qrcode', asyncRoute(containerCtrl.getContainerQrcode));
  router.get('/containers/:id/images', asyncRoute(containerCtrl.listContainerImages));

  // 物品
  router.get('/items', asyncRoute(itemCtrl.listItems));
  router.post('/items', asyncRoute(itemCtrl.createItem));
  router.get('/items/:id', asyncRoute(itemCtrl.getItem));
  router.patch('/items/:id', asyncRoute(itemCtrl.updateItem));
  router.delete('/items/:id', asyncRoute(itemCtrl.deleteItem));

  // 库存（多位置）
  router.post('/stocks', asyncRoute(itemCtrl.createStock));
  router.patch('/stocks/:id', asyncRoute(itemCtrl.updateStock));
  router.delete('/stocks/:id', asyncRoute(itemCtrl.deleteStock));

  // 搜索
  router.get('/search', asyncRoute(miscCtrl.search));

  // 分类 / 标签
  router.get('/categories', asyncRoute(miscCtrl.listCategories));
  router.post('/categories', asyncRoute(miscCtrl.createCategory));
  router.patch('/categories/:id', asyncRoute(miscCtrl.updateCategory));
  router.delete('/categories/:id', asyncRoute(miscCtrl.deleteCategory));
  router.get('/tags', asyncRoute(miscCtrl.listTags));
  router.post('/tags', asyncRoute(miscCtrl.createTag));
  router.delete('/tags/:id', asyncRoute(miscCtrl.deleteTag));

  // 日志
  router.get('/activity-logs', asyncRoute(miscCtrl.listLogs));

  // 图片上传与 AI 识别
  router.post('/uploads/image', uploadCtrl.uploadMiddleware, asyncRoute(uploadCtrl.uploadImage));
  router.post('/uploads/batch', uploadCtrl.uploadArrayMiddleware, asyncRoute(uploadCtrl.uploadBatch));
  router.post('/recognize', asyncRoute(aiCtrl.recognize));
  router.post('/recognize/what-is-this', asyncRoute(aiCtrl.whatIsThis));
  router.post('/inbound/batch', asyncRoute(aiCtrl.batchInbound));

  return router;
}
