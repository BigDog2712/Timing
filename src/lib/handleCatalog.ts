/**
 * Timing — 手柄的数据契约（纯数据，**零 import**）
 * -----------------------------------------------------------------------------
 * 为什么单独一个文件、而且不许 import 任何东西：
 *  - 这份目录要被**分析窗**的设置页（`src/features/settings/**`）直接 import，
 *    而分析窗与主窗在 L9 门禁里是互斥集合，唯一共享载体就是 `src/lib/`。
 *  - 一旦这里 import 了 `src/services/**`（runner）或 `src/stores/**`，
 *    分析窗就会被迫把宿主的传输层/状态层拖进自己的包 —— 双窗隔离当场作废。
 *    所以「目录（纯数据）」与「实现（runner/guard）」必须物理分离：
 *    新增一个手柄动作 = 改本文件 +1 条目录、改 `services/handleActions/**` +1 条实现。
 *
 * 本文件的每个 id 都是**持久化键**：它会被写进 localStorage 的用户配置里，
 * 所以 id 永远不能改名（label 可以随便改，改了不影响已存配置）。
 */

/** 手柄三形态。只这三个值 —— 永不包含 `floatForm` 的 `'bar'`（那是常驻形态，不是手柄）。 */
export type HandleForm = 'dot' | 'half' | 'full';

/** 一个手柄上的 5 个可绑定槽位。`*Double` 是**同键双击**，与单击互斥。 */
export type HandleSlot = 'left' | 'right' | 'middle' | 'leftDouble' | 'rightDouble';

export interface HandleFormBinding {
  enabled: boolean;
  /** 5 个 key 必须全在：缺 key 会被归一化成 `null`（渲染成「无」），不做「undefined = 未绑定」的隐式语义。 */
  slots: Record<HandleSlot, string | null>;
}

export type HandleBindings = Record<HandleForm, HandleFormBinding>;

export interface StoredHandleBindings {
  /** 迁移位。不是 1 → 整份回落默认且不写盘（宁可让用户重设，也不猜别人的结构）。 */
  version: 1;
  forms: HandleBindings;
}

export interface HandleActionDescriptor {
  /** 持久化键，永不变。 */
  id: string;
  /** 中文文案（本轮不进 i18n：`src/shared/i18n/generated/contract.ts` 零行余量）。 */
  label: string;
  /** 选择器分组。 */
  group: 'ui' | 'timer';
  /** 不可逆动作（结束并保存这类），选择器里给角标提醒。 */
  irreversible?: boolean;
  /** 低频动作：排在选择器下半区，避免常用项被稀释。 */
  lowFrequency?: boolean;
  /** 护栏不通过时的提示文案；缺省时 dispatch 兜底成「X 现在不可用」。 */
  blockedHint?: string;
}

/** 顺序 = 药丸上的渲染顺序（圆点 → 半手柄 → 手柄），不要按字母重排。 */
export const HANDLE_FORMS: readonly HandleForm[] = ['dot', 'half', 'full'];

/** 顺序 = 设置页每张卡里的行顺序。 */
export const HANDLE_SLOTS: readonly HandleSlot[] = [
  'left',
  'right',
  'middle',
  'leftDouble',
  'rightDouble',
];

export const HANDLE_FORM_LABELS: Record<HandleForm, string> = {
  dot: '圆点',
  half: '半手柄',
  full: '手柄',
};

export const HANDLE_SLOT_LABELS: Record<HandleSlot, string> = {
  left: '左键',
  right: '右键',
  middle: '中键',
  leftDouble: '左双击',
  rightDouble: '右双击',
};

/**
 * 动作目录（13 条）。这是**唯一**数据源：设置页的 `<select>`、药丸的 `title`
 * 与 dispatch 的 `findHandleAction` 都读它，任何一处另写一份清单都会立刻漂移。
 */
export const HANDLE_ACTIONS: HandleActionDescriptor[] = [
  { id: 'patina.open', label: '唤出主界面', group: 'ui' },
  { id: 'today.panel', label: '记录面板', group: 'ui', lowFrequency: true },
  { id: 'today.digest', label: '今日摘要', group: 'ui', lowFrequency: true },
  { id: 'note.current', label: '当前事项便利贴', group: 'ui' },
  { id: 'note.list', label: '便利贴清单', group: 'ui' },
  { id: 'todos.open', label: '事项窗', group: 'ui' },
  { id: 'settings.open', label: '设置', group: 'ui' },
  { id: 'timer.start', label: '开始 / 继续', group: 'timer', blockedHint: '已在计时中' },
  { id: 'timer.pause', label: '暂停', group: 'timer', blockedHint: '当前没有在计时' },
  {
    id: 'timer.stop',
    label: '结束并保存',
    group: 'timer',
    irreversible: true,
    blockedHint: '还没有开始计时',
  },
  { id: 'md.sync', label: 'Markdown 同步', group: 'timer', lowFrequency: true },
  { id: 'menu.countdown', label: '倒计时菜单', group: 'timer', blockedHint: '计时中不开倒计时菜单' },
  {
    id: 'menu.moyu',
    label: '摸鱼菜单',
    group: 'timer',
    lowFrequency: true,
    blockedHint: '暂停后才能用摸鱼菜单',
  },
];

/**
 * 出厂绑定。
 *
 * 三条形态里**只有「手柄」默认开**：圆点 / 半手柄是给"我只想要一个小圆点"的人，
 * 默认开等于一上来就摆三个可点区域；而原「手柄」是既有唯一手柄的直接延续，
 * 关掉它会让所有老用户升级后突然失去便利贴入口。
 */
export const DEFAULT_HANDLE_BINDINGS: HandleBindings = {
  dot: {
    enabled: false,
    slots: {
      left: 'today.panel',
      right: 'today.digest',
      middle: null,
      leftDouble: null,
      rightDouble: null,
    },
  },
  half: {
    enabled: false,
    slots: {
      left: 'patina.open',
      right: 'todos.open',
      middle: null,
      leftDouble: null,
      rightDouble: null,
    },
  },
  full: {
    enabled: true,
    slots: {
      left: 'note.current',
      right: 'note.list',
      middle: null,
      leftDouble: 'today.panel',
      rightDouble: 'today.digest',
    },
  },
};

/**
 * 按 id 查目录项。找不到返回 `undefined`（**不抛**）：
 * 用户手改过的配置里可能留着已删除的动作，那必须表现为「无」，而不是让药丸崩掉。
 */
export function findHandleAction(id: string): HandleActionDescriptor | undefined {
  return HANDLE_ACTIONS.find((action) => action.id === id);
}
