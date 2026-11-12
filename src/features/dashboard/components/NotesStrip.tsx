import { useCallback, useState, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import type { NoteSummary } from "../../../shared/types/notes.ts";
import { emitHostIntent } from "../../../platform/runtime/hostIntentGateway.ts";
import type { TodayNotesState } from "../hooks/useTodayNotes.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import { useBoardInstance, withInstance } from "../layout/instanceContext.ts";

/**
 * 模块 5 · 便利贴（**版式照 `widgets/notes.rs`**：卡头 + 纸片墙）
 *
 * Rust 版不是一条横向滚动条，而是一墙"纸片"：双列时每张 88 高、单列 78，纸片左侧一条
 * 2.5px 色条，正文 11.5 两行截断，底下 10px 一行元信息（相对时间）。
 * 这里照着做 —— 单行胶囊读起来像标签，纸片读起来像便签，这是这张卡的全部语义。
 *
 * 四条克制：
 *   · **没有写命令，只有意图**（L9）。点开看全文，展开的弹层里可以删：删除走
 *     `patina:host-intent` 的 `delete_note`，由药丸用 `services/noteActions.removeNote`
 *     落库（note_delete + 关窗）。分析窗一条写命令都没有，这条边界是**协议级**的；
 *     意图**没发出去**（`emitHostIntent` 解析成 `false`：不在 Tauri 里 / `emitTo` 抛错）时
 *     **不摘本地、不关弹层**，只给一句提示 —— 否则界面已摘、`pendingDeletedRef` 又挡住
 *     后续刷新，症状是"看着删了、重启后便利贴回来"（`TimelineManage.submitCreate` 同款纪律）；
 *   · 删除要**二次确认**：确认条内联在同一个 `QuietDialog` 的 actions 里，
 *     不叠第二层弹窗（两层弹窗的 Escape 语义会互相打架）；
 *   · 张数「0 也写」：`0 张` 与"什么都不显示"是两条不同的信息；
 *   · 颜色只取主题的 accent：Rust 用事项名派生色相，而 `NoteSummary` 里没有事项名
 *     （只有 `itemId`），编一个色反而会让"同一事项同色"这条承诺变成假话。
 */
interface Props {
  /** 便利贴是**独立源**：三态与数据都在这个 model 里（hook 由 `Dashboard` 提起，
   *  因为 E5 的 `hasAnyData()` 必须能看见它） */
  model: TodayNotesState;
  /** 卡头 `⋯`（v3：便利贴也是板上的一张卡，同样要能改名/复制/移除） */
  controls?: ReactNode;
}

export default function NotesStrip({ model, controls }: Props) {
  const locale = useLocale();
  const UI_TEXT = useLocaleText();
  const copy = DASHBOARD_COPY[locale];
  const { notes, total, status, retry } = model;
  const [opened, setOpened] = useState<NoteSummary | null>(null);
  /* 内联二次确认：与 `opened` 同生同灭，关弹层时一起复位 */
  const [confirming, setConfirming] = useState(false);
  /* 删除意图**没发出去**（不在 Tauri 里 / `emitTo` 抛错）时的可见提示。
   * 它与 `opened` 同生同灭：换一张贴就不该继续挂着上一张的失败提示。 */
  const [deleteNotSent, setDeleteNotSent] = useState(false);
  const domId = withInstance("t-notes", useBoardInstance());
  /* 有卡 + error = 刷新失败（E3）；无卡 + error = 模块级错误（E2）。同一个 status 派生 */
  const loading = status === "loading";
  const errorWithData = status === "error" && notes.length > 0;
  const errorWithoutData = status === "error" && notes.length === 0;
  const now = Date.now();

  const closeDialog = useCallback(() => {
    setOpened(null);
    setConfirming(false);
    setDeleteNotSent(false);
  }, []);

  /** 打开某一张：确认条与失败提示都必须是这张贴自己的状态，不许从上一张漏过来 */
  const openNote = useCallback((note: NoteSummary) => {
    setOpened(note);
    setConfirming(false);
    setDeleteNotSent(false);
  }, []);

  const deleteOpened = useCallback(() => {
    if (!opened) return;
    const noteId = opened.id;
    setDeleteNotSent(false);
    /* ① 意图出桥（分析窗没有写命令）：药丸侧 `removeNote(noteId)` 做 note_delete + 关窗
     *
     * `emitHostIntent` 解析出 `false` = **没发出去**，不是"宿主拒了"。这两件事必须分开处理：
     * 前者宿主根本没收到，本地一摘、`pendingDeletedRef` 又把后续刷新挡住，就成了
     * 「看着删了、重启后便利贴回来」；后者（宿主侧失败）由药丸自己弹提示（§6.5）。
     * 所以形状照 `TimelineManage.submitCreate` 的纪律：`sent === false` 时**一步都不往前走**。 */
    void emitHostIntent({ action: "delete_note", noteId }).then((sent) => {
      if (!sent) {
        /* 不摘本地、不关弹层，给一句"没发出去" —— 用户能重试，且清单还是真的 */
        setDeleteNotSent(true);
        return;
      }
      /* ② 发出去之后才从本地清单摘掉，并记进"待消失"集合 —— 否则下一次 30s 刷新会把它放回来
            （用户看到"删了又蹦回来"）。见 `useTodayNotes.removeLocal`。 */
      model.removeLocal(noteId);
      /* ③ 收弹层 */
      closeDialog();
    });
  }, [closeDialog, model, opened]);

  return (
    <>
      <section className="qp-notes" aria-labelledby={domId} aria-busy={loading || undefined} data-card="notes">
        <div className="qp-notes-head">
          <h2 id={domId} className="qp-notes-title">{copy.notesTitle}</h2>
          <span className="qp-notes-more">
            {errorWithData ? (
              <span className="qp-refresh-error" data-error-layer="refresh" role="alert" title={UI_TEXT.common.refreshFailed}>
                <AlertCircle size={12} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">{UI_TEXT.common.refreshFailed}</span>
              </span>
            ) : null}
            <span className="qp-notes-count">{copy.notesCount(total)}</span>
            {controls}
          </span>
        </div>

        <div className="qp-notes-track qp-scroll-region">
          {errorWithoutData ? (
            /* E2：与四张卡同一套（条件渲染 → 出现即播报；重试用 aria-disabled 不用 disabled） */
            <div
              className="qp-module-error qp-notes-error"
              role="alert"
              data-error-layer="module"
              aria-labelledby={`${domId} ${domId}-error`}
            >
              <p id={`${domId}-error`} className="qp-module-error-text">{UI_TEXT.common.readFailed}</p>
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
                  onClick={() => openNote(note)}
                >
                  <span className="qp-note-body">{firstLine(note.content)}</span>
                  <span className="qp-note-meta">{relativeTime(note.updatedAt, now, locale)}</span>
                </button>
              ))
              : <span className="qp-note-card qp-note-placeholder">{copy.notesEmpty}</span>}
        </div>
      </section>

      <QuietDialog
        open={opened !== null}
        title={copy.notesTitle}
        surfaceClassName="qp-note-dialog"
        onClose={closeDialog}
        actions={opened ? (
          confirming ? (
            <>
              <span className="qp-note-dialog-confirm">{copy.noteDeleteConfirm}</span>
              <button
                type="button"
                className="qp-button qp-button-compact qp-button-secondary"
                onClick={() => setConfirming(false)}
              >
                {UI_TEXT.dialog.cancel}
              </button>
              <button
                type="button"
                className="qp-button qp-button-compact qp-button-danger"
                onClick={deleteOpened}
              >
                {copy.noteDelete}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="qp-button qp-button-compact qp-button-secondary"
                onClick={closeDialog}
              >
                {UI_TEXT.dialog.cancel}
              </button>
              <button
                type="button"
                className="qp-button qp-button-compact qp-button-danger"
                onClick={() => setConfirming(true)}
              >
                {copy.noteDelete}
              </button>
            </>
          )
        ) : undefined}
      >
        <p className="qp-note-dialog-text">{opened?.content ?? ""}</p>
        {/* 意图没发出去：条件渲染（出现即播报），文案说清"没发出去"而不是"删除失败" ——
            我们只知道桥没通，不知道宿主的账。 */}
        {deleteNotSent ? (
          <p className="qp-note-dialog-issue" role="status">{copy.noteDeleteNotSent}</p>
        ) : null}
      </QuietDialog>
    </>
  );
}

/** 便利贴正文可能多行；纸片只显示首个非空行（两行高，长文截断） */
function firstLine(content: string): string {
  const line = content.split(/\r?\n/).find((item) => item.trim().length > 0);
  return (line ?? "").trim();
}

/**
 * 相对时间，口径照 `format.rs:54`：<60s「刚刚」/ <1h「N 分钟前」/ <1d「N 小时前」/
 * <7d「N 天前」/ 更早给日期。文案交给 `Intl.RelativeTimeFormat`（四种语言自动本地化），
 * 免去向 i18n 表里手插键 —— 那四个 locale 文件是位置数组，插一行会让其后文案全部错位。
 */
function relativeTime(at: number, now: number, locale: string): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  if (seconds < 3600) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / 3600), "hour");
  const days = Math.floor(seconds / 86400);
  if (days < 7) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
  return new Date(at).toLocaleDateString(locale, { month: "numeric", day: "numeric" });
}
