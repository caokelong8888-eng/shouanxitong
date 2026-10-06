import { config } from '../../config/index.js';
import { mockRecognizer } from './mock-recognizer.js';
import { realRecognizer } from './real-recognizer.js';

/**
 * AI 识别适配器工厂。
 * 业务代码只调用 getRecognizer().recognize(...)，不关心底层是 mock 还是真实模型。
 */
export function getRecognizer() {
  return config.ai.driver === 'real' ? realRecognizer : mockRecognizer;
}

export { mockRecognizer, realRecognizer };
