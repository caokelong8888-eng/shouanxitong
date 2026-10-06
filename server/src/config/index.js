import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录（/workspace） */
export const ROOT_DIR = path.resolve(__dirname, '../../..');

/**
 * 全部可配置项集中在此。
 * 第一阶段是「本地跑通」模式：
 *   - STORAGE_DRIVER = 'local'  → 图片存本地磁盘
 *   - STORAGE_DRIVER = 'cos'    → 图片存腾讯云 COS（第二阶段接入）
 *   - AI_DRIVER      = 'mock'   → 返回结构化假数据（真实 key 到位后换 'real'）
 */
export const config = {
  port: Number(process.env.PORT || 3300),

  /** 数据库文件 */
  dbPath: process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),

  /** 迁移脚本目录 */
  migrationsDir: path.join(__dirname, '..', 'db', 'migrations'),

  /** 单家庭模式：数据归属这个家庭 */
  defaultFamilyId: Number(process.env.FAMILY_ID || 1),
  /** 操作人（家庭成员） */
  defaultUserId: Number(process.env.USER_ID || 1),

  /**
   * 访问口令。
   * 系统挂在公网上，不设口令等于家里东西的照片和位置全公开。
   * 不填 → 不启用（仅用于本地开发）。
   * 生产环境必须填，否则启动时会打印醒目警告。
   */
  auth: {
    passcode: process.env.ACCESS_PASSCODE || '',
    /** 令牌有效期，默认 1 年（家庭自用，不想天天登录） */
    tokenTtlMs: Number(process.env.AUTH_TTL_MS || 365 * 24 * 60 * 60 * 1000),
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    /** 本地存储根目录 */
    localRoot: process.env.STORAGE_LOCAL_ROOT || path.join(ROOT_DIR, 'storage'),
    /** 对外访问前缀（由 express 静态托管） */
    publicPrefix: '/files',
    /** 缩略图最长边（像素） */
    thumbMaxSize: Number(process.env.THUMB_MAX_SIZE || 640),
    /**
     * 原图最长边（像素）。
     * 手机原图动辄 4000px、3~5MB，家庭场景「看一眼这是什么」根本用不上，
     * 限到 1600px 后体积通常降到原来的 10%~20%，弱网下点开大图才不卡。
     */
    originalMaxSize: Number(process.env.ORIGINAL_MAX_SIZE || 1600),
    /** 原图 JPEG 质量（85 是肉眼几乎无损的甜点值） */
    originalQuality: Number(process.env.ORIGINAL_QUALITY || 85),
    /** 单张图片大小上限（字节），默认 20MB */
    maxFileSize: Number(process.env.MAX_FILE_SIZE || 20 * 1024 * 1024),
    /** 允许的图片类型 */
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    // 以下为 COS 预留（第二阶段填写）
    cos: {
      bucket: process.env.COS_BUCKET || '',
      region: process.env.COS_REGION || '',
      secretId: process.env.COS_SECRET_ID || '',
      secretKey: process.env.COS_SECRET_KEY || '',
      cdnDomain: process.env.COS_CDN_DOMAIN || '',
    },
  },

  ai: {
    driver: process.env.AI_DRIVER || 'mock',
    // 真实模型接入预留（不写死模型名，仅作为配置项）
    endpoint: process.env.AI_ENDPOINT || '',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
    /** 单张识别超时（毫秒） */
    timeout: Number(process.env.AI_TIMEOUT || 30000),
    /**
     * 是否开启模型自带的「深度思考」。
     * 默认关闭 —— 认物品是看一眼的活，不需要推理链。
     * 设成AI_THINKING=true 可以打开（更准，但单张从 1.5 秒变8 秒）。
     */
    thinking: process.env.AI_THINKING === 'true',
  },

  /** 前端扫码二维码指向的地址前缀，部署时改成真实域名 */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3300}`,

  /**
   * 孤儿图片清理。
   *
   * 上传了但一直没入库的图片（拍完照就退出了那条路）会永远躺在磁盘上。
   * 每天扫一次，超过 IMAGE_GC_MIN_AGE_HOURS 的就清掉。
   * 设 0 关闭（不建议：磁盘满了 SQLite 写不进去，那才是真丢数据）。
   */
  imageGc: {
    enabled: process.env.IMAGE_GC_ENABLED !== 'false',
    /** 启动后多久跑第一次（毫秒），默认 10 分钟 */
    runAfterBootMs: Number(process.env.IMAGE_GC_RUN_AFTER_BOOT_MS || 10 * 60 * 1000),
    /** 两次之间隔多久（毫秒），默认 24 小时 */
    intervalMs: Number(process.env.IMAGE_GC_INTERVAL_MS || 24 * 60 * 60 * 1000),
    /** 文件至少存在多久才可能被当成垃圾（小时），默认 24 */
    minAgeHours: Number(process.env.IMAGE_GC_MIN_AGE_HOURS || 24),
  },
};
