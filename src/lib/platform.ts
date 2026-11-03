/**
 * TickBar — 平台常量（全前端**唯一**读取编译期标记的位置）
 * -----------------------------------------------------------------------------
 * `__TICKBAR_MOBILE__` 由 `vite.config.ts` 的 `define` 在打包时替换成字面量：
 *   - `tauri android dev/build`（TAURI_ENV_FAMILY=mobile）→ `true`
 *   - 桌面构建 / `npm run dev` / vitest → `false`（vitest.config.ts 也补了同一份 define）
 *
 * 为什么是编译期常量而不是运行期 `platform()`：
 *   1. 首帧就要决定渲染桌面药丸还是移动壳，运行期探测会先画一帧桌面再切换（透明小条会闪）；
 *   2. 替换成字面量后 `if (IS_MOBILE) return <MobileShell/>` 可以被摇树整块删掉，
 *      桌面产物里一行移动代码都不留（`npm run build` 后 dist 里搜不到 `m-shell`）。
 *
 * 本文件是**叶子**：不 import 任何模块，任何层都可以引它而不形成环。
 * 机械门禁 L7（scripts/check-layers.mjs）保证这个全局只出现在本文件。
 */
/* 只在本文件里声明、只在本文件里读：全局唯一读取点由 L7 机械保证 */
declare const __TICKBAR_MOBILE__: boolean;

export const IS_MOBILE: boolean = __TICKBAR_MOBILE__;

/** 宿主系统。仅移动端有意义；桌面恒为 `desktop`。 */
export type HostOs = 'android' | 'ios' | 'desktop';

function detectHostOs(): HostOs {
  if (!IS_MOBILE) return 'desktop';
  try {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  } catch {
    /* 无 navigator（测试 / 非常规宿主）：落到下方默认值 */
  }
  /* 本版只出 Android 包：识别不出 UA 时按 android 处理，避免调用方拿到空值再各自兜底 */
  return 'android';
}

export const HOST_OS: HostOs = detectHostOs();
