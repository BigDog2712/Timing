/**
 * TickBar — 迁移可见性类型（V0.5.0 新增，命令 65 → 67）
 * -----------------------------------------------------------------------------
 * 与 Rust 侧一一对应（`src-tauri/src/models/migration.rs`，两处均 camelCase）：
 *   - `MigrationInfo`   ←  `get_migration_info` 的返回
 *   - `RowCounts`       ←  迁移标记里的五表行数快照
 *   - `MigrationSource` ←  后端**判定后**的来源枚举（前端不做任何二次推断）
 *
 * 为什么 source 由后端算：判定需要「目标有无库 / 老目录有无数据 / 两个标记文件
 * 是否存在 / 本次进程是否跳过」四项事实，前端只能看到最后一项的投影。把判定
 * 写在前端等于让「文案」和「事实」各算一遍，两边迟早不一致。
 *
 * 契约文档：`docs/phase2/IPC-CONTRACT-v2.md` §「迁移可见性」。
 * 决策记录：`docs/decisions/ADR-037.md`。
 */

/**
 * 数据来源。五值互斥，优先级由后端固定（见 `migration_cmd::resolve_source`）：
 *   legacy     —— 读到迁移标记，数据来自 `com.tickbar.app`
 *   pending    —— 上次选了「以空白数据启动」，旧数据仍在等重试
 *   skipped    —— 本次进程按开关跳过了迁移（开发 / 排障）
 *   fresh      —— 目标无库且老目录无数据：全新用户
 *   unattached —— 目标有库、无标记、老目录仍有数据：发现未采用的旧数据
 */
export type MigrationSource = 'legacy' | 'fresh' | 'pending' | 'unattached' | 'skipped';

/** 迁移时刻的五表行数快照（仅展示，不参与业务判定） */
export interface RowCounts {
  items: number;
  timeRecords: number;
  todos: number;
  notes: number;
  settings: number;
}

/** `get_migration_info` 的返回体（字段可空：未迁移过就没有时间/字节数/行数） */
export interface MigrationInfo {
  source: MigrationSource;
  /** 迁移完成时刻（本地时区 ISO8601，带偏移）；未迁移为 null */
  migratedAt: string | null;
  /** 迁移时的应用版本（如 `0.5.0`）；未迁移为 null */
  appVersionAtMigration: string | null;
  /** 旧数据目录绝对路径——**仅用于展示**，不接受它作为打开目录的入参（防路径注入） */
  legacyDir: string | null;
  /** 旧数据目录当前是否仍然存在 */
  legacyExists: boolean;
  /** 迁入的数据库文件字节数；未迁移为 null */
  dbBytes: number | null;
  /** 迁移时刻的行数快照；未迁移为 null */
  rowCounts: RowCounts | null;
}
