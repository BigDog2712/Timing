/**
 * [0.13 · 需求 1.4] 布局管理弹层：**查看 / 切换 / 删除 / 新建** + 「整理」。
 *
 * 工具栏按需求只留三入口（添加组件 / 布局管理 / 锁定布局），原来那几颗
 * 「保存布局 / 恢复默认 / 出厂布局」全部收进这里：
 *   · 保存布局 → **新建布局**（把当前排布存成库里的一条并设为当前）；
 *   · 恢复默认 / 出厂布局 → 列表里的**切换**（`factory` 是内置条目）；
 *   · 整理（`tidy`）单列一条动作键：它是「我把卡拖乱了」的唯一退路，
 *     直接删掉会制造新问题（需求原文只要求工具栏三项，没要求删掉整理）。
 *
 * 三个刻意的取舍：
 *   ① **不做重命名、不做导入导出**（需求只列四条）：新建给默认名「布局 N」，可重名；
 *   ② **删当前那条不弹「你要去哪」**：直接回落到内置的 `factory`（见 `library.ts`）；
 *      不猜「用剩下的最近一条」—— 猜错会让用户以为自己删错了东西；
 *   ③ 删除要**两次点击**（同一颗键换文案再点一次），不引确认对话框：
 *      本仓的 `useQuietDialogs` 挂在 `AppShell`，为一个可重建的观感条目拉一条
 *      provider 依赖不划算，而且这块要被单测直接渲染。
 */
import { useEffect, useRef, useState } from "react";
import type { BoardCopy } from "./boardCopy";
import {
  FACTORY_LAYOUT_ID,
  libraryEntries,
  type LayoutLibrary,
} from "./library";

interface Props {
  copy: BoardCopy;
  library: LayoutLibrary;
  /** 锁定态：新建 / 删除 / 整理 / 切换全部禁用（切换也是结构变更） */
  locked: boolean;
  /** 板子是空的 → 新建布局没有意义（会被 store 拒），这里先禁用 */
  canCreate: boolean;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  onTidy: () => void;
  onClose: () => void;
}

export default function LayoutManagerDialog({
  copy, library, locked, canCreate, onSwitch, onCreate, onRemove, onTidy, onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  /** 待确认删除的那条 id：同一颗键换文案再点一次才真删 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = libraryEntries(library);

  /** 行的可见名：factory 用本地化名（内置条目无名，名字不落库） */
  const nameOf = (id: string, stored: string, index: number) => (
    id === FACTORY_LAYOUT_ID ? copy.factoryLayoutName : (stored || copy.layoutName(index))
  );

  const runSwitch = (id: string) => {
    if (locked || id === library.activeId) return;
    setPendingDelete(null);
    onSwitch(id);
  };

  const runRemove = (id: string) => {
    if (locked || id === FACTORY_LAYOUT_ID) return;
    if (pendingDelete !== id) {
      setPendingDelete(id);
      return;
    }
    setPendingDelete(null);
    onRemove(id);
  };

  return (
    <div
      className="qp-layout-manager"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qp-layout-manager-title"
      onPointerDown={(event) => {
        /* 点遮罩关闭；点面板内部不动（用 pointerdown：拖拽走 pointer，click 在拖动后可能不触发） */
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div className="qp-layout-manager__panel" ref={panelRef}>
        <h2 id="qp-layout-manager-title" className="qp-layout-manager__title">{copy.manageLayout}</h2>
        <p className="qp-layout-manager__hint">
          {locked ? copy.lockedHint : copy.manageHint}
        </p>
        <p className="qp-layout-manager__hint">{copy.layoutCount(entries.length)}</p>

        <ul className="qp-layout-manager__list">
          {entries.map((entry, index) => {
            const active = entry.id === library.activeId;
            const builtIn = entry.id === FACTORY_LAYOUT_ID;
            return (
              <li
                key={entry.id}
                className="qp-layout-manager__row"
                data-active={active}
                data-layout-entry={entry.id}
              >
                <span className="qp-layout-manager__name">{nameOf(entry.id, entry.name, index)}</span>
                <span className="qp-layout-manager__actions">
                  <button
                    ref={index === 0 ? firstRef : undefined}
                    type="button"
                    className="qp-link-btn"
                    data-layout-switch={entry.id}
                    disabled={locked || active}
                    onClick={() => runSwitch(entry.id)}
                  >
                    {copy.switchTo}
                  </button>
                  {builtIn ? null : (
                    <button
                      type="button"
                      className="qp-link-btn"
                      data-layout-delete={entry.id}
                      disabled={locked}
                      onClick={() => runRemove(entry.id)}
                    >
                      {pendingDelete === entry.id ? copy.deleteConfirm : copy.deleteLayout}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="qp-layout-manager__foot">
          <button
            type="button"
            className="qp-link-btn"
            data-layout-create
            disabled={locked || !canCreate}
            title={copy.newLayoutHint}
            onClick={() => {
              setPendingDelete(null);
              onCreate();
            }}
          >
            {copy.newLayout}
          </button>
          <button
            type="button"
            className="qp-link-btn"
            data-layout-tidy
            disabled={locked}
            title={copy.tidy}
            onClick={onTidy}
          >
            {copy.tidy}
          </button>
          <button type="button" className="qp-control" onClick={onClose}>{copy.close}</button>
        </div>
      </div>
    </div>
  );
}
