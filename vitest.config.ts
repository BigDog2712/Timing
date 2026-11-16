import { defineConfig } from 'vitest/config';

/**
 * Timing — 前端测试（vitest）
 * -----------------------------------------------------------------------------
 * 只跑纯逻辑与容器：jsdom 环境够用，不需要真实浏览器。
 * 组件渲染测试暂不引入（要 RTL + 交互模拟，收益低于先把公式/派生逻辑钉死）。
 */
export default defineConfig({
  /* `src/windows/timing/lib/platform.ts` 直接读编译期常量（Vite define 替换）。测试进程不经过
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
    /* 默认 5s 在满载并行下不够：`activityStorageBootstrap.wiring.test.ts` 有两条
       真 import 整个 entry（React 渲染 + 迁移）的用例，单跑 1.2–1.9s，满载时被 CPU
       抢占就会越过 5s —— 表现是「本地红、单跑绿」的假失败，最难查。给 3 倍余量，
       而不是把它拆掉：它钉的是「老存储键在真入口 import 时也被迁移」这条真判据。 */
    testTimeout: 15_000,
  },
});
