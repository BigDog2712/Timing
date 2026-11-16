/**
 * 命令调用出口（[T03] 从 `services/ipc.ts` 拆出）。
 *
 * 三件事：判运行时（Tauri / 浏览器）、挑实现（真 `invoke` 或 `browserMock`）、
 * 把任何失败规范化成 `IpcError`。
 *
 * 为什么单列：`services/ipc.ts` 是**命令清单**（94 个方法 + `errorText` 的 19 个
 * `case`，`check:contract` 逐条解析它），撞了 300 行门禁。这三件是**调用机制**，
 * 与清单无关，搬出去后清单仍是文件里最显眼的东西。
 */
import { invoke } from '@tauri-apps/api/core';

import { createMockApi } from '../mocks/browserMock';
import { IpcError, normalizeError } from './ipcError';

/** 是否运行在 Tauri（WebView2）运行时 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const mockHandlers = createMockApi();

/** 统一命令调用：Tauri invoke 或浏览器 mock，集中错误规范化 */
export async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    if (isTauri()) return await invoke<T>(cmd, args);
    const handler = mockHandlers[cmd];
    if (!handler) throw new IpcError('IO_ERROR', `未实现的命令：${cmd}`);
    return (await handler(args)) as T;
  } catch (err) {
    throw normalizeError(err);
  }
}
