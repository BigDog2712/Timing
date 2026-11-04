package com.tickbar.droid.core

import java.util.Calendar

/**
 * 「天 / 周」的边界计算，全部走本地时区 + `Calendar`（会自动处理夏令时和月末）。
 *
 * 口径与桌面端周视图对齐：**周一为一周之首**，周日末尾。
 * 这里只做纯计算，不碰数据库，方便单测。
 */
object Days {

    private fun at(ts: Long): Calendar = Calendar.getInstance().apply {
        timeInMillis = ts
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }

    /** 当天 00:00:00.000 的时间戳。 */
    fun startOfDay(ts: Long): Long = at(ts).timeInMillis

    /** 从某天 00:00 偏移 n 天（n 可为负）。用 Calendar 加，跨月 / 夏令时都正确。 */
    fun addDays(dayStart: Long, n: Int): Long =
        at(dayStart).apply { add(Calendar.DAY_OF_MONTH, n) }.timeInMillis

    /** 所在周的周一 00:00。 */
    fun startOfWeek(ts: Long): Long {
        val c = at(ts)
        // Calendar.MONDAY = 2 … SUNDAY = 1，换算成「距周一几天」
        val back = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7
        return addDays(c.timeInMillis, -back)
    }

    /** 某周（按 anchor 所在周）的 7 个「天起点」，周一到周日。 */
    fun week(anchor: Long): List<Long> {
        val mon = startOfWeek(anchor)
        return (0..6).map { addDays(mon, it) }
    }

    /** 周几的短标签：「一」「二」…「日」。 */
    fun weekdayLabel(dayStart: Long): String =
        WEEKDAYS[at(dayStart).get(Calendar.DAY_OF_WEEK) - 1]

    /** `11/3` 这样的月日，用于周视图副标题。 */
    fun monthDay(dayStart: Long): String {
        val c = at(dayStart)
        return "${c.get(Calendar.MONTH) + 1}/${c.get(Calendar.DAY_OF_MONTH)}"
    }

    /** 两个时间戳是否同一天。 */
    fun sameDay(a: Long, b: Long): Boolean = startOfDay(a) == startOfDay(b)

    private val WEEKDAYS = listOf("日", "一", "二", "三", "四", "五", "六")
}
