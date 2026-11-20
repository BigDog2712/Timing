import { AlertCircle, Check, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { TAG_LIMITS } from "../../../../shared/tags/normalize.ts";
import {
  previewReparentPath,
  reparentTagPath,
  type ReparentReason,
} from "../../../../shared/tags/reparent.ts";
import { filterTagTree, flattenTagTree } from "../../../../shared/tags/tagTree.ts";
import type { TagAdminState } from "../hooks/useTagAdmin.ts";
import AiAutoTagButton from "./AiAutoTagButton.tsx";
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
 * ## 拖动改分类（不加依赖，用 HTML5 拖拽）
 *
 * 拖到另一行上 = 变成它的子标签；拖到列表上方的根投放区 = 移到一级。落到数据上
 * 就是一次**改名**（`学习/考公` → `工作/考公`），所以复用的还是 `state.rename`，
 * 与手打新路径那条路共用同一套 busy / 提示 / 错误处理 —— 不新开 IPC、不写 Rust。
 *
 * 三处判断都在这一层：
 *   1. `reparentTagPath`（纯函数）说能不能搬、搬成什么；行只负责把结论画出来；
 *   2. 拒绝理由在这里翻译成中文人话（**不露 `descendant` 这种枚举名**）；
 *   3. `reason: "same"` 静默 —— 拖回原位不是错误，弹一句"没变化"只是噪音。
 *
 * 还有一条容易漏：非法目标刻意不 `preventDefault`（要浏览器自己的"禁止"光标），
 * 浏览器就不会在松手时给 `drop`。所以"为什么不行"必须在**悬停时**就说出来 ——
 * 行把当前落点报给面板，面板在列表下方出一句说明（放列表上方会把行顶下去，
 * 指针底下的目标就换人了）。
 *
 * 搜索态整体禁拖：搜索结果是**过滤后**的树，缺父子上下文，拖了会让人以为是
 * "移到搜索结果里"，而真实落点是完整路径。
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
  /**
   * [0.12.5] AI 自动打标签写完之后的**页面级**重读。
   *
   * 与 `state.reload()` 分开：那个只重读标签树与走量，而批量打标签还会改应用排行上的
   * 标签 chip（读的是 override，不是标签树）。少这一个回调的症状是"标签树变了、排行没变"，
   * 用户会以为没生效再点一次。
   */
  onAfterBulkApply?: () => void;
}

type Notice = { text: string; tone: "ok" | "error" };

export default function DataTagManagerPanel({ state, onError, onAfterBulkApply }: Props) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /* 正在被拖的路径：「谁在被拖」只有面板知道（行、根投放区、可行性判断都要它） */
  const [dragging, setDragging] = useState<string | null>(null);
  const [rootTone, setRootTone] = useState<"ok" | "invalid" | null>(null);
  /* 悬停在**放不下**的行上时当场给出的那句话。单独一份、不并进 notice：
     notice 是"上一次操作的结果"，拖拽过程中的提示不该把结果提示顶掉。 */
  const [dragHint, setDragHint] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newTagRef = useRef<HTMLInputElement>(null);

  const searching = query.trim().length > 0;
  /* 搜索态不给拖；一次改名还在飞的时候也不给拖（run() 会静默 return，
     那时松手看起来"没反应"，比直接不给拖更差） */
  const dragEnabled = !searching && !busy;

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
    }, `已新建 #${path}`).finally(() => {
      /* 保存期间输入框是 disabled 的，浏览器的 disabled 会顺手把焦点收走；
         保存完把焦点还回输入框，用户能直接接着敲下一个标签（不用再点一下）。
         用 rAF 是为了等 React 把 disabled 摘掉、DOM 已可聚焦之后再调。 */
      window.requestAnimationFrame(() => newTagRef.current?.focus());
    });
  };

  const endDrag = () => {
    setDragging(null);
    setRootTone(null);
    setDragHint(null);
  };

  /** 行问「我能不能当投放目标」：一个纯函数算，行只画结论 */
  const resolveDrop = (targetPath: string): "ok" | "invalid" => {
    if (!dragging) return "invalid";
    return reparentTagPath(dragging, targetPath, state.paths).ok ? "ok" : "invalid";
  };

  /** 指针悬停到某一行（null = 离开）：能放就静音，放不下就当场说明理由 */
  const hoverDropTarget = (targetPath: string | null) => {
    if (!dragging || targetPath === null) {
      setDragHint(null);
      return;
    }
    const outcome = reparentTagPath(dragging, targetPath, state.paths);
    if (outcome.ok || outcome.reason === "same") {
      setDragHint(null);
      return;
    }
    setDragHint(reparentFailureText(dragging, targetPath, outcome.reason));
  };

  const reparent = (from: string, targetParent: string | null) => {
    /* 松手就先把拖拽态清掉：拒也要清，否则半透明的行和根投放区会一直挂着 */
    endDrag();
    const outcome = reparentTagPath(from, targetParent, state.paths);
    if (!outcome.ok) {
      /* 拖回原位不算失败：不弹提示、不发意图（弹一句"没变化"只是噪音） */
      if (outcome.reason === "same") return;
      fail(reparentFailureText(from, targetParent, outcome.reason));
      return;
    }
    void run(() => state.rename(from, outcome.next), `已把 #${from} 移到 #${outcome.next}`);
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
        <div className="flex items-center gap-2">
          {/* [0.12.5] AI 批量打标签：放在这里而不是数据页页头，是因为它改的是**标签**
              本身（应用的 override.tags、事项的 items.tags），用户此刻正在看这棵树。 */}
          <AiAutoTagButton
            onApplied={() => {
              void state.reload();
              onAfterBulkApply?.();
            }}
            onNotice={(text, tone) => setNotice({ text, tone })}
          />
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
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitNew(draft);
        }}
      >
        <input
          ref={newTagRef}
          className="dtm-input min-w-0 flex-1"
          value={draft}
          placeholder="新建标签，如 学习/考公"
          aria-label="新建标签路径"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            /* 中文输入法里回车是「上屏」，不是「提交」：组合态交给 IME，
               否则拼音还没选字就被拿去做标签名了。 */
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submitNew(draft);
          }}
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

      {/* 搜索态禁拖必须**说出来**：不解释的话，用户只会觉得"拖动坏了" */}
      {searching ? (
        <p className="mt-1.5 at-text-caption text-[var(--at-text-tertiary)]">
          搜索结果里不能拖动排序（过滤后缺父子上下文）：清空搜索后再拖。
        </p>
      ) : null}

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

      {/* 根投放区：只在真的有东西在拖时出现。三个方案里选了这个 ——
          ① 永久占位：空态下搜索行与列表之间永远多一条没人能点的"缝"；
          ② 绝对定位浮层：会压住第一行，而第一行恰恰是最常见的投放目标；
          ③ 只在拖拽中出现：代价是开始拖的一瞬间列表下移约 32px，但那一下发生在
             用户还没开始瞄准之前，是三者里最小的代价（见 0.12.x 拖动改分类）。
          高度压在 32 以下：拖拽态出现/消失时它只顶一下，别让它像是列表跳了一段。 */}
      {dragging && !searching ? (
        <div
          className="dtm-drop-root mt-3 mb-1"
          data-drop-target={rootTone ?? "none"}
          aria-label="拖到这里移到一级标签"
          onDragOver={(event) => {
            /* 先判再画，与行同口径（判据只有 `reparentTagPath` 一处）。
               不判就会"框先亮成能放、松手才报已存在" —— 那道虚线框在替一个
               放不下的动作打包票。 */
            if (dragging === null) return;
            const outcome = reparentTagPath(dragging, null, state.paths);
            if (!outcome.ok) {
              /* `same` = 它本来就在一级，拖到这儿什么也不会变：中性，不标红
                 （跟行上"拖回原位静默"是同一条口径）；其余真理由标红 + 说清。 */
              if (outcome.reason === "same") {
                setRootTone(null);
                setDragHint(null);
              } else {
                setRootTone("invalid");
                setDragHint(reparentFailureText(dragging, null, outcome.reason));
              }
              if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
              return;
            }
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            setRootTone("ok");
            setDragHint(null);
          }}
          onDragLeave={() => setRootTone(null)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragging) reparent(dragging, null);
          }}
        >
          拖到这里移到一级
        </div>
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
              dragPath={dragging}
              resolveDrop={resolveDrop}
              dragEnabled={dragEnabled}
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
                newTagRef.current?.focus();
              }}
              onDelete={(path) =>
                void run(() => state.remove(path), `已删除 #${path}（含子标签）`)
              }
              onDragStartNode={setDragging}
              onDragEndNode={endDrag}
              onReparent={reparent}
              onDropHover={hoverDropTarget}
            />
          ))
        )}
      </ul>

      {/* 拖拽过程中的说明放在**列表下方**：放在列表上方会新增一行、把正在拖的行
          整体往下顶，指针底下的目标就换人了（悬停→提示→换行→提示消失，抖起来）。
          列表下方只影响它自己。 */}
      {dragHint ? (
        <p className="mt-2 at-text-caption text-[var(--at-danger)]" role="status">
          {dragHint}
        </p>
      ) : null}

      <p className="mt-3 at-text-caption text-[var(--at-text-secondary)]">
        斜杠表示层级：「学习/考公」会自动补出父标签「学习」。改名与删除都作用于整棵子树；
        把一行拖到另一行上就是它的子标签，拖到上方虚线框则回到一级。
      </p>
    </section>
  );
}

/**
 * 拒绝理由 → 一句人话。
 *
 * **不露 `reason` 枚举名**：用户读不懂 `descendant` / `too-deep`。每条都要说清
 * 「哪两个标签、为什么不行、下一步怎么做」，而不是只说"不能这么做"。
 *
 * 用 `Record<...>` 而不是 `switch`：以后往 `ReparentReason` 里加一条理由时，
 * 这里少写文案会直接编译失败，而不是在界面上渲染出 `undefined`。
 */
function reparentFailureText(
  from: string,
  targetParent: string | null,
  reason: Exclude<ReparentReason, "same">,
): string {
  const target = targetParent ?? "一级";
  const next = previewReparentPath(from, targetParent);
  const texts: Record<Exclude<ReparentReason, "same">, string> = {
    self: `「${from}」不能挂到它自己下面`,
    descendant: `不能把「${from}」拖进它自己的子标签「${target}」里：那会把层级绕成环`,
    "too-deep":
      `层级最多 ${TAG_LIMITS.maxDepth} 级：拖到「${target}」下面，「${from}」最深的那一层会超出上限，先把深的那层挪平`,
    exists: `「${next}」已经存在了，先把其中一个改个名字再拖（不会自动合并两个标签）`,
    invalid:
      `「${next}」不是能用的标签路径：单级最多 ${TAG_LIMITS.maxSegmentLength} 字、整串最多 ${TAG_LIMITS.maxPathLength} 字，且不能有空层级`,
  };
  return texts[reason];
}
