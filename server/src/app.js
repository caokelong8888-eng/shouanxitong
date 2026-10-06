import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config/index.js';
import { buildRoutes } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { requireAuth, authEnabled } from './middleware/auth.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 简单的请求日志（第一版够用，排查问题时看得到在调什么）
  if (process.env.NODE_ENV !== 'test') {
    app.use((req, _res, next) => {
      if (req.path.startsWith('/api')) {
        console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.originalUrl}`);
      }
      next();
    });
  }

  // 本地图片静态托管（第二阶段换 COS 后这段可以保留做兜底）
  //
  // 【必须鉴权】这里是全站唯一会「裸奔」的静态目录 ——
  // 它挂在 buildRoutes() 之外，早前完全不过 requireAuth，
  // 结果任何拿到 URL 的人不登录就能看全家的照片（实测 curl 直接 200）。
  //
  // 之所以能简单加上鉴权：登录时同时下发了 HttpOnly Cookie，
  // 而 <img src="/files/..."> 会被浏览器自动带上 Cookie，不需要前端改一行代码。
  const storageRoot = config.storage.localRoot;
  fs.mkdirSync(storageRoot, { recursive: true });
  app.use(
    config.storage.publicPrefix,
    requireAuth, // ← 加这一行就够
    express.static(storageRoot, {
      maxAge: '7d',
      setHeaders(res) {
        // 带鉴权的内容不能进公共缓存，否则会串号
        res.setHeader('Cache-Control', authEnabled() ? 'private, max-age=604800' : 'public, max-age=604800');
      },
    })
  );

  // API
  app.use('/api', buildRoutes());

  // 前端静态资源（打包后的 web/dist），有就托管，方便单端口运行
  const webDist = path.resolve(config.storage.localRoot, '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/files).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
