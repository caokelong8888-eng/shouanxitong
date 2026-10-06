import { defineConfig } from 'vite';

/**
 * 前端构建配置。
 * 不引框架 —— 页面只有 7 个，原生 ESM 足够，打包只为压缩体积 + 走 PWA。
 *
 * 开发时通过 proxy 把 /api 与 /files 转发到后端 3300 端口，
 * 这样手机连同一局域网访问 dev server 时，图片和接口都能正常加载。
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3300', changeOrigin: true },
      '/files': { target: 'http://localhost:3300', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019',
  },
});
