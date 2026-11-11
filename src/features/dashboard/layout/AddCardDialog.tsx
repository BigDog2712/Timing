/**
 * [P1 · 0.12.1] 加卡弹层：列出**还没在板上**的卡，点一下就加。
 *
 * 两条克制：
 * 1. 不做预览图。卡长什么样用户加进去就看见了；预览图要维护七份缩略，是纯负担。
 * 2. 已在板上的卡不出现在列表里（单实例口径）。要「再加一张」得先移除 —— 这比列表里
 *    摆一堆禁用项更直白，也避免用户点一个灰色按钮去猜原因。
 */
import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { CARD_IDS, isCardColumn, type CardColumn, type CardId } from "./contract";

/** 七类组件的名字与一句话说明。**顺序即列表顺序**，与任务书对位表一致。 */
export const CARD_CATALOG: ReadonlyArray<{ id: CardId; name: string; hint: string; column: CardColumn }> = [
  { id: "timer", name: "专注窗口", hint: "计时分布，可按事项 / 分类 / 应用展开", column: "left" },
  { id: "apps", name: "应用排行", hint: "应用时长排行，可就地设分类、绑事项", column: "right" },
  { id: "timeline", name: "事项菜单", hint: "今日事项按时序排列，可编辑与加分类", column: "full" },
  { id: "todos", name: "待办窗口", hint: "未完成待办，可就地编辑", column: "right" },
  { id: "notes", name: "便利贴窗口", hint: "缩略显示全部便利贴，点击打开", column: "full" },
  { id: "trend", name: "应用趋势", hint: "近几天的应用时长走势", column: "full" },
  { id: "reminder", name: "提醒窗口", hint: "今天的提醒与到点提示", column: "full" },
];

interface Props {
  present: (id: CardId) => boolean;
  onAdd: (id: CardId, column: CardColumn) => void;
  onClose: () => void;
}

export default function AddCardDialog({ present, onAdd, onClose }: Props) {
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = CARD_CATALOG.filter((item) => isCardKnown(item.id) && !present(item.id));

  return (
    <div className="qp-add-card" role="dialog" aria-modal="true" aria-labelledby="qp-add-card-title">
      <div className="qp-add-card__panel">
        <h2 id="qp-add-card-title" className="qp-add-card__title">添加卡片</h2>
        {available.length === 0 ? (
          <p className="qp-add-card__empty">七张卡都在板上了。要换布局，先移除某张再添加。</p>
        ) : (
          <ul className="qp-add-card__list">
            {available.map((item, index) => (
              <li key={item.id}>
                <button
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className="qp-add-card__item"
                  onClick={() => {
                    onAdd(item.id, item.column);
                    onClose();
                  }}
                >
                  <Plus size={14} strokeWidth={2} aria-hidden="true" />
                  <span className="qp-add-card__name">{item.name}</span>
                  <span className="qp-add-card__hint">{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="qp-control" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

function isCardKnown(id: CardId): boolean {
  return CARD_IDS.includes(id) && isCardColumn(CARD_CATALOG.find((item) => item.id === id)?.column);
}
