import { AlertTriangle, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
 */
interface Props {
  node: TagNode;
  expanded: boolean;
  /** 子树引用合计（含自身），删除确认要报这个数 */
  descendantCount: number;
  onToggle: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onAddChild: (path: string) => void;
  onDelete: (path: string) => void;
}

const ICON = 12;
const STROKE = 1.9;

export default function DataTagManagerRow({
  node,
  expanded,
  descendantCount,
  onToggle,
  onRename,
  onAddChild,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.path);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
