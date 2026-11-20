import { AlertTriangle, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

import type { TagNode } from "../../../../shared/tags/tagTree.ts";

/**
 * 标签管理树的一行：缩进 + 展开 + 行内改名 / 加子标签 / 删除。
 *
 * ## 右端那三个读数别再混着写
 *
 * 一行里其实有**两种**数，以前挤在一起（`0 条（含子标签）` + 光秃秃的 `0`），
 * 用户读成"子标签 0 个"，可它下面明明挂着 `考公`：
 *   · `N 条引用` —— 有多少条事项在读这个标签（含子树的合计，title 里给出自身/子树）；
 *   · `N 个子标签` —— 直接子节点个数（**只有真挂子标签的行才显示**，叶子行不说这句）。
 * 顺序按用户口径：引用 → 子标签 → 改名 → 删除 → ＋。
 *
 * 为什么行内编辑而不是弹窗：标签是**结构**（`父/子`），改一个父节点会带着整棵子树走。
 * 弹窗会把「改的是谁」藏起来，行内编辑能让用户在原地看到路径本身。
 *
 * ## 删除是「整行换成确认条」，不是「按钮变红等第二下」
 *
 * 早先的做法是点一下把按钮文字换成「确认删除 N 条」，等第二次点击。问题有两个：
 * 一是按钮变宽变红后行尾其余内容跟着挪位，二是「变红的那个还是删除键」——
 * 手快连点两下就直接删了，而这个操作会把这个标签从**所有**事项上摘掉。
 * 现在点一下，整行原地换成一条确认带：说清删的是哪棵子树、会摘掉多少条引用，
 * 只有明确的「确认删除」才真删；「取消」与 Escape 都回到普通行，焦点也落在取消上
 * （误触时默认动作是安全的那个）。
 *
 * ## 拖动改分类：行只管「展示投放态」，判据全在面板
 *
 * 把一行拖到另一行上 = 变成它的子标签，拖到根投放区 = 移到一级。行收到的是
 * `dragPath`（谁在被拖）与 `resolveDrop`（面板算的可行性），自己不算路径 ——
 * 一算就会和面板的 `reparentTagPath` 判据分叉，出现"行说能放、面板拒绝"的错位。
 *
 * 三种情况**不给拖**，理由各不相同：
 *   · 搜索态（`dragEnabled=false`）：搜索结果是过滤后的树，缺父子上下文 ——
 *     拖了会让人以为是"移到搜索结果里"，而实际落点是完整路径；
 *   · 行内编辑：拖拽会抢走输入框的文本选择；
 *   · 删除确认态：这时用户想的是"删不删"，让他在这一行上再发起一次移动是危险的。
 */
interface Props {
  node: TagNode;
  expanded: boolean;
  /** 子树引用合计（含自身），删除确认要报这个数 */
  descendantCount: number;
  /** 正在被拖的路径（null = 没人拖）。行据此画半透明与投放态 */
  dragPath: string | null;
  /** 面板统一算：把被拖的东西挂到本行下面能不能成 */
  resolveDrop: (targetPath: string) => "ok" | "invalid";
  /** 允许发起拖动的时机（搜索态 / busy 时由面板关掉） */
  dragEnabled: boolean;
  onToggle: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onAddChild: (path: string) => void;
  onDelete: (path: string) => void;
  onDragStartNode: (path: string) => void;
  onDragEndNode: () => void;
  onReparent: (from: string, targetParent: string | null) => void;
  /**
   * 指针进出本行时告诉面板「现在悬在哪一行」（null = 离开了）。
   *
   * 为什么需要它：非法目标刻意**不** `preventDefault`，浏览器就不会在松手时给
   * `drop` —— 那样"为什么不行"这句话就永远没机会出现。悬停时把落点报给面板，
   * 由面板当场说清理由，不必等一次不会发生的 drop。
   */
  onDropHover: (targetPath: string | null) => void;
}

const ICON = 12;
const STROKE = 1.9;

export default function DataTagManagerRow({
  node,
  expanded,
  descendantCount,
  dragPath,
  resolveDrop,
  dragEnabled,
  onToggle,
  onRename,
  onAddChild,
  onDelete,
  onDragStartNode,
  onDragEndNode,
  onReparent,
  onDropHover,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.path);
  const [confirming, setConfirming] = useState(false);
  const [dropTone, setDropTone] = useState<"ok" | "invalid" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const draggingSelf = dragPath === node.path;
  /* 编辑 / 确认态里不给拖：拖动会抢走输入框的文本选择，也会在"删不删"的当口
     再发起一次移动 */
  const canDrag = dragEnabled && !editing && !confirming;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  /* 确认态一出现就把焦点放到「取消」：这时按回车 / 空格都是安全动作 */
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  /* 换行动（改名 / 删除）之后旧的 draft 与确认态会串到新路径上：路径变了就重置 */
  useEffect(() => {
    setDraft(node.path);
    setConfirming(false);
  }, [node.path]);

  /* `dragend` 只在**源行**触发，被扫过的行收不到 —— 拖拽一结束（dragPath 归零）
     就在这里统一清投放态，否则松手前后亮着的行会一直亮着。 */
  useEffect(() => {
    if (dragPath === null) setDropTone(null);
  }, [dragPath]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    /* `text/plain` 是给宿主与调试用的（拖到别处至少能看见路径）；面板内部的判据
       认的是 `dragPath`，所以 dataTransfer 缺失（jsdom 等）也不该把拖拽打断。 */
    const transfer = event.dataTransfer;
    if (transfer) {
      transfer.setData("text/plain", node.path);
      transfer.effectAllowed = "move";
    }
    onDragStartNode(node.path);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    /* 外部拖进来的东西（文件、别处的文字）不是改分类 */
    if (dragPath === null) return;
    /* 指针就在自己身上：拿起一行时它必然先在自己的行上停留。这时既不该标"能放"
       也不该说"不能挂到自己下面" —— 那不是用户在做的事，是他还没开始移动。 */
    if (draggingSelf) {
      setDropTone(null);
      onDropHover(null);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      return;
    }
    const tone = resolveDrop(node.path);
    setDropTone(tone);
    /* 悬停即报落点：非法目标不会收到 drop，理由得在悬停时就说出口 */
    onDropHover(node.path);
    if (tone === "invalid") {
      /* 非法目标**不** preventDefault：让浏览器画自己的「禁止」光标，比自绘一个
         not-allowed 更可信（自绘会盖掉"为什么不行"）。此时浏览器一般不给 drop，
         行的淡红底已经说明"这里放不下"；宿主真给了 drop，由面板说清理由。 */
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    /* `dragleave` 在指针进入子元素时也会触发：只有真离开这一行才清 */
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropTone(null);
    onDropHover(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (dragPath === null) return;
    /* 落在自己身上 = 什么都没发生（不是"挂到自己下面"这种错误） */
    if (draggingSelf) return;
    event.preventDefault();
    /* 这一下已经由本行处理，别让外层的投放区再收一遍 */
    event.stopPropagation();
    setDropTone(null);
    onDropHover(null);
    /* 非法目标也交给面板：合法性由 `reparentTagPath` 一处判，面板据此出中文人话。
       行在这里再判一次只会造成"两处判据分叉"。 */
    onReparent(dragPath, node.path);
  };

  const handleDragEnd = () => {
    setDropTone(null);
    onDropHover(null);
    onDragEndNode();
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === node.path) return;
    onRename(node.path, next);
  };

  const hasChildren = node.children.length > 0;
  const nested = node.children.length;
  /* 「含子标签」这句话只在合计与自身不等时才有信息量，其余时候说多了是噪音 */
  const countTitle = node.totalCount === node.count
    ? `${node.count} 条事项在用这个标签`
    : `自身 ${node.count} 条，含子标签共 ${node.totalCount} 条`;

  const question = hasChildren
    ? `删除「${node.name}」及其 ${nested} 个子标签？`
    : `删除「${node.name}」？`;
  const impact = descendantCount > 0
    ? `会从 ${descendantCount} 条事项上摘掉，无法撤销`
    : "目前没有事项在引用，只删标签本身";

  return (
    <li>
      <div
        className={`dtm-row flex min-w-0 items-center gap-1.5 py-2.5 pr-2${
          confirming ? " dtm-row-confirm" : ""
        }`}
        style={{ paddingLeft: `${8 + node.depth * 18}px` }}
        /* `data-path` 是拖拽落点的身份（判据与测试都靠它认路，不靠文案） */
        data-path={node.path}
        data-dragging={draggingSelf ? "true" : "false"}
        data-drop-target={dropTone ?? "none"}
        draggable={canDrag}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {confirming ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
            role="group"
            aria-label={`确认删除 ${node.path}`}
            onBlur={(event) => {
              /* 焦点整体离开这一行（点了别处）就收起确认带，避免它一直挂着 */
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setConfirming(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setConfirming(false);
            }}
          >
            <AlertTriangle
              size={ICON}
              strokeWidth={2.1}
              aria-hidden
              className="shrink-0 text-[var(--at-danger)]"
            />
            <span
              className="min-w-0 flex-1 truncate at-text-caption"
              title={`${question}${impact}`}
            >
              <span className="text-[var(--at-text-primary)]">{question}</span>
              <span className="text-[var(--at-text-secondary)]"> {impact}</span>
            </span>
            <button
              ref={cancelRef}
              type="button"
              className="dtm-action shrink-0"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="dtm-confirm-danger shrink-0"
              aria-label={`确认删除 ${node.path}，会从 ${descendantCount} 条事项上摘掉`}
              onClick={() => {
                setConfirming(false);
                onDelete(node.path);
              }}
            >
              确认删除
            </button>
          </div>
        ) : (
          <>
            {hasChildren ? (
              <button
                type="button"
                className="dtm-caret"
                aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
                aria-expanded={expanded}
                onClick={() => onToggle(node.path)}
              >
                {expanded
                  ? <ChevronDown size={ICON} strokeWidth={STROKE} />
                  : <ChevronRight size={ICON} strokeWidth={STROKE} />}
              </button>
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            )}

            {editing ? (
              <input
                ref={inputRef}
                className="dtm-input min-w-0 flex-1 px-2"
                value={draft}
                aria-label={`重命名 ${node.path}`}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                    setDraft(node.path);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                title={node.path}
                onDoubleClick={() => setEditing(true)}
              >
                <span
                  className={`truncate text-[var(--at-text-primary)]${hasChildren ? " font-medium" : ""}`}
                >
                  {node.name}
                </span>
                <span
                  className="dtm-metric shrink-0 at-text-caption text-[var(--at-text-tertiary)]"
                  title={countTitle}
                >
                  {node.totalCount} 条引用
                </span>
              </button>
            )}

            {hasChildren && (
              <span className="dtm-metric shrink-0 at-text-caption text-[var(--at-text-secondary)]">
                {nested} 个子标签
              </span>
            )}

            <div className="ml-3 flex shrink-0 items-center gap-2.5 at-text-caption">
              <button
                type="button"
                className="dtm-action"
                aria-label={`重命名 ${node.path}`}
                onClick={() => setEditing(true)}
              >
                改名
              </button>
              <button
                type="button"
                className="dtm-action dtm-action-danger"
                aria-label={`删除 ${node.path}`}
                onClick={() => setConfirming(true)}
              >
                删除
              </button>
              <button
                type="button"
                className="dtm-addchild"
                aria-label={`在 ${node.path} 下新建子标签`}
                title={node.depth >= 3 ? "最多两级子标签" : `在「${node.name}」下新建子标签`}
                disabled={node.depth >= 3}
                onClick={() => onAddChild(node.path)}
              >
                <Plus size={ICON} strokeWidth={2.1} />
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}
