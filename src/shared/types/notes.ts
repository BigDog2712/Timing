/**
 * 分析窗自有的便利贴摘要类型。
 *
 * **为什么不复用 `src/types/domain-v020.ts` 的 `Note`**：那是主窗类型，`src/types/**`
 * 属主窗，`src/features/**`（分析窗）引它 = `check-layers.mjs` L9 直接红，
 * 而且 `import type` 也算（`L9_SPECIFIER_PATTERNS` 只剔包名、不剔 type import）。
 * 本文件与 `shared/types/sessions.ts` / `web.ts` 同形：类型归分析窗所有。
 *
 * 字段与 Rust DTO 一一对应（`src-tauri/src/models/note.rs:38-53`，serde camelCase）。
 * 只留渲染要用的五个：几何（pos/width/height）与置顶/窗口态属于"便利贴窗"，
 * 主界面这条 56px 通栏不关心它们。
 */
export interface NoteSummary {
  id: number;
  /** 挂靠事项；null = 独立便签 */
  itemId: number | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}
