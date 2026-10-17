import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TickBar — 桌面悬浮应用（Tauri 2 + React 19）
// 说明：本工程为固定 384x360 DIP 透明置顶层，无 Web 路由、无网络请求。
// - clearScreen=false：保留 Rust 侧 dev 日志
// - strictPort 1420：与 src-tauri/tauri.conf.json 的 devUrl 对齐
// - target=chrome105：WebView2（Chromium 105+）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 不监听 Rust 侧，避免 cargo 构建触发前端热更风暴
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome105',
    // Vite 8（rolldown）默认使用 oxc 压缩；不再依赖独立 esbuild 包
    minify: 'oxc',
    sourcemap: false,
    cssTarget: 'chrome105',
  },
});
