package com.timing.droid.ui

import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import com.timing.droid.core.NoteStore
import com.timing.droid.core.NoteText
import com.timing.droid.core.RepoNote
import com.timing.droid.core.Tk

/**
 * 页签「便利贴」：全部便利贴的清单。
 *
 * 桌面端是「每张贴一个小窗，最多同时开 20 张」；手机没有第二块屏幕，PRD 定的口径是
 * **一张清单 + 一个全屏编辑页**。所以这一页只做三件事：看清单、进编辑、删。
 *
 * 清单口径照抄桌面 `NotesListPopover`：
 * - 最近改过在前；
 * - 标题 = 正文首行（超 18 字截断，空的叫「未命名便利贴」）；
 * - 副行 = 关联事项名，没关联的显示时间；
 * - 空白便利贴不出现（那是「新建了但没写」的中间态）。
 */
class NotesPage(private val a: MainActivity) : Page {

    private val list = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val summary = Ui.text(a, "", 13f, Tk.INK_DIM)

    /**
     * 上次渲染时的「行数据签名」。
     *
     * `onShow()` 会在每次切页签、每次从编辑页返回、每次同步收到数据时被调用，
     * 而旧实现每次都 `removeAllViews()` + 逐张重建卡片：一张没变也重建，
     * 白丢滚动位置、白抖一下。签名一致就只更新顶部 summary。
     * 增删改都会让签名变（id / 时间戳 / 正文 hash / 关联事项都在里面）。
     */
    private var lastSignature: String? = null

    private fun d(v: Int) = Tk.dp(a, v)

    override val view: View = build()

    private fun build(): View {
        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(18), d(10), d(18), d(24))
        }

        // 标题 + 新建。手机上「新建」必须常显（桌面靠手柄/托盘菜单，手机没有那些入口）
        val head = Ui.row(a)
        head.addView(
            Ui.text(a, "便利贴", 22f, Tk.INK, bold = true),
            LinearLayout.LayoutParams(0, Ui.WRAP, 1f),
        )
        head.addView(
            Ui.button(a, "+ 新建", primary = true) { a.router.createNote() },
            LinearLayout.LayoutParams(d(88), Ui.WRAP),
        )
        col.addView(head, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

        col.addView(summary, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) })

        col.addView(list, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(12) })

        return ScrollView(a).apply {
            isFillViewport = true
            addView(
                col,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
            addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v: View) = render()
                override fun onViewDetachedFromWindow(v: View) = Unit
            })
        }
    }

    /** 切回本页、或从编辑页返回时都会走到这里（`Router` 关页后通知外壳 `show(index)`）。 */
    override fun onShow() = render()

    private fun render() {
        NoteStore.reload()
        val rows = NoteStore.visible
        val current = NoteStore.currentItemName()
        /* summary 很便宜，每次顺手刷新：它含「当前事项」，与列表签名无关 */
        summary.text = when {
            rows.isEmpty() -> "还没有便利贴"
            current.isNullOrEmpty() -> "${rows.size} 张"
            else -> "${rows.size} 张 · 当前事项：$current"
        }

        /* 签名只覆盖「影响卡片长相」的字段：id（顺序/身份）、updatedAt（副行时间）、
           正文 hash（标题）、关联事项名（副行）。空白便利贴已在 visible 里滤掉。 */
        val signature = rows.joinToString("\n") { note ->
            "${note.id}:${note.updatedAt}:${note.content.hashCode()}:${note.itemName.orEmpty()}"
        }
        if (signature == lastSignature) return
        lastSignature = signature

        list.removeAllViews()
        if (rows.isEmpty()) {
            list.addView(empty(), LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))
            return
        }
        rows.forEach { note ->
            list.addView(
                card(note),
                LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) },
            )
        }
    }

    private fun empty(): View {
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.round(a, Tk.CARD, 12, Tk.LINE, 1)
            setPadding(d(14), d(18), d(14), d(18))
        }
        box.addView(Ui.text(a, "还没有便利贴", 15f, Tk.INK, bold = true))
        box.addView(
            Ui.text(
                a,
                "写一条随手记，默认挂到当前事项上；回到电脑也能在同一个日记文件里看到。",
                13f,
                Tk.INK_DIM,
            ).apply { setPadding(0, d(6), 0, d(12)) },
        )
        box.addView(
            Ui.button(a, "写一张", primary = true) { a.router.createNote() },
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP),
        )
        return box
    }

    private fun card(note: RepoNote.Note): View {
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.round(a, Tk.CARD, 12, Tk.LINE, 1)
            setPadding(d(13), d(11), d(13), d(11))
            isClickable = true
            setOnClickListener { a.router.openNote(note.id) }
            setOnLongClickListener {
                Sheets.confirm(
                    a,
                    "删除便利贴",
                    "「${NoteText.titleOf(note.content, 20)}」删掉就找不回来了。",
                ) {
                    NoteStore.remove(note.id)
                    render()
                }
                true
            }
        }

        box.addView(Ui.text(a, NoteText.titleOf(note.content), 15f, Tk.INK))

        val meta = ArrayList<String>()
        meta.add(note.itemName ?: "未关联")
        meta.add(NoteText.stampOf(note.updatedAt))
        box.addView(
            Ui.text(a, meta.joinToString(" · "), 12f, Tk.INK_DIM).apply {
                setPadding(0, d(5), 0, 0)
            },
        )
        return box
    }
}
