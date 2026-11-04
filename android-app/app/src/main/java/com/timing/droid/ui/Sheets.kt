package com.timing.droid.ui

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.Window
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import com.timing.droid.core.Tk

/**
 * 底部 Sheet。桌面端用右键菜单 / 滚轮做的事情，手机上收进 Sheet：
 * 定长倒计时、换事项。返回键可关（Dialog 默认行为）。
 */
object Sheets {

    private fun show(c: Context, title: String, build: (LinearLayout, Dialog) -> Unit) {
        val d = Dialog(c)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)

        val box = LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Tk.PANEL)
                val r = Tk.dp(c, 20).toFloat()
                // 只圆上面两角，贴住屏幕底部
                setCornerRadii(floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f))
                setStroke(Tk.dp(c, 1), Tk.LINE_2)
            }
            setPadding(Tk.dp(c, 18), Tk.dp(c, 18), Tk.dp(c, 18), Tk.dp(c, 28))
        }
        box.addView(Ui.text(c, title, 16f, Tk.INK, bold = true))
        box.addView(Ui.gap(c, 14))
        build(box, d)

        d.setContentView(box)
        d.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setDimAmount(0.55f)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        }
        d.show()
        d.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT)
        d.window?.setGravity(Gravity.BOTTOM)
    }

    /** 定长倒计时：预设档 + 自定义（桌面是滚轮定长，手机换成点选 + 输入）。 */
    fun countdown(c: Context, onPick: (Int) -> Unit) {
        show(c, "定长倒计时") { box, d ->
            val presets = listOf(5, 10, 15, 25, 45, 60)
            presets.chunked(3).forEach { group ->
                val row = Ui.row(c)
                group.forEach { m ->
                    val b = Ui.button(c, "$m 分钟") {
                        d.dismiss()
                        onPick(m)
                    }
                    row.addView(b, LinearLayout.LayoutParams(0, Ui.WRAP, 1f).apply {
                        if (m != group.first()) leftMargin = Tk.dp(c, 8)
                    })
                }
                box.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                    topMargin = Tk.dp(c, 8)
                })
            }

            box.addView(Ui.gap(c, 6))
            box.addView(Ui.label(c, "自定义（分钟）"))
            val input = EditText(c).apply {
                inputType = InputType.TYPE_CLASS_NUMBER
                hint = "1 – 600"
                textSize = 15f
                setTextColor(Tk.INK)
                setHintTextColor(Tk.INK_DIM)
                background = Ui.round(c, Tk.FIELD, 11, Tk.LINE, 1)
                setPadding(Tk.dp(c, 12), Tk.dp(c, 10), Tk.dp(c, 12), Tk.dp(c, 10))
                setSingleLine()
            }
            box.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP))
            box.addView(
                Ui.button(c, "开始倒计时", primary = true) {
                    val m = input.text.toString().toIntOrNull() ?: return@button
                    d.dismiss()
                    onPick(m)
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                    topMargin = Tk.dp(c, 10)
                },
            )
        }
    }

    /** 单行文本输入（文件模板、标题行这类配置用）。 */
    fun prompt(
        c: Context,
        title: String,
        hint: String,
        value: String,
        onOk: (String) -> Unit,
    ) {
        show(c, title) { box, d ->
            val input = EditText(c).apply {
                inputType = InputType.TYPE_CLASS_TEXT
                this.hint = hint
                textSize = 15f
                setTextColor(Tk.INK)
                setHintTextColor(Tk.INK_DIM)
                background = Ui.round(c, Tk.FIELD, 11, Tk.LINE, 1)
                setPadding(Tk.dp(c, 12), Tk.dp(c, 10), Tk.dp(c, 12), Tk.dp(c, 10))
                setSingleLine()
                setText(value)
                setSelection(value.length)
            }
            box.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP))
            box.addView(
                Ui.button(c, "保存", primary = true) {
                    d.dismiss()
                    onOk(input.text.toString().trim())
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                    topMargin = Tk.dp(c, 10)
                },
            )
        }
    }

    /**
     * 二次确认。删除这类不可撤销的操作走这里，样式与其它 Sheet 一致
     * （不用系统 AlertDialog：它在深色主题下是白底黑字的另一套外观）。
     */
    fun confirm(
        c: Context,
        title: String,
        message: String,
        okLabel: String = "删除",
        onOk: () -> Unit,
    ) {
        show(c, title) { box, d ->
            box.addView(Ui.text(c, message, 13f, Tk.INK_DIM))
            val row = Ui.row(c)
            row.addView(
                Ui.button(c, "取消") { d.dismiss() },
                LinearLayout.LayoutParams(0, Ui.WRAP, 1f),
            )
            row.addView(
                Ui.button(c, okLabel, danger = true) {
                    d.dismiss()
                    onOk()
                },
                LinearLayout.LayoutParams(0, Ui.WRAP, 1f).apply { leftMargin = Tk.dp(c, 8) },
            )
            box.addView(
                row,
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                    topMargin = Tk.dp(c, 14)
                },
            )
        }
    }

    /** 换事项 / 新建事项。 */
    fun item(c: Context, current: String, recent: List<String>, onPick: (String) -> Unit) {        show(c, "换事项") { box, d ->
            if (recent.isNotEmpty()) {
                val scroll = ScrollView(c)
                val list = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL }
                recent.forEach { name ->
                    val b = Ui.button(c, name, primary = name == current) {
                        d.dismiss()
                        onPick(name)
                    }
                    list.addView(b, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                        topMargin = Tk.dp(c, 6)
                    })
                }
                scroll.addView(list)
                box.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Tk.dp(c, 190)))
                box.addView(Ui.gap(c, 6))
            }

            box.addView(Ui.label(c, "新事项"))
            val input = EditText(c).apply {
                hint = "比如：写周报"
                textSize = 15f
                setTextColor(Tk.INK)
                setHintTextColor(Tk.INK_DIM)
                background = Ui.round(c, Tk.FIELD, 11, Tk.LINE, 1)
                setPadding(Tk.dp(c, 12), Tk.dp(c, 10), Tk.dp(c, 12), Tk.dp(c, 10))
                setSingleLine()
            }
            box.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP))
            box.addView(
                Ui.button(c, "用这个事项开始", primary = true) {
                    val n = input.text.toString().trim()
                    if (n.isEmpty()) return@button
                    d.dismiss()
                    onPick(n)
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
                    topMargin = Tk.dp(c, 10)
                },
            )
        }
    }
}
