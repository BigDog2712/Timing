/**
 * [v3] 主界面的组件板：工具条 + 画布 + 加卡弹层 + 一句提示。
 *
 * 这一层只做**编排**：卡片内容由 `Dashboard` 通过 `renderBody` 注入（它才知道数据），
 * 几何与拖拽在这一层（它才知道 zoom 与画布矩形）。分开的好处是 `Dashboard.tsx`
 * 不再被布局细节撑到 300 行冻结线，而板子本身可以单独被设置页的预览复用。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardCopy } from "./boardCopy";
import BoardCanvas from "./BoardCanvas";
import BoardCardFrame from "./BoardCardFrame";
import AddCardDialog from "./AddCardDialog";
import type { BoardCard, CardKind } from "./contract";
import { BOARD_H } from "./contract";
import { boardSnapshot } from "./boardStore";
import type { DashboardLayoutController } from "./useDashboardLayout";
import { useBoardDrag } from "./useBoardDrag";

interface Props {
  layout: DashboardLayoutController;
  copy: BoardCopy;
  labelOf: (card: BoardCard) => string;
  renderBody: (card: BoardCard) => ReactNode;
  emptyText: string;
}

export default function DashboardBoard({ layout, copy, labelOf, renderBody, emptyText }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const drag = useBoardDrag({
    onPreview: (uid, rect) => layout.moveTo(uid, rect, false),
    onCommit: (uid, rect) => {
      layout.moveTo(uid, rect, true);
      setDragging(null);
    },
    onRaise: layout.raise,
  });

  const addCard = (kind: CardKind) => {
    const uid = layout.add(kind);
    /* 落点从 store 的最新快照取，不读本帧的 `layout.layout`（那是上一次渲染的）。 */
    const placed = boardSnapshot().cards.find((item) => item.uid === uid);
    if (placed && placed.y + placed.h > BOARD_H) say(copy.movedBelow(labelOf(placed)));
  };

  const saveDefault = () => {
    /* 空板会被 store 拒（空卡表与坏存档在读取时无法区分，存了就是「恢复默认变白板」的坑）。 */
    if (!layout.saveAsDefault()) {
      say(copy.saveEmpty);
      return;
    }
    say(copy.savedAsDefault);
  };

  const restoreDefault = () => {
    /* 读的是**恢复之前**的 `customDefault`：恢复之后它照样是 true，问不出「刚才回的是哪一版」。 */
    const toSaved = layout.customDefault;
    layout.reset();
    say(toSaved ? copy.resetToSaved : copy.factoryDone);
  };

  return (
    <>
      <div className="qp-dashboard-toolbar">
        <button type="button" className="qp-link-btn" onClick={() => setAddOpen(true)}>
          {copy.addCard}
        </button>
        <button type="button" className="qp-link-btn" onClick={layout.tidy}>
          {copy.tidy}
        </button>
        <button type="button" className="qp-link-btn" title={copy.saveHint} onClick={saveDefault}>
          {copy.saveLayout}
        </button>
        <button type="button" className="qp-link-btn" onClick={restoreDefault}>
          {copy.reset}
        </button>
        {/* 只在存过自定义默认版时露出：此时「恢复默认」不再回出厂，得留一条回去的路。 */}
        {layout.customDefault ? (
          <button
            type="button"
            className="qp-link-btn"
            title={copy.factoryHint}
            onClick={() => {
              layout.resetToFactory();
              say(copy.factoryDone);
            }}
          >
            {copy.factory}
          </button>
        ) : null}
      </div>

      <BoardCanvas
        layout={layout.layout}
        emptyText={emptyText}
        hintText={copy.boardHint}
        /* 无边框窗：标题栏只有 44px，点板上空白处也能把窗口拖走（拖卡头仍是挪卡） */
        dragWindowOnBackdrop
        renderCard={(card, zoom) => (
          <BoardCardFrame
            key={card.uid}
            card={card}
            label={labelOf(card)}
            copy={copy}
            dragging={dragging === card.uid}
            onBegin={(event, rect, mode) => {
              setDragging(card.uid);
              drag.begin(event, card.uid, rect, mode, zoom);
            }}
            onNudge={(rect) => layout.moveTo(card.uid, rect, true)}
          >
            {renderBody(card)}
          </BoardCardFrame>
        )}
      />

      {addOpen ? (
        <AddCardDialog
          copy={copy}
          countOf={layout.countOf}
          onAdd={addCard}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      {toast ? (
        <div className="qp-board-toast" role="status">{toast}</div>
      ) : null}
    </>
  );
}
