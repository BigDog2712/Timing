/**
 * [v3] 布局 hook：`boardStore` 的薄壳。
 *
 * 保留这个名字有两个原因：主界面与测试都按它取布局（换名等于为改而改）；
 * 而动作的真实实现全在 store 里（设置页也要用同一份，见 `boardStore.ts` 头注释）。
 * 这里只补一个 v2 时代就有的便利方法 `has(kind)`：加卡弹层用它显示「已在板上 N 张」。
 *
 * [0.13] `customDefault` 下线：工具栏不再有「恢复默认 / 出厂布局」两颗键，
 * 「出厂」变成布局库里的内置条目（`layout/library.ts` 的 `factory`）。
 * 锁定态与布局库直接透传 store 的字段，不做第二次包装（两层真相必然漂）。
 */
import { useBoardStore, type BoardActions } from "./boardStore";
import type { CardKind, DashboardLayout } from "./contract";
import type { LayoutLibrary } from "./library";

export interface DashboardLayoutController extends BoardActions {
  layout: DashboardLayout;
  /** 布局锁定（几何锁 + 结构锁，见 `boardStore.setLocked`） */
  locked: boolean;
  /** 多布局库（`library.activeId` = 当前那条；`factory` 是虚拟条目） */
  library: LayoutLibrary;
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
