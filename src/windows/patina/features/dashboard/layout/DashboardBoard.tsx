/**
 * [v3] 主界面的组件板：工具条 + 画布 + 加卡弹层 + 布局管理 + 一句提示。
 *
 * 这一层只做**编排**：卡片内容由 `Dashboard` 通过 `renderBody` 注入（它才知道数据），
 * 几何与拖拽在这一层（它才知道 zoom 与画布矩形）。分开的好处是 `Dashboard.tsx`
 * 不再被布局细节撑到 300 行冻结线，而板子本身可以单独被设置页的预览复用。
 *
 * [0.13 · 需求 1.3 / 1.4] 工具条**只有三颗键**：添加组件 / 布局管理 / 锁定布局。
 * 原来的「整理 / 保存布局 / 恢复默认 / 出厂布局」四颗下线：
 *   · 整理 + 新建布局（= 原「保存布局」）+ 切换（= 原「恢复默认 / 出厂布局」）
 *     全部搬进 `LayoutManagerDialog`；
 *   · 好处是工具栏不再随「存过默认版没有」变形（`customDefault` 那条分支删了）。
 *
 * **死锁警戒**：锁定时这三颗键必须仍然可点。`.qp-page-toolbar` 的 `opacity: .45`
 * 与 `pointer-events` 都归 CSS 管，任何"锁定后藏起来"的实现都会让用户永久解不开锁
 * （只能去删 localStorage）。判据见 `boardLock.test.tsx` 的 V-1.3c。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardCopy } from "./boardCopy";
import BoardCanvas from "./BoardCanvas";
import BoardCardFrame from "./BoardCardFrame";
import AddCardDialog from "./AddCardDialog";
import LayoutManagerDialog from "./LayoutManagerDialog";
import QuietPageToolbar from "../../../shell/components/QuietPageToolbar.tsx";
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
  const [manageOpen, setManageOpen] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const locked = layout.locked;

  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  /* 锁定时换掉整组回调：`useBoardDrag` 会在 `begin` 里挂 window 级 pointermove，
   * 让它先挂上再由 store 早退，会留下一串「拖了但没动」的空转。 */
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
    if (uid < 0) return; /* 锁定态：store 早退并返回 -1 */
    /* 落点从 store 的最新快照取，不读本帧的 `layout.layout`（那是上一次渲染的）。 */
    const placed = boardSnapshot().cards.find((item) => item.uid === uid);
    if (placed && placed.y + placed.h > BOARD_H) say(copy.movedBelow(labelOf(placed)));
  };

  const toggleLock = () => {
    layout.setLocked(!locked);
    /* 读的是**切换之前**的 `locked`：切换之后 store 里已经是新值，问不出"刚才是什么"。 */
    say(locked ? copy.layoutUnlocked : copy.layoutLocked);
  };

  const createLayout = () => {
    const name = copy.layoutName(layout.library.items.length + 1);
    /* 空板会被 store 拒（空卡表与坏存档在读取时无法区分，存了就是「切过去一片白」）。 */
    say(layout.createLayout(name) ? copy.layoutSaved(name) : copy.lockedNotice);
  };

  const removeLayout = (id: string) => {
    const entry = layout.library.items.find((item) => item.id === id);
    layout.removeLayout(id);
    say(copy.layoutDeleted(entry?.name || copy.layoutName(layout.library.items.length)));
  };

  return (
    <>
      <QuietPageToolbar modifier="qp-dashboard-toolbar" ariaLabel={copy.toolbarLabel}>
        <button type="button" className="qp-link-btn" data-toolbar-add onClick={() => setAddOpen(true)}>
          {copy.addCard}
        </button>
        <button
          type="button"
          className="qp-link-btn"
          data-toolbar-manage
          title={copy.manageHint}
          onClick={() => setManageOpen(true)}
        >
          {copy.manageLayout}
        </button>
        <button
          type="button"
          className="qp-link-btn"
          data-toolbar-lock
          aria-pressed={locked}
          onClick={toggleLock}
        >
          {locked ? copy.unlockLayout : copy.lockLayout}
        </button>
      </QuietPageToolbar>

      <BoardCanvas
        layout={layout.layout}
        emptyText={emptyText}
        hintText={copy.boardHint}
        /* 无边框窗：标题栏只有 44px，点板上空白处也能把窗口拖走（拖卡头仍是挪卡）。
           空板时画布自己会关掉这条（见 `BoardCanvas` 的 `windowDragEnabled`）。 */
        dragWindowOnBackdrop
        renderCard={(card, zoom) => (
          <BoardCardFrame
            key={card.uid}
            card={card}
            label={labelOf(card)}
            copy={copy}
            dragging={dragging === card.uid}
            locked={locked}
            onBegin={(event, rect, mode) => {
              if (locked) return;
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
          locked={locked}
          onAdd={addCard}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      {manageOpen ? (
        <LayoutManagerDialog
          copy={copy}
          library={layout.library}
          locked={locked}
          canCreate={layout.layout.cards.length > 0}
          onSwitch={(id) => {
            layout.switchToLayout(id);
            setManageOpen(false);
          }}
          onCreate={createLayout}
          onRemove={removeLayout}
          onTidy={layout.tidy}
          onClose={() => setManageOpen(false)}
        />
      ) : null}

      {toast ? (
        <div className="qp-board-toast" role="status">{toast}</div>
      ) : null}
    </>
  );
}
