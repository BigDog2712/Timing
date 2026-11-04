package com.timing.droid.ui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import com.timing.droid.core.NoteStore
import com.timing.droid.core.NoteText
import com.timing.droid.core.RepoNote
import com.timing.droid.core.TimerCore
import com.timing.droid.core.Tk

/**
 * 便利贴的全屏编辑页（二级页，不是页签）。
 *
 * 对照桌面 `NoteWindow` 做的事：这里没有窗口、没有拖拽、没有悬停，所以三件事换了做法：
 *
 * | 桌面 | 手机 |
 * |---|---|
 * | 失焦 / Ctrl+Enter 落盘 | 停手 800ms 自动落盘 + 返回时强制落盘 |
 * | 右上角红点两步确认删除 | 右上「删除」+ 底部确认条 |
 * | Tab / Shift+Tab 缩进 | 工具条 `→` / `←` 按钮 |
 * | 正文里 `-` + 空格变圆点、回车续行 | 同一组纯函数 [NoteText]，在输入时拦截 |
 *
 * 保存策略刻意「边打边存」：手机随时可能被来电、切后台、系统回收打断，
 * 只靠「返回时保存」会丢掉最后几句话。
 */
class NoteEditPage(
    private val a: Activity,
    private val noteId: Long,
    private val onClose: () -> Unit,
) {

    companion object {
        /** 停手多久落盘。太短会让每敲一个字都写一次库，太长则被打断时丢得多。 */
        private const val SAVE_DEBOUNCE_MS = 800L

        /** 事项选择里的「解绑」选项（桌面端对应 `setItemId(null)`）。 */
        private const val UNBOUND = "（不关联事项）"
    }

    private val handler = Handler(Looper.getMainLooper())
    private val input = EditText(a)
    private val counter = Ui.text(a, "", 12f, Tk.INK_DIM)
    private val tools = NoteTools(
        a,
        onBullet = { insertBullet() },
        onIndent = { outdent -> indent(outdent) },
        onPick = { pickItem() },
    )

    private var itemName: String? = null
    private var closed = false
    /** 防止「返回按钮」与「系统返回键」各关一次 */
    private var leaving = false

    /** 纯函数改完文本后要落的选区；setText 会把光标弹回 0，得自己补 */
    private var guard = false
    private var inserted: Char? = null

    private val save = Runnable { flush() }

    val view: View = build()

    private fun d(v: Int) = Tk.dp(a, v)

    private fun build(): View {
        val note = NoteStore.get(noteId)
        itemName = note?.itemName

        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(16), d(8), d(16), d(12))
        }

        col.addView(head(), LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

        /* 正文容器：圆角卡片 + 内部 EditText。用 weight 撑满，键盘弹出时跟着缩。 */
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.round(a, Tk.CARD, 14, Tk.LINE, 1)
            setPadding(d(10), d(8), d(10), d(8))
        }
        input.apply {
            setText(note?.content ?: "")
            setSelection(text.length)
            textSize = 16f
            setTextColor(Tk.INK)
            setHintTextColor(Tk.INK_DIM)
            hint = "写点什么…"
            gravity = Gravity.TOP or Gravity.START
            background = null
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            isSingleLine = false
            filters = arrayOf(InputFilter.LengthFilter(RepoNote.CONTENT_MAX_LEN))
            setPadding(d(4), d(4), d(4), d(4))
        }
        input.addTextChangedListener(watcher)
        box.addView(input, LinearLayout.LayoutParams(Ui.MATCH, 0, 1f))
        col.addView(box, LinearLayout.LayoutParams(Ui.MATCH, 0, 1f).apply { topMargin = d(8) })

        col.addView(tools.view, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) })

        counter.gravity = Gravity.END
        col.addView(counter, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(4) })

        renderChrome()
        // 新建的空便利贴直接进键盘，省一次点击（桌面 autoFocus 同口径）
        if (note?.content.isNullOrEmpty()) {
            input.post {
                input.requestFocus()
                (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? InputMethodManager)
                    ?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
            }
        }
        return col
    }

    // ---------------------------------------------------------- 顶部 / 底部

    private fun head(): View {
        val row = Ui.row(a)
        val back = Ui.text(a, "‹ 返回", 15f, Tk.ACCENT, bold = true).apply {
            setPadding(0, d(10), d(12), d(10))
            isClickable = true
            setOnClickListener { close(autoCommit = true) }
        }
        val del = Ui.text(a, "删除", 13f, Tk.DANGER).apply {
            setPadding(d(12), d(10), 0, d(10))
            isClickable = true
            setOnClickListener {
                Sheets.confirm(a, "删除便利贴", "删掉就找不回来了。") {
                    handler.removeCallbacks(save)
                    NoteStore.remove(noteId)
                    closed = true
                    onClose()
                }
            }
        }
        row.addView(back, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        row.addView(del, LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP))
        return row
    }

    // ---------------------------------------------------------- 输入拦截

    private val watcher = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
            /* 只认「干净地插入了一个字符」，IME 的自动更正、粘贴多字符都不拦。 */
            inserted = if (count == 1 && before == 0 && s != null && start < s.length) s[start] else null
        }

        override fun afterTextChanged(s: Editable?) {
            if (guard || s == null) return
            val ch = inserted
            inserted = null
            val text = s.toString()

            /* 输入的是空格 / 回车时，先把这枚字符撤掉，交给纯函数判断「要不要变形」。
               不撤掉的话，纯函数看到的是「已经多了一个空格」的文本，会把圆点后面
               多留一个空格出来。 */
            if (ch == ' ' || ch == '\n') {
                val caret = input.selectionStart
                if (caret >= 1) {
                    val pre = text.removeRange(caret - 1, caret)
                    val edit = if (ch == ' ') {
                        NoteText.bulletizeOnSpace(pre, caret - 1, caret - 1)
                    } else {
                        NoteText.continueListOnEnter(pre, caret - 1, caret - 1)
                    }
                    if (edit != null) {
                        applyEdit(edit)
                        return
                    }
                }
            }
            renderCounter(text)
            scheduleSave()
        }
    }

    private fun applyEdit(edit: NoteText.Edit) {
        guard = true
        input.setText(edit.text)
        val caret = edit.start.coerceIn(0, edit.text.length)
        input.setSelection(caret)
        guard = false
        renderCounter(edit.text)
        scheduleSave()
    }

    // ---------------------------------------------------------- 工具条动作

    /** 在光标处插一个圆点（已经是圆点行就什么都不做，避免连点出 `• • `）。 */
    private fun insertBullet() {
        val text = input.text.toString()
        val caret = input.selectionStart.coerceAtLeast(0)
        val from = NoteText.lineStart(text, caret)
        val head = text.substring(from, caret)
        if (head.trimStart().startsWith("•")) return
        val insert = if (head.isBlank()) NoteText.BULLET else "\n${NoteText.BULLET}"
        val next = text.substring(0, caret) + insert + text.substring(caret)
        applyEdit(NoteText.Edit(next, caret + insert.length, caret + insert.length))
    }

    private fun indent(outdent: Boolean) {
        val text = input.text.toString()
        val start = minOf(input.selectionStart, input.selectionEnd).coerceAtLeast(0)
        val end = maxOf(input.selectionStart, input.selectionEnd).coerceAtLeast(0)
        applyEdit(NoteText.indentSelection(text, start, end, outdent))
    }

    private fun pickItem() {
        val recent = (listOfNotNull(itemName, NoteStore.currentItemName()) +
            TimerCore.sessions.map { it.item })
            .distinct()
            .take(6)
        Sheets.item(a, itemName ?: "", listOf(UNBOUND) + recent) { picked ->
            itemName = if (picked == UNBOUND) null else picked
            NoteStore.setItem(noteId, itemName)
            renderChrome()
        }
    }

    // ---------------------------------------------------------- 渲染 / 保存

    private fun renderChrome() {
        tools.render(itemName)
        renderCounter(input.text.toString())
    }

    private fun renderCounter(text: String) {
        val len = text.length
        counter.text = "$len / ${RepoNote.CONTENT_MAX_LEN}"
        counter.setTextColor(if (len >= RepoNote.CONTENT_MAX_LEN) Tk.DANGER else Tk.INK_DIM)
    }

    private fun scheduleSave() {
        handler.removeCallbacks(save)
        handler.postDelayed(save, SAVE_DEBOUNCE_MS)
    }

    /** 立即落盘（幂等：内容没变时 `RepoNote.setContent` 自己会跳过）。 */
    fun flush() {
        if (closed) return
        handler.removeCallbacks(save)
        NoteStore.setContent(noteId, input.text.toString())
    }

    /**
     * 离开本页。[autoCommit] = true 时先落盘；正文仍是空的就把这张便利贴删掉
     * —— 桌面端「空白草稿取消时删除数据行」的同一口径，避免清单里堆一串「未命名」。
     */
    fun close(autoCommit: Boolean = true) {
        if (leaving) return
        leaving = true
        /* 落盘会碰 SQLite，可能抛（磁盘满 / 库损坏）。收尾必须「无论存没存上都必达」：
           `Router.close()` 已经把 editor 置空，这里若被异常截断，就再没有第二个人去把
           navBar 与页签恢复回来 —— 界面会永久停在「页签条消失 + 内容区空白」，只能重建 Activity。
           所以异常在这里吞掉（只给用户一句提示），`finally` 里照常关页：
           宁可这一次没存上，也不能把界面锁死。 */
        try {
            if (autoCommit && !closed) {
                flush()
                if (NoteStore.isBlank(noteId)) NoteStore.remove(noteId)
            }
        } catch (err: Exception) {
            runCatching {
                Toast.makeText(a, "便利贴保存失败：${err.message}", Toast.LENGTH_LONG).show()
            }
        } finally {
            closed = true
            onClose()
        }
    }
}
