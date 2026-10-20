import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';

/**
 * 本地磁盘存储适配器。
 *
 * 目录结构：
 *   storage/original/2026/10/<hash>.jpg   原图
 *   storage/thumb/2026/10/<hash>.jpg      缩略图
 *
 * 这个类的存在意义：把「图片放哪儿」这件事与业务代码解耦。
 * 第二阶段接入 COS 时，只需要新增 cos.js 实现同样的方法，业务代码一行不用改。
 */

function datePath(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return path.join(String(y), m);
}

function hashName(ext) {
  const rand = crypto.randomBytes(8).toString('hex');
  const ts = Date.now().toString(36);
  return `${ts}-${rand}${ext}`;
}

/**
 * 把「相对路径」安全地拼到存储根目录下。
 *
 * 【为什么必须校验】
 * path.join 不会拦住 "../"：传入 "../../etc/passwd" 会真的跳到根目录外面去。
 * 现在所有路径都是服务端生成的 hash，摸不到用户输入 —— 但这是个隐患，
 * 哪天哪处把用户传的字符串当路径用，立刻就变成目录穿越漏洞。
 * 所以在唯一的出入口上锁，比指望"以后别写错"靠谱。
 */
function safeAbs(relativePath) {
  const root = path.resolve(config.storage.localRoot);
  const raw = String(relativePath || '');

  // 先挡一道：路径里出现 ".." 段落一律拒绝，不管用什么分隔符写的。
  // 反斜杠在 Linux 上只是普通字符、不构成穿越，但 Windows 上会 ——
  // 统一在这里堵死，免得换环境部署时才发现。
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.split('/').some((seg) => seg === '..')) {
    throw new Error(`存储路径越界，已拒绝：${raw}`);
  }

  const abs = path.resolve(root, normalized);

  // 拼完必须还在根目录里面，否则一律拒绝
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`存储路径越界，已拒绝：${raw}`);
  }
  return abs;
}

export const localDiskAdapter = {
  driver: 'local',

  /** 绝对路径 → 对外 URL */
  toUrl(relativePath) {
    if (!relativePath) return null;
    return `${config.storage.publicPrefix}/${relativePath.split(path.sep).join('/')}`;
  },

  /**
   * 保存一张图片。
   * @param {Buffer} buffer 文件内容
   * @param {string} ext 扩展名（含点，如 .jpg）
   * @returns {{originalPath:string, originalUrl:string, absPath:string}}
   */
  saveOriginal(buffer, ext = '.jpg') {
    const rel = path.join('original', datePath(), hashName(ext));
    const abs = safeAbs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    return { originalPath: rel, originalUrl: this.toUrl(rel), absPath: abs };
  },

  /**
   * 保存缩略图。
   * @returns {{thumbPath:string, thumbUrl:string, absPath:string}}
   */
  saveThumb(buffer, ext = '.jpg') {
    const rel = path.join('thumb', datePath(), hashName(ext));
    const abs = safeAbs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    return { thumbPath: rel, thumbUrl: this.toUrl(rel), absPath: abs };
  },

  /** 读取原图内容（重新识别 / 查看大图时用） */
  read(relativePath) {
    const abs = safeAbs(relativePath);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs);
  },

  absPathOf(relativePath) {
    return safeAbs(relativePath);
  },

  exists(relativePath) {
    return fs.existsSync(safeAbs(relativePath));
  },

  remove(relativePath) {
    const abs = safeAbs(relativePath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  },
};
