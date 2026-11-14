/**
 * Timing — 意图执行端：**事项的写动作**（新建 / 改事项）。
 *
 * 从 `hostIntentBridge.ts` 抽出来的（那个文件贴着 300 行棘轮，本轮又长出了「事项分类」
 * 字段）。两个动作都只是"把一条意图翻译成宿主既有的 typed IPC"，不需要 React ——
 * 所以这里是普通 async 函数，不是 hook：调用方（事件的 switch 分支）不必为它持有
 * `useCallback` 身份。
 *
 * ## 三条口径（搬过来时一字未改，别在下一次改动里纠正）
 *
 * 1. `create_item` **不**走 `ensureItemByName`：用户明确说了"新建"，静默变成"复用同名
 *    事项"是另一种错（`services::item::create` 本来就允许同名，ADR-021）。
 * 2. `update_item` 只提交**给了的字段**：`undefined` 与"不传"在 Rust 侧都表示"不改"，
 *    少写一个字段就少一处「改个名顺手把分类清了」的可能。
 * 3. 失败只 `setNotice({tone:'danger'})` 弹在药丸上，不跨窗（§6.5）。
 */
import { useItemStore } from '../stores/itemStore';
import { useUiStore } from '../stores/uiStore';
import { itemApi } from './api';
import { errorText } from './ipc';
import { writeItemTimer } from './itemTimerWrite';

/** 事项字段的补丁（不含 `timerMinutes`：它落 `settings.itemsTimers`，三态另走 `writeItemTimer`） */
export interface ItemPatchInput {
  name?: string;
  isPinned?: boolean;
  sortOrder?: number;
  categoryKey?: string | null;
}

export type ItemPatch = Pick<ItemPatchInput, 'name' | 'isPinned' | 'sortOrder' | 'categoryKey'>;

/**
 * 从意图里挑出**真给了的**事项字段。`undefined` 一律不带 = Rust 侧「不改这个字段」；
 * `name` 先 trim，纯空白丢弃（后端也会拒，但没必要多打一次 IPC）。
 *
 * `categoryKey` 是**三态**：`undefined` = 不改；`null` = 清成未分类；字符串 = 设为该分类。
 * 写成 `if (intent.categoryKey)` 会把"清空分类"整个吞掉 —— 用户在下拉里选了「未分类」，
 * 界面回弹、库里不动、零报错。空串则归一成 `null`（空串在库里是"一个永远匹配不到
 * 分类定义的键"）。
 */
export function pickItemPatch(intent: ItemPatchInput): ItemPatch {
  const patch: ItemPatch = {};
  if (typeof intent.name === 'string') {
    const name = intent.name.trim();
    if (name) patch.name = name;
  }
  if (intent.isPinned !== undefined) patch.isPinned = intent.isPinned;
  if (intent.sortOrder !== undefined) patch.sortOrder = intent.sortOrder;
  if (intent.categoryKey !== undefined) {
    patch.categoryKey = intent.categoryKey === null ? null : (intent.categoryKey.trim() || null);
  }
  return patch;
}

export interface CreateItemIntent {
  name: string;
  isPinned?: boolean;
  timerMinutes?: number | null;
  sortOrder?: number;
  categoryKey?: string | null;
}

/**
 * 新建事项。落库顺序与宿主菜单 `ItemsPrefsMenu.submit()` 相同：建 → 置顶 → 时长 → `reload()`。
 *
 * 分类在 `create` 这一步就落库（`create_item` 命令本来就收 `categoryKey`）：不走
 * "先建再 patch"，少一次 IPC，也不会出现"建好了但分类没跟上"的中间态。
 */
export async function applyCreateItemIntent(intent: CreateItemIntent): Promise<void> {
  const name = intent.name.trim();
  if (!name) return;
  try {
    const categoryKey = intent.categoryKey === undefined
      ? undefined
      : (intent.categoryKey?.trim() || null);
    const created = await itemApi.create({ name, categoryKey: categoryKey ?? undefined });
    const patch = pickItemPatch({ isPinned: intent.isPinned, sortOrder: intent.sortOrder });
    /* name 不塞回 patch：`create` 已经落过名字了（口径同 update） */
    if (Object.keys(patch).length > 0) await itemApi.update({ id: created.id, patch });
    if (intent.timerMinutes !== undefined) await writeItemTimer(created.id, intent.timerMinutes);
    await useItemStore.getState().reload();
  } catch (err) {
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  }
}

export interface UpdateItemIntent extends ItemPatchInput {
  id: number;
  timerMinutes?: number | null;
}

/**
 * 改事项（事项管理弹层：就地改名 / 默认时长 / 设或取消常用 / 上移下移 / 改分类）。
 * 「什么都没给」→ 不提交、不刷新（不该因为一次空点击多打两条 IPC）。
 */
export async function applyUpdateItemIntent(intent: UpdateItemIntent): Promise<void> {
  const patch = pickItemPatch(intent);
  const touchesItem = Object.keys(patch).length > 0;
  if (!touchesItem && intent.timerMinutes === undefined) return;
  try {
    if (touchesItem) await itemApi.update({ id: intent.id, patch });
    if (intent.timerMinutes !== undefined) {
      await writeItemTimer(intent.id, intent.timerMinutes);
    }
    await useItemStore.getState().reload();
  } catch (err) {
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  }
}
