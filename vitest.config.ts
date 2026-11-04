import { defineConfig } from 'vitest/config';

/**
 * Timing — 前端测试（vitest）
 * -----------------------------------------------------------------------------
 * 只跑纯逻辑与容器：jsdom 环境够用，不需要真实浏览器。
 * 组件渲染测试暂不引入（要 RTL + 交互模拟，收益低于先把公式/派生逻辑钉死）。
 */
export default defineConfig({
  /* `src/lib/platform.ts` 直接读编译期常量（Vite define 替换）。测试进程不经过
     vite.config.ts 的 Tauri 构建链路，这里补同一份 define 的桌面取值，
     否则引用 platform.ts 的模块会在模块求值时就抛 ReferenceError。 */
  define: {
    __TIMING_MOBILE__: 'false',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'src-tauri/**', 'dist/**'],
    reporters: 'default',
    clearMocks: true,
  },
});
