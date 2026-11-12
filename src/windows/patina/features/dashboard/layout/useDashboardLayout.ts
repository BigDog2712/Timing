/**
 * [v3] 布局 hook：`boardStore` 的薄壳。
 *
 * 保留这个名字有两个原因：主界面与测试都按它取布局（换名等于为改而改）；
 * 而动作的真实实现全在 store 里（设置页也要用同一份，见 `boardStore.ts` 头注释）。
 * 这里只补一个 v2 时代就有的便利方法 `has(kind)`：加卡弹层用它显示「已在板上 N 张」。
 */
import { useBoardStore, type BoardActions } from "./boardStore";
import type { CardKind, DashboardLayout } from "./contract";

export interface DashboardLayoutController extends BoardActions {
  layout: DashboardLayout;
  /** 存过自己的默认布局没有（工具栏据此露出「出厂布局」那一条）。 */
  customDefault: boolean;
  /** 板上这种组件有几张（同类型可多张，所以返回数量而不是布尔）。 */
  countOf: (kind: CardKind) => number;
}

export function useDashboardLayout(): DashboardLayoutController {
  const store = useBoardStore();
  return {
    ...store,
    countOf: (kind) => store.layout.cards.filter((card) => card.kind === kind).length,
  };
}
