/**
 * Timing — 设置 · 数据管理 · 文案唯一常量表（V0.11.16，PRD 4.0）
 * -----------------------------------------------------------------------------
 * 本文件是「界面上那一句话」的**唯一维护面**。组件里不许再出现第二份同义字面量：
 * v0.11.15 的病根不是字多，是同一句话在三处各写一遍（「日记其他内容不动」原 3 处、
 * 「以 Markdown 为准」原 2 处、「文件放在哪个目录」原 3 处）。
 *
 * 三条纪律（改之前先看这里）：
 * 1. 每个键的值**逐字照 PRD 4.0**：不换同义词、不改标点、不加语气词；
 * 2. `REMOVED_PHRASES` 是「已经删掉的句子」，测试对全页做零命中断言。删了什么就往下加，
 *    这样下一轮想把话说长回来时会立刻撞红；
 * 3. 只有 `HINT_KEYS` 里那 4 句允许当「块标题下的解释长句」（PRD A1b 的白名单），
 *    其余一律是短标签或安全提示。
 */

/**
 * 块标题下方那 4 句「这一块管什么」——PRD A1b 的**解释性长句白名单**。
 *
 * ⑤「覆盖前留的底，可打开、可恢复。」不在里面：它回答的是「这是什么」，不是
 * 「这一块怎么运作」，而且 ⑤ 的标题下还要放当条记录（PRD 4.6）。
 */
export const EXPLAIN_KEYS = ['formatHint', 'dataRootHint', 'syncHint', 'cloudHint'] as const;

export const COPY = {
  /** C3 · ① hint */
  formatHint: '日记文件名 + 三段标题。',
  /** C6 · ① 文件名框下方一行小字（PRD 里的反引号是 Markdown 记号，不落进界面） */
  fileTemplateNote: '可用 {date}，也可加后缀，如 {date}-asd.md',
  /** C8 · ① 块末唯一保留的安全句（A3 判据就看这一句「日记其他内容不动」） */
  safeNote: '只改这三个标题下面的内容，日记其他内容不动。',
  /** C9 · ② hint */
  dataRootHint: '数据库和备份放这里。',
  /** C11 · ② 仅当确有 `%APP_DIR%` 落点时出现（三档时的原句；不足三档见 `affectedNoteFor`） */
  affectedNote: '这三档落点跟着数据根一起搬。',
  /** C14 · ③ hint（不再拼 `describeInterval`：间隔值就在下面那个数字框里） */
  syncHint: '多久写一次、写到哪个目录。',
  /** C16 · ③ 间隔旁 */
  intervalNote: '1 分钟 ~ 24 小时',
  /** C19 · ④ hint */
  cloudHint: '再送一份到坚果云。',
  /** C21 · ⑤ hint */
  backupHint: '覆盖前留的底，可打开、可恢复。',
} as const;

/** ① 三档 `file` 不同时的灰字（PRD 4.1 的「三档名称不同」口径） */
export function mixedFileNote(labels: string[]): string {
  return `${labels.join('、')}用的是另外的名字；改上面的名字会三档统一。`;
}

/** ③ 三档 `root` 不同时的提示行前缀（PRD 4.4） */
export const MIXED_ROOT_PREFIX = '三档落点不同：';

/**
 * C11 的**实际那一句**（[QA F3] 回修）。
 *
 * v0.11.16 首版无条件用「这**三档**落点跟着数据根一起搬。」，而后端
 * `data_root::affected_kinds` 返回的是**子集**（老用户常见 `timers=C:\Vault,
 * notes=C:\Vault2, todos=%APP_DIR%\md` → 只有待办一项）。此时那句话是假的：另外两档是
 * 绝对路径，换数据根根本不搬。
 *
 * 三档齐全时仍用 PRD 4.0 的原句（逐字），否则点名到底是哪几档。"这"→"待办事项"这类
 * 点名比一个含糊的量词有用：用户要判断「我改数据根会不会动到这一档」。
 */
export function affectedNoteFor(labels: string[]): string {
  if (labels.length === 3) return COPY.affectedNote;
  return `${labels.join('、')}跟着数据根一起搬。`;
}

/** ③ 某一档被关掉时的提示行（PRD 4.4） */
export const CLOSED_TIER_SUFFIX = '这一档已关闭同步。';

/** 长路径占位上限：超过就截断 + `…`，全文放 `title`（本轮裁决，见设计 §九-1） */
export const SHORT_PATH_MAX = 24;

/**
 * 路径 → 单行可放下的形态。截断只发生在**显示层**，`title` 里给全文：
 * 三个 Obsidian 长路径并列会把一行撑成两行半，视觉上又回到「话多」。
 */
export function shortPath(value: string): string {
  const path = value.trim();
  return path.length > SHORT_PATH_MAX ? `${path.slice(0, SHORT_PATH_MAX)}…` : path;
}

/** ③ 提示行正文：`三档落点不同：便利贴 C:\Vault2、待办事项 C:\Vault3`（只列不同项） */
export function mixedRootNote(items: { label: string; value: string }[]): string {
  return `${MIXED_ROOT_PREFIX}${items.map((item) => `${item.label} ${shortPath(item.value)}`).join('、')}`;
}

/** 同一行提示的 `title`：全文路径（截断只在显示层） */
export function mixedRootTitle(items: { label: string; value: string }[]): string {
  return `${MIXED_ROOT_PREFIX}${items.map((item) => `${item.label} ${item.value}`).join('、')}`;
}

/**
 * 已删除的句子（PRD A2 的三条零命中判据）。
 *
 * 往这里加一条 = 承诺「全页搜不到它」。测试对整页 `textContent` 逐条断言，所以
 * 「换个说法又写回来」也会被抓住——只要它包含这些词。
 */
export const REMOVED_PHRASES = [
  '以 Markdown 为准',
  '文件名与标题来自',
  '文件放在哪个目录',
] as const;
