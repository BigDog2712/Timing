package com.timing.droid.ui

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.timing.droid.core.Days
import com.timing.droid.core.Repo
import com.timing.droid.core.TimeFmt
import com.timing.droid.core.TimerCore
import com.timing.droid.core.Tk

/**
 * 二级页「记录」：今天 / 本周两个视图。
 *
 * 口径与桌面一致——今天看「分布 + 明细」，本周看「七天柱 + 各事项占比」。
 * 今天的明细读 [TimerCore] 的内存镜像（刚结束那一条立刻可见），
 * 本周的数据直接查库（内存里只有今天，跨不了周）。
 */
class RecordsPage(private val a: Activity) : Page {

    private var weekly = false

    private lateinit var segDay: TextView
    private lateinit var segWeek: TextView

    private val dayTotal = Ui.text(a, "", 26f, Tk.INK, bold = true)
    private val daySub = Ui.text(a, "", 13f, Tk.INK_DIM)
    private val dayBars = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
    private val dayItems = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val dayList = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val dayBox = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }

    private val weekTotal = Ui.text(a, "", 26f, Tk.INK, bold = true)
    private val weekSub = Ui.text(a, "", 13f, Tk.INK_DIM)
    private val weekBars = WeekBars(a)
    private val weekItems = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val weekBox = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }

    private fun d(v: Int) = Tk.dp(a, v)

    override val view: View = build()

    private fun build(): View {
        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(18), d(10), d(18), d(24))
        }

        val head = Ui.row(a)
        head.addView(Ui.text(a, "记录", 22f, Tk.INK, bold = true), LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        val segs = buildSeg()
        head.addView(segs)
        col.addView(head)

        buildDay()
        buildWeek()
        col.addView(dayBox, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))
        col.addView(weekBox, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

        return ScrollView(a).apply {
            addView(
                col,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
    }

    // ------------------------------------------------------------ 分段控件

    private fun buildSeg(): View {
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Ui.round(a, Tk.FIELD, 10)
            setPadding(d(3), d(3), d(3), d(3))
        }
        val labels = listOf("今天", "本周")
        labels.forEachIndexed { i, s ->
            val t = Ui.text(a, s, 13f, Tk.INK_DIM).apply {
                gravity = Gravity.CENTER
                setPadding(d(12), d(6), d(12), d(6))
                isClickable = true
                setOnClickListener {
                    weekly = i == 1
                    styleSeg()
                    render()
                }
            }
            box.addView(t, LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP))
        }
        segDay = box.getChildAt(0) as TextView
        segWeek = box.getChildAt(1) as TextView
        return box
    }

    private fun styleSeg() {
        listOf(segDay to !weekly, segWeek to weekly).forEach { (t, on) ->
            t.setTextColor(if (on) Tk.INK else Tk.INK_DIM)
            t.background = if (on) Ui.round(a, Tk.CARD, 8, Tk.LINE_2, 1) else null
        }
    }

    // ------------------------------------------------------------ 两个视图

    private fun buildDay() {
        val card = Ui.card(a)
        card.addView(Ui.label(a, "今日总计"))
        card.addView(dayTotal)
        card.addView(daySub)
        dayBox.addView(card, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(12) })

        dayBox.addView(Ui.label(a, "按事项"))
        dayBars.setPadding(0, d(4), 0, d(10))
        dayBox.addView(dayBars, LinearLayout.LayoutParams(Ui.MATCH, d(6)))
        dayBox.addView(dayItems, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))
        dayBox.addView(dayList, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))
    }

    private fun buildWeek() {
        val card = Ui.card(a)
        card.addView(Ui.label(a, "本周总计"))
        card.addView(weekTotal)
        card.addView(weekSub)
        weekBars.setPadding(0, d(6), 0, 0)
        card.addView(weekBars, LinearLayout.LayoutParams(Ui.MATCH, d(132)))
        weekBox.addView(card, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(12) })

        weekBox.addView(Ui.label(a, "按事项"))
        weekBox.addView(weekItems, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

        weekBox.addView(
            Ui.text(a, "本周数据来自本地库；跨设备同步还没接。", 11f, Tk.INK_DIM).apply {
                setPadding(d(2), d(12), 0, 0)
            },
        )
    }

    // ------------------------------------------------------------ 渲染

    override fun onShow() {
        styleSeg()
        render()
    }

    private fun render() {
        if (weekly) renderWeek() else renderDay()
        dayBox.visibility = if (weekly) View.GONE else View.VISIBLE
        weekBox.visibility = if (weekly) View.VISIBLE else View.GONE
    }

    private fun renderDay() {
        val sessions = TimerCore.sessions
        val sum = TimerCore.todayTotalMs()
        dayTotal.text = TimeFmt.human(sum)
        daySub.text = if (sessions.isEmpty()) "今天还没有记录" else "${sessions.size} 条记录"

        dayBars.removeAllViews()
        val grouped = TimerCore.byItem()
        if (sum > 0L) {
            grouped.forEachIndexed { i, (_, ms) ->
                val seg = View(a).apply {
                    background = Ui.round(a, Tk.ACCENT, 3)
                    alpha = 1f - (i * 0.22f).coerceAtMost(0.7f)
                }
                dayBars.addView(
                    seg,
                    LinearLayout.LayoutParams(0, Ui.MATCH, ms.toFloat()).apply {
                        if (i > 0) leftMargin = d(2)
                    },
                )
            }
        }

        itemRows(dayItems, grouped, sum)
        renderDetail(sessions)
    }

    private fun renderDetail(sessions: List<TimerCore.Session>) {
        dayList.removeAllViews()
        if (sessions.isEmpty()) {
            dayList.addView(
                Ui.text(a, "跑一轮计时，这里就会出现记录（≥ ${TimerCore.minRecordMs / 1000}s）", 12f, Tk.INK_DIM).apply {
                    setPadding(d(2), d(16), 0, 0)
                },
            )
            return
        }

        dayList.addView(Ui.label(a, "明细"))
        sessions.forEach { s ->
            val row = Ui.row(a).apply {
                background = Ui.round(a, Tk.CARD, 12, Tk.LINE, 1)
                setPadding(d(12), d(12), d(12), d(12))
                isClickable = true
                setOnLongClickListener {
                    TimerCore.deleteSession(s)
                    render()
                    true
                }
            }
            val mark = View(a).apply {
                background = Ui.round(a, if (s.completed) Tk.OK else Tk.ACCENT, 5)
            }
            row.addView(mark, LinearLayout.LayoutParams(d(10), d(10)).apply { rightMargin = d(10) })
            row.addView(Ui.text(a, s.item, 15f), LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
            row.addView(
                Ui.text(a, TimeFmt.clockOfDay(s.endedAt), 12f, Tk.INK_DIM).apply {
                    gravity = Gravity.END
                    setPadding(0, 0, d(10), 0)
                },
            )
            row.addView(Ui.text(a, TimeFmt.human(s.ms), 14f, Tk.INK, bold = true))

            dayList.addView(row, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) })
        }
        dayList.addView(Ui.text(a, "长按一条可删除", 11f, Tk.INK_DIM).apply { setPadding(d(2), d(10), 0, 0) })
    }

    private fun renderWeek() {
        val now = System.currentTimeMillis()
        val days = Days.week(now)
        val totals = Repo.weekTotals(days)
        val sum = totals.sum()

        weekTotal.text = TimeFmt.human(sum)
        val active = totals.count { it > 0L }
        weekSub.text = if (sum == 0L) {
            "本周还没有记录"
        } else {
            "${Days.monthDay(days.first())} – ${Days.monthDay(days.last())} · $active 天有记录"
        }

        weekBars.values = totals
        weekBars.labels = days.map { Days.weekdayLabel(it) }
        weekBars.todayIndex = days.indexOfFirst { Days.sameDay(it, now) }

        val pairs = Repo.byItemBetween(days.first(), Days.addDays(days.last(), 1))
        itemRows(weekItems, pairs, sum)
    }

    // ------------------------------------------------------------ 共用：事项占比行

    /** 「名称 — 进度槽 — 时长」一行行铺开。深色底上靠槽的填充长度表达占比。 */
    private fun itemRows(container: LinearLayout, pairs: List<Pair<String, Long>>, sum: Long) {
        container.removeAllViews()
        if (pairs.isEmpty()) {
            container.addView(
                Ui.text(a, "暂无数据", 12f, Tk.INK_DIM).apply { setPadding(d(2), d(8), 0, d(8)) },
            )
            return
        }
        pairs.take(6).forEach { (name, ms) ->
            val row = Ui.row(a).apply { setPadding(0, d(7), 0, d(7)) }
            row.addView(Ui.text(a, name, 13f), LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
            row.addView(Ui.text(a, TimeFmt.human(ms), 13f, Tk.INK, bold = true))

            val wrap = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
            wrap.addView(row, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

            val track = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
            val frac = if (sum > 0L) (ms.toFloat() / sum) else 0f
            track.addView(
                View(a).apply { background = Ui.round(a, Tk.ACCENT, 2) },
                LinearLayout.LayoutParams(0, d(3), frac.coerceAtLeast(0.02f)),
            )
            track.addView(View(a), LinearLayout.LayoutParams(0, d(3), (1f - frac).coerceAtLeast(0f)))
            wrap.addView(track, LinearLayout.LayoutParams(Ui.MATCH, d(3)).apply { topMargin = d(5) })

            container.addView(wrap, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))
        }
    }
}
