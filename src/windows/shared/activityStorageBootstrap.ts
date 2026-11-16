/**
 * Timing — 存储键迁移的自举副作用（T04-4，3 行，不许加东西）
 * -----------------------------------------------------------------------------
 * **为什么必须有这个文件**：ESM 的 import 全部 hoist——
 *   · `import './纯导出模块'` 求值期**零副作用**（迁移一次都不会跑）；
 *   · `import { x } from …; x();` 的调用也在**所有被 import 模块求值之后**才执行
 *     ⇒ 必在 `boardStore` 模块求值读盘（`boardStore.ts:96`）之后。
 * **能被 import 位置保证的，只有"模块求值期就发生副作用"的那一类**——所以
 * 两个 entry 的第 1 条 import 指向这里，而这里在模块顶层就调用 `ensureMigrated()`。
 *
 * 覆盖面（G-4 已结案）：存储按**数据目录**分 profile——
 *   profile A（Tauri 默认目录）= `main` + `activity` 两窗；
 *   profile B（`<数据根>/patina/webview`）= mini + 通知窗，**都加载 activity.html**。
 * 两处 entry（`activity/shell/main.tsx` + `timing/entry/main.tsx`）**都 import，
 * 一处都不能省**：少一处 ⇒ 一整份 profile 的键永不迁移，且 profile A 的测试看不见。
 *
 * 它是**辅助保证**：主保证是读写出口里的惰性闸（M-13/M-14）。它换来的是
 * "23 槽在任何渲染 / 任何 store 求值之前整批搬完"，回滚与排障时边界干净。
 */
import { ensureMigrated } from './activityStorageKeys';

ensureMigrated();
