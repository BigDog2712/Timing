/**
 * 待办可选的「标签 / 绑定应用」落点：挂到**同名事项**上。
 *
 * 待办表本身没有标签 / 应用字段（Rust `models/todo.rs`），而宿主建待办时会按标题
 * 自动匹配事项（`services/todo.rs` 的 `find_by_name`）。所以这里把用户填的标签与应用
 * 落到「同名事项」：已有就改它，没有就顺手建一条同名事项 —— 待办下一次匹配就能接上。
 *
 * 失败不挡待办创建：待办已经落库，附加项失败只会在药丸上提示（跨窗不传错误）。
 */
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import {
  listTimingItemTags,
  listTimingItems,
} from "../../../platform/persistence/timingReadRepository.ts";
import { saveAppItemBinding } from "./appItemBinding.ts";

export interface TodoItemExtras {
  tags: readonly string[];
  appKey: string | null;
}

export async function applyTodoItemExtras(name: string, extras: TodoItemExtras): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || (extras.tags.length === 0 && !extras.appKey)) return;
  const items = await listTimingItems().catch(() => []);
  const existing = items
    .filter((item) => item.name === trimmed && !item.isSystem)
    .sort((left, right) => right.id - left.id)[0];

  if (!existing) {
    await emitHostIntent({
      action: "create_item",
      name: trimmed,
      ...(extras.tags.length > 0 ? { tags: extras.tags } : {}),
      ...(extras.appKey ? { appKey: extras.appKey } : {}),
    });
    return;
  }
  if (extras.tags.length > 0) {
    /* `update_item.tags` 是**全量覆盖**：直接发待办里填的这几个会把事项原有标签清掉。
       所以先读现有标签再并集；读不到就宁可不写标签（也绝不拿半截当全集）。 */
    const rows = await listTimingItemTags().catch(() => null);
    if (rows !== null) {
      const current = rows.find((row) => row.itemId === existing.id)?.tags ?? [];
      const merged = [...current, ...extras.tags.filter((tag) => !current.includes(tag))];
      await emitHostIntent({ action: "update_item", id: existing.id, tags: merged });
    }
  }
  if (extras.appKey) await saveAppItemBinding(extras.appKey, existing.id);
}
