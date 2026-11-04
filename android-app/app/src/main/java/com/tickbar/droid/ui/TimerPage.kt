package com.tickbar.droid.ui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.tickbar.droid.core.TimeFmt
import com.tickbar.droid.core.TimerCore
import com.tickbar.droid.core.Tk

/**
 * 首页「计时」。桌面那颗药丸做的事这里都有：开、暂停、结束、定长倒计时、换事项。
 * 唯一没有的是「hover」，所以所有入口都做成常显按钮。
 */
class TimerPage(private val a: Activity) : Page {

    private companion object {
        /**
         * 大环尺寸的上下限（dp）。桌面那颗药丸固定 230dp，手机上不能照抄：
         * 横屏可用高度只有 360dp 左右，230dp 的环会把「开始/结束」挤到屏幕外。
         * 下限 132dp 是为了极小屏或分屏时不把环压成一个看不清的小圆。
         */
        const val RING_MAX_DP = 230
        const val RING_MIN_DP = 132

        /** 环两侧的留白（左右各 18dp 的页面内边距） */
        const val RING_SIDE_PADDING_DP = 36

        /** 环最多占可用高度的多少：留下标题、按钮、汇总的位置 */
        const val RING_HEIGHT_RATIO = 0.42f
    }

    private val ring = RingView(a)
    private val status = Ui.text(a, "", 13f, Tk.INK_DIM)
    private val chip = Ui.row(a)
    private val chipText = Ui.text(a, "", 15f, Tk.INK)
    private val primary = Ui.text(
        a, "开始", 15f,
        if (Tk.dark) 0xFF8FC6F5.toInt() else 0xFF1669AD.toInt(), bold = true,
    )
    private val finishBtn = Ui.text(a, "结束", 15f, 0xFFFFFFFF.toInt(), bold = true)
    private val undoBar = Ui.row(a)
    private val summary = Ui.text(a, "", 13f, Tk.INK_DIM)

    private val handler = Handler(Looper.getMainLooper())
    private var unwatch: (() -> Unit)? = null
    private var undoShown: TimerCore.Session? = null

    override val view: View = build()

    private fun d(v: Int) = Tk.dp(a, v)

    private fun build(): View {
        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(18), d(10), d(18), d(24))
        }

        col.addView(Ui.text(a, "计时", 22f, Tk.INK, bold = true))

        // 事项 chip：点开换事项
        chip.apply {
            background = Ui.round(a, Tk.FIELD, 11, Tk.LINE, 1)
            setPadding(d(12), d(10), d(12), d(10))
            isClickable = true
            setOnClickListener { openItemSheet() }
        }
        chip.addView(chipText, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        chip.addView(Ui.text(a, "更换 ›", 13f, Tk.ACCENT))
        col.addView(chip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(12)
        })

        // 大环（尺寸按屏幕算，见 ringSidePx）
        val ringSide = ringSidePx(a.resources.displayMetrics.widthPixels, a.resources.displayMetrics.heightPixels)
        col.addView(ring, LinearLayout.LayoutParams(ringSide, ringSide).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = d(10)
        })

        status.gravity = Gravity.CENTER_HORIZONTAL
        col.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(4)
        })

        // 主按钮 + 结束
        primary.apply {
            gravity = Gravity.CENTER
            background = if (Tk.dark) {
                Ui.round(a, 0x244DA3E8, 11, 0x524DA3E8, 1)
            } else {
                Ui.round(a, 0x141669AD, 11, 0x521669AD, 1)
            }
            setPadding(d(14), d(13), d(14), d(13))
            isClickable = true
            setOnClickListener { TimerCore.toggle() }
        }
        finishBtn.apply {
            gravity = Gravity.CENTER
            setPadding(d(14), d(13), d(14), d(13))
            isClickable = true
            background = Ui.round(a, if (Tk.dark) 0xFFE1292F.toInt() else 0xFFD02C33.toInt(), 11)
            setOnClickListener { TimerCore.finish() }
        }
        val btns = Ui.row(a)
        btns.addView(primary, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        btns.addView(finishBtn, LinearLayout.LayoutParams(d(96), Ui.WRAP).apply { leftMargin = d(8) })
        col.addView(btns, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(16)
        })

        // 次操作
        val sub = Ui.row(a)
        val cd = Ui.button(a, "倒计时") { Sheets.countdown(a) { m -> TimerCore.startCountdown(m) } }
        val sw = Ui.button(a, "换事项") { openItemSheet() }
        sub.addView(cd, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        sub.addView(sw, LinearLayout.LayoutParams(0, Ui.WRAP, 1f).apply { leftMargin = d(8) })
        col.addView(sub, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(8)
        })

        // 撤销条（3 秒）
        undoBar.apply {
            background = Ui.round(a, Tk.FIELD_HI, 11, Tk.LINE_2, 1)
            setPadding(d(12), d(10), d(12), d(10))
            visibility = View.GONE
        }
        undoBar.addView(Ui.text(a, "已保存一条记录", 13f), LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        undoBar.addView(Ui.text(a, "撤销", 13f, Tk.ACCENT, bold = true).apply {
            isClickable = true
            setOnClickListener { TimerCore.undoLast() }
        })
        col.addView(undoBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(10)
        })

        // 今日汇总
        val card = Ui.card(a)
        card.addView(Ui.label(a, "今日"))
        card.addView(summary)
        col.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.WRAP).apply {
            topMargin = d(18)
        })

        /* 用 VisibilityScroll 而不是裸 ScrollView：切页只切 visibility，
           靠 attach 事件起停 ticker 的写法已经不成立了（见该类的注释）。 */
        val scroll = VisibilityScroll(a) { shown -> if (shown) resume() else pause() }.apply {
            isFillViewport = true
            addView(
                col,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        /* 旋转 / 分屏 / 折叠不会重建 Activity（Manifest 里声明了 configChanges），
           所以这里得自己跟着新尺寸重算环：View 体系只会重新 measure，
           写死在 LayoutParams 里的边长不会自己变。 */
        scroll.addOnLayoutChangeListener { _, left, top, right, bottom, oLeft, oTop, oRight, oBottom ->
            if (right - left != oRight - oLeft || bottom - top != oBottom - oTop) {
                applyRingSize(right - left, bottom - top)
            }
        }
        return scroll
    }

    /**
     * 环边长（px）。口径 `min(230dp, 可用宽 - 36dp, 可用高 × 0.42)`，下限 132dp：
     * 宽扣掉左右各 18dp 的页面内边距，高只给环四成——剩下的要留给标题、
     * 两个按钮、次操作和今日汇总，横屏 360dp 高时才不会把「结束」挤出可视区。
     */
    private fun ringSidePx(widthPx: Int, heightPx: Int): Int {
        val density = a.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val target = minOf(
            RING_MAX_DP.toFloat(),
            widthPx / density - RING_SIDE_PADDING_DP,
            heightPx / density * RING_HEIGHT_RATIO,
        )
        return d(target.coerceAtLeast(RING_MIN_DP.toFloat()).toInt())
    }

    /** 换环的边长。尺寸没变就什么都不做，避免每帧都重新布局。 */
    private fun applyRingSize(widthPx: Int, heightPx: Int) {
        val lp = ring.layoutParams as? LinearLayout.LayoutParams ?: return
        val side = ringSidePx(widthPx, heightPx)
        if (lp.width == side && lp.height == side) return
        lp.width = side
        lp.height = side
        ring.layoutParams = lp
    }

    // ---------------------------------------------------------- 生命周期

    private fun resume() {
        if (unwatch != null) return
        unwatch = TimerCore.observe { render(it) }
        handler.post(tick)
    }

    private fun pause() {
        unwatch?.invoke()
        unwatch = null
        handler.removeCallbacks(tick)
    }

    private val tick = object : Runnable {
        override fun run() {
            render(TimerCore.current())
            handler.postDelayed(this, 250L)
        }
    }

    override fun onShow() = render(TimerCore.current())

    // ---------------------------------------------------------- 渲染

    private fun render(s: TimerCore.Snapshot) {
        ring.clock = TimeFmt.clock(s.display, ceil = s.mode == TimerCore.Mode.COUNTDOWN)
        ring.fraction = when {
            s.mode == TimerCore.Mode.COUNTDOWN && s.target > 0L -> s.remain.toFloat() / s.target
            s.active -> (s.elapsed % 60_000L) / 60_000f
            else -> 0f
        }
        ring.ringColor = when {
            s.phase == TimerCore.Phase.DONE -> Tk.OK
            s.urgent -> Tk.DANGER
            else -> Tk.ACCENT
        }

        chipText.text = "事项：${s.item}"
        status.text = when (s.phase) {
            TimerCore.Phase.IDLE -> "点「开始」或点悬浮小圆点开始"
            TimerCore.Phase.RUNNING -> if (s.mode == TimerCore.Mode.COUNTDOWN) "倒计时进行中" else "正计时进行中"
            TimerCore.Phase.PAUSED -> "已暂停"
            TimerCore.Phase.DONE -> "倒计时结束"
        }

        primary.text = when (s.phase) {
            TimerCore.Phase.RUNNING -> "暂停"
            TimerCore.Phase.PAUSED -> "继续"
            TimerCore.Phase.DONE -> "再来一次"
            TimerCore.Phase.IDLE -> "开始"
        }
        finishBtn.alpha = if (s.active) 1f else 0.35f
        finishBtn.isEnabled = s.active

        // 撤销条
        val last = TimerCore.lastSession
        if (last != null && last !== undoShown) {
            undoShown = last
            undoBar.visibility = View.VISIBLE
            handler.removeCallbacks(undoHide)
            handler.postDelayed(undoHide, 3000L)
        } else if (last == null && undoShown != null) {
            undoShown = null
            undoBar.visibility = View.GONE
        }

        val total = TimerCore.todayTotalMs()
        summary.text = if (total <= 0L) {
            "还没有记录。跑满 ${TimerCore.minRecordMs / 1000} 秒以上的计时才会入账。"
        } else {
            "${TimerCore.sessions.size} 条 · ${TimeFmt.human(total)}"
        }
    }

    private val undoHide = Runnable {
        undoBar.visibility = View.GONE
        undoShown = null
        TimerCore.dismissUndo()
    }

    private fun openItemSheet() {
        val recent = (listOf("专注", "写代码", "看文档", "休息") + TimerCore.sessions.map { it.item })
            .distinct()
            .take(6)
        Sheets.item(a, TimerCore.current().item, recent) { name ->
            TimerCore.switchItem(name)
        }
    }
}
