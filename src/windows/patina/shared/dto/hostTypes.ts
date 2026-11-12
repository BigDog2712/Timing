/*
 * 转发壳：真源已下沉到 `src/windows/shared/dto/hostTypes.ts`（0.12.1 共享层，L9 例外表因此清空）。
 * 保留本文件只是为了让**同窗**既有相对引用零改动；分析窗请直接引 `windows/shared/*`。
 * 不要在壳里加任何实现——壳一旦有逻辑，L9/L10 的"单一共享载体"前提就破了。
 */
export * from '../../../shared/dto/hostTypes';
