/**
 * TickBar — 插件面板类型（apiVersion 3）
 * -----------------------------------------------------------------------------
 * 与 `src-tauri/src/models/plugin_panel.rs` 逐字对应（`#[serde(tag = "type")]`
 * 让块类型直接写在 JSON 的 `type` 字段上，前端按它 switch 渲染）。
 *
 * 插件不执行代码：面板里的每一块都是宿主实现的固定形态，按钮也只能调白名单动作。
 * 契约见 `docs/plugin-spec.md` §6。
 */

/** 数据块的查询参数（`params` 全可选，不填用宿主默认值） */
export interface QueryParams {
  /** `records.byItem`：统计最近多少天，1..=365，默认 7 */
  days?: number;
  /** `todos.pending`：最多几条，1..=50，默认 8 */
  limit?: number;
}

/** 动作参数。每个动作只读自己声明的那几个字段 */
export interface ActionParams {
  /** `timer.start`：事项名（不存在则新建） */
  item?: string;
  /** `todo.add`：待办标题 */
  title?: string;
  /** `note.create`：便利贴正文 */
  content?: string;
}

export interface PanelAction {
  label: string;
  /** 白名单动作名，如 `timer.start` */
  action: string;
  params: ActionParams;
}

/** 面板里的一块内容。`type` 是判别字段 */
export type PanelBlock =
  | { type: 'text'; text: string }
  | { type: 'stats'; source: string; label: string; params: QueryParams }
  | { type: 'list'; source: string; label: string; params: QueryParams }
  | { type: 'actions'; items: PanelAction[] };

export interface Panel {
  /** 同一插件内唯一；窗口 label = `panel-{pluginId}-{panelId}` */
  id: string;
  title: string;
  /** 逻辑像素；留空 = 320 */
  width?: number;
  height?: number;
  blocks: PanelBlock[];
}

/** 数据源返回的一行 */
export interface PanelRow {
  label: string;
  detail: string;
  /** 0..=1 相对占比；`null` = 这行不该画条（list 块只用文本） */
  ratio: number | null;
}

/** 动作执行回执 */
export interface PanelActionOutcome {
  message: string;
}

/** 宿主支持的数据源（与 Rust `SOURCES` 一致，前端用它给设置页做提示） */
export const PANEL_SOURCES = ['records.byItem', 'todos.pending'] as const;

/** 宿主支持的动作（与 Rust `ACTIONS` 一致） */
export const PANEL_ACTIONS = ['timer.start', 'timer.pause', 'todo.add', 'note.create'] as const;
