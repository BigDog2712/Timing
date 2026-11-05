/**
 * Timing — IPC 错误类型与规范化（V0.5.0 从 ipc.ts 抽出）
 * -----------------------------------------------------------------------------
 * 为什么单独成文件：`ipc.ts` 抽前 **295 行**（`check:size` 上限 300），本版要新增
 * 2 条命令（`get_migration_info` / `open_legacy_dir`）约 +4 行会顶到 299。把
 * 「错误从哪来、长什么样」搬出来腾出余量，也让错误规范化和命令名解耦。
 *
 * **`errorText()` 故意不搬**：`scripts/check-contract.mjs` 从 `src/services/ipc.ts`
 * 内联解析 `case '...'`，搬走**不会报错**，只会让「每个错误码都有文案」这条规则
 * 静默失效（少写一个 case 门禁照样绿，线上落到通用兜底文案）。这是最坏的一类
 * 退化：门禁绿着，保护已经没了。
 *
 * 5 个既有 import 点（`ItemPicker.tsx` / `useTimerActions.test.ts` /
 * `themeActions.ts` / `todoStore.ts` / `todoStore.test.ts`）继续从 `./ipc` 取
 * `IpcError`——`ipc.ts` 保留了 `export { IpcError } from './ipcError';`，零改动。
 *
 * `isTauri()` 同样留在 `ipc.ts`：它与错误无关，且被 `services/*` 多处直接引用。
 */
import type { ErrorCode } from '../types/domain';

/** 规范化后的 IPC 失败对象（业务错误码 + 人类可读信息） */
export class IpcError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

/**
 * 把后端 rejected value 规范化成 IpcError。
 *
 * 后端 `AppError` 序列化为 `{ code, message }`；但传输层异常（invoke 被拒绝、
 * 命令未注册、mock 抛裸字符串）形态各异，这里统一收口，保证上层只需认
 * `IpcError` 一种类型（`errorText()` 依赖这一点）。
 */
export function normalizeError(raw: unknown): IpcError {
  if (raw instanceof IpcError) return raw;
  if (raw && typeof raw === 'object') {
    const anyRaw = raw as { code?: unknown; message?: unknown };
    if (typeof anyRaw.code === 'string') {
      return new IpcError(
        anyRaw.code as ErrorCode,
        typeof anyRaw.message === 'string' ? anyRaw.message : '操作失败',
      );
    }
    if (typeof anyRaw.message === 'string') return new IpcError('IO_ERROR', anyRaw.message);
  }
  if (typeof raw === 'string' && raw.length > 0) return new IpcError('IO_ERROR', raw);
  return new IpcError('IO_ERROR', '操作失败，请稍后重试');
}
