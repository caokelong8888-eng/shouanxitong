import { config } from '../../config/index.js';
import { AppError } from '../../utils/response.js';

/**
 * COS 存储适配器 —— 预留骨架。
 *
 * 第二阶段接入步骤（不需要改业务代码）：
 *   1. pnpm add cos-nodejs-sdk-v5
 *   2. 在 .env 填 COS_BUCKET / COS_REGION / COS_SECRET_ID / COS_SECRET_KEY / COS_CDN_DOMAIN
 *   3. 本文件里把 TODO 处接上 SDK 的 putObject / getObject / deleteObject
 *   4. 把 STORAGE_DRIVER 设为 cos
 *
 * 方法签名必须与 local-disk.js 完全一致，这是替换的前提。
 */

function notReady() {
  throw new AppError('COS 存储还没配置好，当前请使用本地存储（STORAGE_DRIVER=local）', 501, 'COS_NOT_READY');
}

function assertConfigured() {
  const { bucket, region, secretId, secretKey } = config.storage.cos;
  if (!bucket || !region || !secretId || !secretKey) {
    throw new AppError('COS 配置不完整，请检查 COS_BUCKET / COS_REGION / COS_SECRET_ID / COS_SECRET_KEY', 501, 'COS_CONFIG_MISSING');
  }
}

export const cosAdapter = {
  driver: 'cos',

  toUrl(relativePath) {
    if (!relativePath) return null;
    const { cdnDomain, bucket, region } = config.storage.cos;
    const host = cdnDomain || `${bucket}.cos.${region}.myqcloud.com`;
    const scheme = cdnDomain ? 'https' : 'https';
    return `${scheme}://${host}/${relativePath}`;
  },

  async saveOriginal(_buffer, _ext = '.jpg') {
    assertConfigured();
    void notReady;
  },

  async saveThumb(_buffer, _ext = '.jpg') {
    assertConfigured();
    void notReady;
  },

  async read(_relativePath) {
    assertConfigured();
    void notReady;
  },

  async remove(_relativePath) {
    assertConfigured();
    void notReady;
  },

  exists() {
    return true;
  },
};
