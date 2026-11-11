import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import type { NoteSummary } from "../../../shared/types/notes.ts";
import type { TodayNotesState } from "../hooks/useTodayNotes.ts";
import { DASHBOARD_COPY } from "../copy.ts";

/**
 * 模块 5 · 便利贴条（01 §4.3 末行：56px 通栏 = head 88 + 卡片流 + more 24）
 *
 * 只读。**不做**打开便利贴窗 / 编辑 —— 那是主窗 `src/components/note/*` 的事，
 * L9 一个都引不到（01 §4.4.1 末段），本轮"只出视觉 + 真实数据"。
 *
 * ## 点开是「看全文」，不是「跳去编辑」
 *
 * 卡片是**单行截断**的，正文可能几十行。点开用 `QuietDialog` 看全文（`pre-wrap`、
 * 最高 52vh 内部滚动），只读、Esc 关闭、焦点回到那张卡 —— 用现成的共享对话框，
 * 不在这里造第二个弹层（`QuietDialog` 已经有 dialog 栈、焦点归还、Tab 环）。
 *
 * ## 张数「0 也写」
 *
 * `0 张` 与"什么都不显示"是两条不同的信息：后者读起来像"这条通栏坏了"。
 * 空态的正文另有 `notesEmpty` 一句陈述，两者不重复。
 *
 * 数据：`useTodayNotes` → `note_list`（经 platform 网关）。按 **`updatedAt`** 筛今日，
 * 这是这条通栏唯一正确的口径（理由写在 `useTodayNotes.ts` 顶部）。
 */
interface Props {
  /** 便利贴是**独立源**：三态与数据都在这个 model 里（hook 由 `Dashboard` 提起，
   *  因为 E5 的 `hasAnyData()` 必须能看见它） */
  model: TodayNotesState;
}

export default function NotesStrip({ model }: Props) {
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[useLocale()];
  const { notes, total, status, retry } = model;
  const [opened, setOpened] = useState<NoteSummary | null>(null);
  /* 有卡 + error = 刷新失败（E3）；无卡 + error = 模块级错误（E2）。同一个 status 派生 */
  const loading = status === "loading";
  const errorWithData = status === "error" && notes.length > 0;
  const errorWithoutData = status === "error" && notes.length === 0;

  return (
    <>
      <section className="qp-notes" aria-labelledby="t-notes" aria-busy={loading || undefined}>
        <div className="qp-notes-head">
          <h2 id="t-notes" className="qp-notes-title">{copy.notesTitle}</h2>
          {/* 张数写在这里而不是 more 格里：more 格只表达"还有几张没排下"，两个数不重复 */}
          <span className="qp-notes-count">{copy.notesCount(total)}</span>
        </div>

        <div className="qp-notes-track qp-scroll-region">
          {errorWithoutData ? (
            /* E2：与四张卡同一套（条件渲染 → 出现即播报；重试用 aria-disabled 不用 disabled） */
            <div
              className="qp-module-error qp-notes-error"
              role="alert"
              data-error-layer="module"
              aria-labelledby="t-notes t-notes-error"
            >
              <p id="t-notes-error" className="qp-module-error-text">{UI_TEXT.common.readFailed}</p>
              <button type="button" className="qp-link-btn" onClick={retry}>
                {UI_TEXT.common.retry}
              </button>
            </div>
          ) : loading
            ? Array.from({ length: 3 }, (_, index) => (
              <span key={index} className="qp-note-card qp-note-placeholder" aria-hidden="true" />
            ))
            : notes.length > 0
              ? notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="qp-note-card"
                  title={firstLine(note.content)}
                  aria-haspopup="dialog"
                  onClick={() => setOpened(note)}
                >
                  {firstLine(note.content)}
                </button>
              ))
              : <span className="qp-note-card qp-note-placeholder">{copy.notesEmpty}</span>}
        </div>

        {/* E3 占这一格：卡头只有 88 宽，塞不下 12px 图标（+ 计数 + 标题）。
            张数在 head 里已经是**总数**，所以这里换掉 +N 不丢信息。 */}
        <span className="qp-notes-more">
          {errorWithData ? (
            <span className="qp-refresh-error" data-error-layer="refresh" role="alert" title={UI_TEXT.common.refreshFailed}>
              <AlertCircle size={12} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">{UI_TEXT.common.refreshFailed}</span>
            </span>
          ) : total > notes.length ? copy.notesMore(total - notes.length) : null}
        </span>
      </section>

      <QuietDialog
        open={opened !== null}
        title={copy.notesTitle}
        surfaceClassName="qp-note-dialog"
        onClose={() => setOpened(null)}
      >
        <p className="qp-note-dialog-text">{opened?.content ?? ""}</p>
      </QuietDialog>
    </>
  );
}

/** 便利贴正文可能多行；这条通栏是单行截断（`white-space: nowrap`），取首个非空行 */
function firstLine(content: string): string {
  const line = content.split(/\r?\n/).find((item) => item.trim().length > 0);
  return (line ?? "").trim();
}
