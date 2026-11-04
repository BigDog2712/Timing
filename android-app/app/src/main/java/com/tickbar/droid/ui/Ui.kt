package com.tickbar.droid.ui

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.tickbar.droid.core.Tk

/**
 * 少量手写 UI 工具。骨架阶段刻意不引 Material / AndroidX，
 * 所以按钮、卡片、分段控件都从这里拼，样式口径统一在 [Tk]。
 */
object Ui {

    fun px(c: Context, v: Int): Int = Tk.dp(c, v)

    fun text(
        c: Context,
        s: CharSequence,
        sizeSp: Float,
        color: Int = Tk.INK,
        bold: Boolean = false,
    ): TextView = TextView(c).apply {
        text = s
        textSize = sizeSp
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        includeFontPadding = false
    }

    fun round(c: Context, color: Int, radiusDp: Int, strokeColor: Int = 0, strokeDp: Int = 0) =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = Tk.dp(c, radiusDp).toFloat()
            if (strokeDp > 0) setStroke(Tk.dp(c, strokeDp), strokeColor)
        }

    /** 卡片容器：14dp 圆角 + 卡片底色 + 1px 描边，内边距 14dp。 */
    fun card(c: Context): LinearLayout = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        background = round(c, Tk.CARD, 14, Tk.LINE, 1)
        setPadding(px(c, 14), px(c, 12), px(c, 14), px(c, 12))
    }

    fun row(c: Context): LinearLayout = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun button(
        c: Context,
        label: String,
        primary: Boolean = false,
        danger: Boolean = false,
        onClick: () -> Unit,
    ): TextView {
        // 主按钮是「淡色底 + 同色字」。深色下用亮蓝，浅色下必须换成深蓝，
        // 否则浅底浅字，等于没有字。
        val bg = when {
            danger -> round(c, if (Tk.dark) 0xFFE1292F.toInt() else 0xFFD02C33.toInt(), 11)
            primary -> if (Tk.dark) {
                round(c, 0x244DA3E8, 11, 0x524DA3E8, 1)
            } else {
                round(c, 0x141669AD, 11, 0x521669AD, 1)
            }
            else -> round(c, Tk.FIELD_HI, 11, Tk.LINE_2, 1)
        }
        val ink = when {
            danger -> 0xFFFFFFFF.toInt()
            primary -> if (Tk.dark) 0xFF8FC6F5.toInt() else 0xFF1669AD.toInt()
            else -> Tk.INK
        }
        return text(c, label, 15f, ink, bold = true).apply {
            background = bg
            gravity = Gravity.CENTER
            setPadding(px(c, 14), px(c, 12), px(c, 14), px(c, 12))
            isClickable = true
            setOnClickListener { onClick() }
        }
    }

    /** 二级标题（小、白、留白撑层级，不用灰字）。 */
    fun label(c: Context, s: String): TextView = text(c, s, 13f, Tk.INK, bold = true).apply {
        setPadding(px(c, 2), px(c, 6), 0, px(c, 6))
    }

    fun divider(c: Context): View = View(c).apply {
        setBackgroundColor(Tk.LINE_3)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply {
            topMargin = px(c, 8)
            bottomMargin = px(c, 8)
        }
    }

    fun gap(c: Context, dp: Int): View = View(c).apply {
        layoutParams = LinearLayout.LayoutParams(1, px(c, dp))
    }

    /** 左标签 + 右值的一行，点击整行触发。 */
    fun settingRow(c: Context, title: String, value: () -> String, onClick: () -> Unit): LinearLayout {
        val r = row(c).apply {
            background = round(c, Tk.FIELD, 11, Tk.LINE, 1)
            setPadding(px(c, 12), px(c, 13), px(c, 12), px(c, 13))
            isClickable = true
            setOnClickListener { onClick() }
        }
        r.addView(text(c, title, 15f), LinearLayout.LayoutParams(0, WRAP, 1f))
        r.addView(text(c, value(), 14f, Tk.ACCENT))
        // 值需要跟着状态变：调用方通过 tag 找回来刷新
        r.tag = r.getChildAt(1)
        return r
    }

    fun refreshRowValue(r: LinearLayout, v: String) {
        (r.tag as? TextView)?.text = v
    }

    const val WRAP = LinearLayout.LayoutParams.WRAP_CONTENT
    const val MATCH = LinearLayout.LayoutParams.MATCH_PARENT
}
