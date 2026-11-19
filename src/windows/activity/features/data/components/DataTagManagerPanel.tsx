import { AlertCircle, Check, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { filterTagTree, flattenTagTree } from "../../../../shared/tags/tagTree.ts";
import type { TagAdminState } from "../hooks/useTagAdmin.ts";
import DataTagManagerRow from "./DataTagManagerRow.tsx";

/**
 * 数据页 · 标签管理（数据区域下方）
 * -----------------------------------------------------------------------------
 * 标签的唯一「管理页」：新建 / 改名（含子树）/ 删除（含子树）/ 搜索 / 看层级。
 * 与上面的「标签关联」面板分工：那个回答「这段时间里标签花了多久」，这里回答
 * 「标签树长什么样、要不要整理」。
 *
 * 三条口径：
 *   1. **层级靠路径**（`学习/考公`），没有第二份树表 —— 改名就是改路径，
 *      后端一个事务把所有事项与定义行一起改掉（见 `services/item_tag.rs`）。
 *   2. **空标签也要存在**：新建时写一条定义行，所以它能立刻出现在树里。
 *   3. 删除是**破坏性**的（所有事项上的引用一起清掉），所以点删除后整行原地换成
 *      确认条：说清删哪棵子树、会摘掉多少条引用，只有「确认删除」才真动手。
 *
 * ## 版式（[0.12.4] 二改）
 *
 * 三行分区，各管一件事：标题行（标题 + 总数 + 刷新）、新建行（输入 + 新建）、
 * 搜索行（搜索 + 清除）。以前刷新键混在搜索行右侧、占位符又长到被截断，
 * 读起来像"一排控件"而不是"先建、再找"。
 */
interface Props {
  state: TagAdminState;
  onError?: (message: string) => void;
}

type Notice = { text: string; tone: "ok" | "error" };

export default function DataTagManagerPanel({ state, onError }: Props) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fail = (text: string) => {
    setNotice({ text, tone: "error" });
    onError?.(text);
  };

  const visibleTree = useMemo(() => filterTagTree(state.tree, query), [state.tree, query]);
  const rows = useMemo(
    () => flattenTagTree(visibleTree, (path) => !collapsed[path]),
    [visibleTree, collapsed],
  );
  /* 搜索时强制展开：过滤后的父节点默认收着会让结果看起来「没搜到」 */
  const searchRows = useMemo(
    () => (query.trim() ? flattenTagTree(visibleTree, () => true) : rows),
    [query, visibleTree, rows],
  );

  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (done) setNotice({ text: done, tone: "ok" });
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const submitNew = (raw: string) => {
    const path = raw.trim();
    if (!path) {
      fail("标签不能为空");
      return;
    }
    void run(async () => {
      await state.create(path);
      setDraft("");
    }, `已新建 #${path}`);
  };

  return (
    <section className="at-panel p-5" aria-label="标签管理">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="at-weight-emphasis text-[var(--at-text-primary)] at-text-section-title">
            标签管理
          </h3>
          <span className="dtm-metric at-text-caption text-[var(--at-text-tertiary)]">
            {state.paths.length} 个标签 · {state.tree.length} 个一级
          </span>
        </div>
        <button
          type="button"
          className="dtm-action flex items-center gap-1 at-text-caption text-[var(--at-text-secondary)]"
          aria-label="刷新标签列表"
          disabled={busy}
          onClick={() => void run(state.reload, "列表已刷新")}
        >
          <RefreshCw size={11} strokeWidth={2} className={busy ? "animate-spin" : undefined} />
          刷新
        </button>
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitNew(draft);
        }}
      >
        <input
          className="dtm-input min-w-0 flex-1"
          value={draft}
          placeholder="新建标签，如 学习/考公"
          aria-label="新建标签路径"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="dtm-submit at-button at-button-primary shrink-0"
          disabled={busy || !draft.trim()}
        >
          新建
        </button>
      </form>

      <div className="relative mt-2">
        <Search
          size={12}
          strokeWidth={2}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--at-text-tertiary)]"
        />
        <input
          ref={searchRef}
          className="dtm-input w-full pl-8 pr-8"
          value={query}
          placeholder="搜索标签或路径"
          aria-label="搜索标签"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[var(--at-text-tertiary)] hover:text-[var(--at-text-primary)]"
            aria-label="清除搜索"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            <X size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {notice ? (
        <p
          className="mt-2 flex items-center gap-1.5 at-text-caption"
          style={{ color: notice.tone === "ok" ? "var(--at-text-secondary)" : "var(--at-danger)" }}
          role={notice.tone === "ok" ? "status" : "alert"}
        >
          {notice.tone === "ok"
            ? <Check size={11} strokeWidth={2.2} />
            : <AlertCircle size={11} strokeWidth={2.2} />}
          {notice.text}
        </p>
      ) : null}
      {state.error ? (
        <p className="mt-2 at-text-caption text-[var(--at-danger)]" role="alert">{state.error}</p>
      ) : null}

      <ul className="mt-3">
        {state.loading && rows.length === 0 ? (
          <li className="py-3 at-text-caption text-[var(--at-text-tertiary)]" role="status">
            正在读取标签…
          </li>
        ) : searchRows.length === 0 ? (
          <li className="py-3 at-text-caption text-[var(--at-text-tertiary)]">
            {query.trim() ? "没有匹配的标签" : "还没有标签：先在上面的输入框建一个"}
          </li>
        ) : (
          searchRows.map((node) => (
            <DataTagManagerRow
              key={node.path}
              node={node}
              expanded={!collapsed[node.path]}
              /* 删除影响面 = 整棵子树的引用合计（`totalCount` 已含自身） */
              descendantCount={node.totalCount}
              onToggle={(path) =>
                setCollapsed((current) => ({ ...current, [path]: !current[path] }))
              }
              onRename={(from, to) =>
                void run(
                  () => state.rename(from, to),
                  `已把 #${from} 改名为 #${to}（含子标签）`,
                )
              }
              onAddChild={(path) => {
                setDraft(`${path}/`);
                document
                  .querySelector<HTMLInputElement>('input[aria-label="新建标签路径"]')
                  ?.focus();
              }}
              onDelete={(path) =>
                void run(() => state.remove(path), `已删除 #${path}（含子标签）`)
              }
            />
          ))
        )}
      </ul>

      <p className="mt-3 at-text-caption text-[var(--at-text-secondary)]">
        斜杠表示层级：「学习/考公」会自动补出父标签「学习」。改名与删除都作用于整棵子树。
      </p>
    </section>
  );
}
