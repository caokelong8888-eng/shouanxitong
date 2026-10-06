import { getDb } from '../connection.js';

/**
 * 操作日志仓储。
 * 第一版只做「记录发生了什么」，用于：
 *   - 首页显示最近动态
 *   - 以后回答「谁把东西移动了」
 */

export function log(data) {
  try {
    return getDb()
      .prepare(
        `INSERT INTO activity_logs (family_id, user_id, action, entity_type, entity_id, summary, detail)
         VALUES (@family_id, @user_id, @action, @entity_type, @entity_id, @summary, @detail)`
      )
      .run({
        family_id: data.familyId,
        user_id: data.userId ?? null,
        action: data.action,
        entity_type: data.entityType,
        entity_id: data.entityId ?? null,
        summary: data.summary ?? null,
        detail: data.detail ? JSON.stringify(data.detail) : null,
      });
  } catch (err) {
    // 日志失败不能影响主流程
    console.warn('[activity_log] 写入失败:', err.message);
    return null;
  }
}

export function listLogs(familyId, limit = 30) {
  return getDb()
    .prepare(
      `SELECT a.*, u.name AS user_name
         FROM activity_logs a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.family_id = ?
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?`
    )
    .all(familyId, limit);
}
