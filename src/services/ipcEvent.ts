/**
 * Timing — 事件订阅的唯一实现（V0.11.15 从 ipc.ts 抽出）
 * -----------------------------------------------------------------------------
 * 为什么单独成文件：`ipc.ts` 抽前 **299 行**（`check:size` 上限 300），本版要新增 4 条
 * 数据根 / 备份命令，硬塞必然越线。事件订阅与「命令名契约」是两件事：`check:contract`
 * 只解析 `ipc.ts` 里的 `call<T>('…')` 与方法名，搬走这一段**不会**让任何规则静默失效
 * （这正是 `ipcError.ts` 头部警告的那类退化，此处已逐个核对过两条正则）。
 *
 * `ipc.ts` 保留 `export { onIpcEvent } from './ipcEvent';`，所以 4 个既有 import 点
 * （`hooks/useTauriEvent.ts` / `services/timerWindowActions.ts` 等）与 `vi.mock` 里的键
 * 都不用改。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { isTauri } from './ipc';

/**
 * 订阅后端事件；非 Tauri 环境返回 no-op unlisten。
 *
 * 返回的 unlisten **必须**由调用方在 cleanup 里调用（K-8）：不注销会在每次重挂载时
 * 多留一个监听，最后同一个事件被处理 N 次。
 */
export async function onIpcEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<T>(event, (e) => handler(e.payload as T));
}
