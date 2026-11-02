import { defineConfig } from 'vitest/config';

/**
 * TickBar — 前端测试（vitest）
 * -----------------------------------------------------------------------------
 * 只跑纯逻辑与容器：jsdom 环境够用，不需要真实浏览器。
 * 组件渲染测试暂不引入（要 RTL + 交互模拟，收益低于先把公式/派生逻辑钉死）。
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'src-tauri/**', 'dist/**'],
    reporters: 'default',
    clearMocks: true,
  },
});
