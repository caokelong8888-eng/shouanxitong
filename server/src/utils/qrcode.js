import QRCode from 'qrcode';
import { config } from '../config/index.js';

/**
 * 盒子二维码工具。
 *
 * 扫码后打开的地址形如：
 *   http://<域名>/#/boxes/code/B03
 * 直接把用户送进「盒子03」详情页 —— 这是贴在实际盒子上的最快入口。
 */

/** 生成扫码指向的地址 */
export function buildScanUrl(code) {
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/#/boxes/code/${encodeURIComponent(code)}`;
}

/** 生成二维码 PNG Buffer（用于返回给前端或存盘） */
export async function makeQrPng(code, { width = 480, margin = 1 } = {}) {
  const text = buildScanUrl(code);
  return QRCode.toBuffer(text, {
    type: 'png',
    width,
    margin,
    errorCorrectionLevel: 'M',
    color: { dark: '#1F2937', light: '#FFFFFF' },
  });
}

/** 生成 DataURL（前端可直接 <img src>） */
export async function makeQrDataUrl(code, opts) {
  return QRCode.toDataURL(buildScanUrl(code), {
    width: opts?.width || 480,
    margin: opts?.margin ?? 1,
    errorCorrectionLevel: 'M',
  });
}
