import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TickBar — 桌面悬浮应用（Tauri 2 + React 19）
// 说明：本工程为固定 384x360 DIP 透明置顶层，无 Web 路由、无网络请求。
// - clearScreen=false：保留 Rust 侧 dev 日志
// - strictPort 1420：与 src-tauri/tauri.conf.json 的 devUrl 对齐
// - target=chrome105：WebView2（Chromium 105+）
export default defineConfig({
  plugins: [react()],
  /* 编译期平台标记（DESIGN-ANDROID-V1 §1.2）：`tauri android dev/build` 会注入
     TAURI_ENV_FAMILY=mobile；纯 vite（dev / vitest）下没有这个变量 → false，
     桌面路径与桌面产物完全不受影响（替换成字面量后移动分支可被摇树删除）。 */
  define: {
    __TICKBAR_MOBILE__: JSON.stringify(process.env.TAURI_ENV_FAMILY === 'mobile'),
  },
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
    // [0.4.1] 分包：此前业务代码 + React + 图标库挤在一个 425 kB chunk 里，任何一行业务
    // 改动都会让整包换 hash 重新解析。react / 图标库几乎不随业务变，单独切出来后
    // 业务 chunk 只含自身代码。注意 Vite 8（rolldown）只接受函数形式，传对象会报
    // Expected Function but received Object。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react';
          }
          return 'vendor';
        },
      },
    },
  },
});
