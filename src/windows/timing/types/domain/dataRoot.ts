/**
 * Timing — 数据根（`%APP_DIR%`）的契约面（V0.11.15，PRD 4.2 / 设计 §4.2）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/data_root.rs` 逐字对应（`rename_all = "camelCase"`）。
 * 这里只有形状，没有判据：可写性、预检四类拒绝、复制与核对全在 Rust 侧。
 */

/** 五项清单里的一项（切换确认对话框逐行列出来，见 PRD 4.2）。 */
export interface DataRootEntry {
  /** `timing.db` / `backups` / `logs` / `md` / `migrated-from-tickbar-app.json` */
  name: string;
  isDir: boolean;
  /** 源里到底有没有这一项。`false` 时**不显示体积**：「0 B」与「没有」是两件事 */
  present: boolean;
  /** 递归求和的字节数 */
  bytes: number;
}

/**
 * 数据根的一次快照（`dataRootGet` / `dataRootChange` 的返回）。
 *
 * `current` 是**当前生效**的路径，`defaultPath` 是**出厂值**（`<exe>\data`）。
 * 两者混用会让用户看到错的路径（设计 §8-7）——块② 显示的一律是 `current`。
 */
export interface DataRootInfo {
  current: string;
  defaultPath: string;
  /** `current === defaultPath`：回退到 `%APPDATA%` 或自定义根时都是 `false` */
  isDefault: boolean;
  /** 进页签时探测一次（PRD 4.2）；不做轮询，真的失败会在切换预检里当场说出来 */
  writable: boolean;
  writableError: string | null;
  /** 指针里写的、**重启后**才生效的新位置；非空时块②常驻黄条 */
  pending: string | null;
  /** 「改回旧位置」的目标（指针里的 `previous`） */
  previous: string | null;
  sizeBytes: number;
  entries: DataRootEntry[];
  /** 受 `%APP_DIR%` 影响的落点种类名（`事项计时` / `便利贴` / `待办事项`） */
  affected: string[];
  /** 插件目录现在就在数据根里 → 切换不会带走它，块②要额外说一句 */
  pluginsInDataRoot: boolean;
}
