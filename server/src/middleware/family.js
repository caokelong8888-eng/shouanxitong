import { config } from '../config/index.js';
import { badRequest } from '../utils/response.js';

/** 物品状态枚举（前后端共用契约） */
export const ITEM_STATUS = ['in_box', 'in_use', 'temp', 'lent', 'in_car', 'discarded', 'given_away'];

/** 状态的中文文案，直接用于展示 */
export const STATUS_LABEL = {
  in_box: '在盒子里',
  in_use: '在家使用',
  temp: '临时放置',
  lent: '借给别人',
  in_car: '在车里',
  discarded: '已丢弃',
  given_away: '已送人',
};

/** 只有「在盒子里」以外的状态需要在搜索结果里特别提示 */
export const isAbnormalStatus = (s) => s && s !== 'in_box';

/**
 * 单家庭上下文。
 * 第一阶段不做鉴权：family_id / user_id 从配置注入。
 * 第二阶段接入成员登录时，只改这里即可，业务代码不动。
 */
export function familyContext(req, _res, next) {
  req.familyId = config.defaultFamilyId;
  req.userId = config.defaultUserId;
  next();
}

/** 解析并校验整数 ID */
export function parseId(raw, name = 'id') {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} 不合法`);
  return n;
}

/** 解析可空整数（空字符串/null → null） */
export function parseNullableInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return n;
}

/** 数字参数带默认值与范围限制 */
export function parseLimit(raw, def = 50, max = 200) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
