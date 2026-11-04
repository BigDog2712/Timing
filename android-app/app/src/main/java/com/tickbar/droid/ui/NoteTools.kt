package com.tickbar.droid.ui

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.tickbar.droid.core.Tk

/**
 * 便利贴编辑页底部的工具条：`•` / `→` / `←` + 关联事项。
 *
 * 从 `NoteEditPage` 拆出来只为守住单文件 300 行的纪律（与桌面端同一套规矩）。
 * 桌面端这几件事分别对应：行首 `-`+空格、Tab、Shift+Tab、页脚的「关联事项」。
 * 手机上键盘没有 Tab 键，只能给按钮。
 */
class NoteTools(
    private val a: Activity,
    private val onBullet: () -> Unit,
    private val onIndent: (Boolean) -> Unit,
    private val onPick: () -> Unit,
) {

    private val chip = Ui.text(a, "", 13f, Tk.ACCENT)

    val view: View = build()

    private fun d(v: Int) = Tk.dp(a, v)

    private fun build(): View {
        val row = Ui.row(a)
        row.addView(button("•") { onBullet() }, params(38))
        row.addView(button("→") { onIndent(false) }, params(38))
        row.addView(button("←") { onIndent(true) }, params(38))

        chip.apply {
            background = Ui.round(a, Tk.FIELD, 9, Tk.LINE, 1)
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(d(8), d(8), d(8), d(8))
            isClickable = true
            setOnClickListener { onPick() }
        }
        row.addView(chip, LinearLayout.LayoutParams(0, Ui.WRAP, 1f).apply { leftMargin = d(6) })
        return row
    }

    /** 关联事项名；null 显示「不关联事项」（点了可以重新挑）。 */
    fun render(item: String?) {
        chip.text = item ?: "不关联事项"
    }

    private fun params(widthDp: Int) =
        LinearLayout.LayoutParams(d(widthDp), Ui.WRAP).apply { rightMargin = d(6) }

    private fun button(label: String, onClick: () -> Unit): View =
        Ui.text(a, label, 15f, Tk.INK, bold = true).apply {
            background = Ui.round(a, Tk.FIELD_HI, 9, Tk.LINE_2, 1)
            gravity = Gravity.CENTER
            setPadding(0, d(9), 0, d(9))
            isClickable = true
            setOnClickListener { onClick() }
        }
}
