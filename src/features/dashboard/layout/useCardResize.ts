/**
 * [拖拽调整大小 · 0.12.1] 卡片下边缘拖拽改变高度。
 *
 * 为什么用**事件委托**而不是给每张卡塞一个手柄组件：
 * 四张列内卡分别来自不同模块（TimerModule / ItemsModule / AppsModule / TodosModule），
 * 每张卡都要透传一次手柄 prop —— 五处改动只为挂一个 8px 的拖拽区，成本不对。
 * 委托版本只认 DOM：卡是 `.qp-card`，卡 id 从卡头里的 `[data-card-controls]` 读
 * （那个属性本来就为工具条存在）。模块侧一个字不用改。
 *
 * 三件手感上的事：
 * 1. **拖动中不落盘**（`save=false`）：每像素写一次 localStorage 会把手感拖成"拉不动"，
 *    松手才写一次。
 * 2. 用 `setPointerCapture` 的等价做法（window 上挂 move/up）：指针快速移出卡片也能继续拖，
 *    否则鼠标一离开卡就断，表现为"只能拖一点点"。
 * 3. 只在**下边缘 8px** 内响应，卡内其它地方照常点击（点行、点按钮不受影响）。
 */
import { useCallback, useEffect, useRef } from "react";
import type { CardId } from "./contract";

const EDGE_PX = 8;

interface Options {
  /** 拖动中：只更新界面，不落盘 */
  onPreview: (id: CardId, height: number) => void;
  /** 松手：落盘一次 */
  onCommit: (id: CardId, height: number) => void;
}

export function useCardResize({ onPreview, onCommit }: Options) {
  const dragRef = useRef<{ id: CardId; startY: number; startHeight: number } | null>(null);

  const finish = useCallback((height?: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    document.body.style.removeProperty("cursor");
    if (drag && typeof height === "number") onCommit(drag.id, height);
  }, [onCommit]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      onPreview(drag.id, drag.startHeight + (event.clientY - drag.startY));
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      finish(drag.startHeight + (event.clientY - drag.startY));
    };
    const onCancel = () => finish();

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [finish, onPreview]);

  /** 挂在 `.qp-dashboard` 容器的 onPointerDown 上。 */
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const card = target?.closest<HTMLElement>(".qp-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (event.clientY < rect.bottom - EDGE_PX) return;

    const id = card.querySelector<HTMLElement>("[data-card-controls]")?.dataset.cardControls;
    if (!id) return;

    dragRef.current = { id: id as CardId, startY: event.clientY, startHeight: rect.height };
    document.body.style.cursor = "ns-resize";
    event.preventDefault();
  }, []);

  return { onPointerDown };
}
