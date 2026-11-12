/*
 * 转发壳：md 同步纯函数的真源已合并到 `src/windows/shared/settings/mdSyncConfig.ts`（0.12.1 共享层）。
 * 合并前这里是**逐字副本**（靠 mdSyncCopies.drift.test.ts 盯着两份不许分叉）。
 * 现在只有一份实现，本文件不得写入任何逻辑 —— 加一行代码就等于把副本又造回来。
 */
export * from '../../../../../shared/settings/mdSyncConfig';
