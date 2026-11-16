/**
 * Timing — 浏览器降级 Mock：手柄自定义动作（[0.13]）
 * -----------------------------------------------------------------------------
 * 纯浏览器（`npm run dev` / 单测）里既没有「启动一个程序」也没有「往别的前台应用
 * 注入按键」这两件事。这里**如实失败**（`IO_ERROR`），理由与 `open_legacy_dir` 同一套：
 * 静默成功会让走查得出错误结论（以为链路灯了，装到机器上才发现要系统权限）。
 *
 * ⚠️ 键必须 **4 空格缩进**：`scripts/check-contract.mjs` 的正则
 * `^ {4}([a-z][a-z0-9_]*):\s*\(` 只认这个形态，缩进改了 mock 数就少一条，门禁直接红。
 */
import { fail } from './mockSeed';

export function createMockApiHandleCustom(): Record<string, (args?: any) => unknown> {
  return {
    run_handle_custom_action: () => fail('IO_ERROR', '浏览器预览模式不执行系统动作（启动应用 / 发送快捷键）'),
    /* [R1] 选程序这件事**必须**在后端做（授权事实只能来自一次原生交互），浏览器里没有
       原生对话框，所以只能如实失败 —— 返回一个假路径会让走查以为「选成功了」，而真正
       装上机器时那格手柄会因为路径没进授权名单而拒绝执行。 */
    pick_custom_launch_target: () => fail('IO_ERROR', '浏览器预览模式没有原生文件选择器'),
  };
}
