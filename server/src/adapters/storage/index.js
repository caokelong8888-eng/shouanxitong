import { config } from '../../config/index.js';
import { localDiskAdapter } from './local-disk.js';
import { cosAdapter } from './cos.js';

/**
 * 存储适配器工厂。
 * 业务代码只 import 这里的 getStorage()，不关心底层是本地还是 COS。
 */
export function getStorage() {
  return config.storage.driver === 'cos' ? cosAdapter : localDiskAdapter;
}

export { localDiskAdapter, cosAdapter };
