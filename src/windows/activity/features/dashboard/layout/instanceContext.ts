/**
 * [v3] 卡片实例上下文：**同一组件放多张时，DOM id 不能撞**。
 *
 * 各模块的卡头 id 是写死的（`t-todos` / `t-notes` …），因为 v2 时代「一种卡只有一张」。
 * v3 允许放两张待办，两份 `id="t-todos"` 会让 `aria-labelledby` 指到先出现的那张——
 * 标题相同的时候读起来没差别，一旦用户给其中一张改了名，读屏就会念错。
 *
 * 做法：外层（`BoardCardFrame`）把实例 uid 放进 context，卡内的 `ModuleShell` /
 * `NotesStrip` 用它给 id 加后缀。没包在板子里的用法（测试、独立预览）拿不到 uid，
 * 后缀为空 —— 保持原 id 不变，老测试与老快照都不用改。
 */
import { createContext, useContext } from "react";

export const BoardInstanceContext = createContext<number | null>(null);

export function useBoardInstance(): number | null {
  return useContext(BoardInstanceContext);
}

/** DOM id 后缀：`t-todos` → `t-todos-7`。不是实例就原样返回。 */
export function withInstance(id: string, instance: number | null): string {
  return instance === null ? id : `${id}-${instance}`;
}
