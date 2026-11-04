package com.tickbar.droid.ui

import android.app.Activity
import android.graphics.Paint
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.tickbar.droid.core.TimeFmt
import com.tickbar.droid.core.TimerCore
import com.tickbar.droid.core.Tk
import com.tickbar.droid.core.TodoStore

/**
 * 二级页「事项」：今日汇总 + 待办列表。
 * 桌面这里是独立窗口 + 右键菜单；手机上合并成一页，长按行删除。
 */
class TodoPage(private val a: Activity) : Page {

    private val summary = Ui.text(a, "", 13f, Tk.INK_DIM)
    private val list = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val input = EditText(a)

    private fun d(v: Int) = Tk.dp(a, v)

    override val view: View = build()

    private fun build(): View {
        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(18), d(10), d(18), d(24))
        }
        col.addView(Ui.text(a, "事项", 22f, Tk.INK, bold = true))

        val card = Ui.card(a).apply { setPadding(d(14), d(14), d(14), d(14)) }
        card.addView(Ui.label(a, "今日"))
        card.addView(summary)
        col.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(12)
        })

        // 新建待办
        input.apply {
            inputType = InputType.TYPE_CLASS_TEXT
            hint = "记一条待办…"
            textSize = 15f
            setTextColor(Tk.INK)
            setHintTextColor(Tk.INK_DIM)
            background = Ui.round(a, Tk.FIELD, 11, Tk.LINE, 1)
            setPadding(d(12), d(10), d(12), d(10))
            setSingleLine()
            /* 空态文案写着「回车即可加」，那就得真的能加：键盘右下角那颗「完成」直接提交。 */
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                    addTodo()
                    true
                } else {
                    false
                }
            }
        }
        val addRow = Ui.row(a)
        addRow.addView(input, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        addRow.addView(
            Ui.button(a, "添加", primary = true) { addTodo() },
            LinearLayout.LayoutParams(d(76), Ui.WRAP).apply { leftMargin = d(8) },
        )
        col.addView(addRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(12)
        })

        col.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(6)
        })

        val scroll = ScrollView(a).apply {
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
        return scroll
    }

    override fun onShow() = render()

    /** 添加并清空输入框（按钮与键盘「完成」共用，别让两条路径行为不一样）。 */
    private fun addTodo() {
        TodoStore.add(input.text.toString())
        input.setText("")
        render()
    }

    private fun render() {
        TodoStore.ensureLoaded()
        val total = TimerCore.todayTotalMs()
        summary.text = "${TimerCore.sessions.size} 次计时 · ${TimeFmt.human(total)} · 待办 ${TodoStore.remaining} 条"

        list.removeAllViews()
        if (TodoStore.items.isEmpty()) {
            list.addView(
                Ui.text(a, "还没有待办。上面写一条，回车即可加。", 12f, Tk.INK_DIM).apply {
                    setPadding(d(4), d(14), 0, d(14))
                },
            )
            return
        }

        TodoStore.items.forEach { t ->
            val row = Ui.row(a).apply {
                background = Ui.round(a, Tk.CARD, 12, Tk.LINE, 1)
                setPadding(d(12), d(13), d(12), d(13))
                isClickable = true
                setOnClickListener {
                    TodoStore.toggle(t)
                    render()
                }
                setOnLongClickListener {
                    TodoStore.remove(t)
                    render()
                    true
                }
            }

            // 勾选圈：完成时填充绿色，未完成只留描边（不用 emoji，和桌面一致）
            val mark = View(a).apply {
                background = Ui.round(
                    a,
                    if (t.done) Tk.OK else 0x00000000,
                    6,
                    if (t.done) Tk.OK else Tk.LINE_3,
                    2,
                )
            }
            row.addView(mark, LinearLayout.LayoutParams(d(16), d(16)).apply { rightMargin = d(10) })

            val title = Ui.text(a, t.title, 15f, if (t.done) Tk.INK_DIM else Tk.INK)
            if (t.done) title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
            row.addView(title, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))

            list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                topMargin = d(8)
            })
        }
    }
}
