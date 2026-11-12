import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/** 双入口的绝对路径：ESM 下没有 __dirname，统一用 import.meta.url 解析 */
const entry = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

/** 编译期平台标记：`tauri android dev/build` 注入 TAURI_ENV_FAMILY=mobile */
const IS_MOBILE_BUILD = process.env.TAURI_ENV_FAMILY === 'mobile';

/** `entry/main.tsx` 里的移动端样式导入（整行；重排后从 `../styles/mobile/` 取） */
const MOBILE_CSS_IMPORT = /^[ \t]*import[ \t]+['"]\.\.\/styles\/mobile\/[^'"]+['"];?[ \t]*$/gm;

/**
 * 桌面构建剔除移动端样式表
 * -----------------------------------------------------------------------------
 * `src/windows/timing/styles/mobile/*.css` 是 7 个只服务于移动壳的样式表（约 1200 行）。JS 侧的
 * `if (IS_MOBILE) return <MobileShell/>` 会被摇树整块删掉，但 CSS 是**副作用导入**：
 * 只要 `main.tsx` 里有那几行 `import`，样式就会进桌面产物（实测桌面 CSS 里能搜到
 * `.m-tabbar`）。CSS 不能像 JS 那样靠死代码消除，只能在模块进入打包器之前把导入摘掉
 * ——这就是本插件唯一的职责，与 `define` 里的平台标记同源、同一次构建生效。
 *
 * 约束：移动端样式只允许从 `main.tsx` 导入（当前如此）；换到别处需要同步改这里。
 */
function platformCss(): Plugin {
  return {
    name: 'timing:platform-css',
    enforce: 'pre',
    transform(code, id) {
      if (IS_MOBILE_BUILD || !/src[\\/]windows[\\/]timing[\\/]entry[\\/]main\.tsx$/.test(id)) return;
      const stripped = code.replace(MOBILE_CSS_IMPORT, '');
      if (stripped === code) return;
      return { code: stripped, map: null };
    },
  };
}

// Timing — 桌面悬浮应用（Tauri 2 + React 19）
// 说明：本工程为固定 384x360 DIP 透明置顶层，无 Web 路由、无网络请求。
// - clearScreen=false：保留 Rust 侧 dev 日志
// - strictPort 1420：与 src-tauri/tauri.conf.json 的 devUrl 对齐
// - target=chrome105：WebView2（Chromium 105+）
export default defineConfig({
  /* tailwindcss 只服务 patina 入口：`src/windows/patina/shell/App.css` 里 `@import "tailwindcss" source("../")`
     限定扫描范围，主窗口 index.html 不引用该样式表 → 两边样式零交叉。 */
  plugins: [platformCss(), tailwindcss(), react()],
  /* 编译期平台标记（DESIGN-ANDROID-V1 §1.2）：`tauri android dev/build` 会注入
     TAURI_ENV_FAMILY=mobile；纯 vite（dev / vitest）下没有这个变量 → false，
     桌面路径与桌面产物完全不受影响（替换成字面量后移动分支可被摇树删除）。 */
  define: {
    __TIMING_MOBILE__: JSON.stringify(IS_MOBILE_BUILD),
  },
  clearScreen: false,
  server: {
    /* [0.12.0] 绑死 IPv4 回环，别让 Node 自己挑网卡。
       `localhost` 在本机被解析成 `::1`，Vite 就只监听 `[::1]:1420`；而 WebView2
       先把 `localhost` 解析成 `127.0.0.1` → 连接被拒，窗口停在 chrome-error 页，
       前端永远发不出 ready。`src-tauri/tauri.conf.json` 的 devUrl 与 Patina 窗口的
       开发地址都是 `127.0.0.1:1420`，三处必须一致。 */
    host: '127.0.0.1',
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
      // 双入口：主窗口（计时/事项）+ Patina 分析窗口。两个 HTML 各自独立挂载，
      // 样式不共享（Timing 手写 CSS / Patina Tailwind），互不污染。
      input: {
        main: entry('./index.html'),
        patina: entry('./patina.html'),
      },
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
