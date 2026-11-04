package com.timing.droid.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/** 天 / 周边界的纯计算测试（不碰数据库）。 */
class DaysTest {

    private fun cal(y: Int, m: Int, d: Int, h: Int = 0): Long =
        Calendar.getInstance().apply {
            clear()
            set(y, m - 1, d, h, 0, 0)
        }.timeInMillis

    private fun dow(ts: Long): Int =
        Calendar.getInstance().apply { timeInMillis = ts }.get(Calendar.DAY_OF_WEEK)

    @Test
    fun `周起点一定是周一`() {
        // 2026-11-04 是周三
        val mon = Days.startOfWeek(cal(2026, 11, 4, 15))
        assertEquals(Calendar.MONDAY, dow(mon))
        assertEquals(cal(2026, 11, 2), mon)   // 该周周一是 11/2
    }

    @Test
    fun `周日归到上一个周一 而不是下一个`() {
        val mon = Days.startOfWeek(cal(2026, 11, 8, 23))   // 11/8 周日
        assertEquals(cal(2026, 11, 2), mon)
    }

    @Test
    fun `一周正好七天且递增`() {
        val week = Days.week(cal(2026, 11, 4))
        assertEquals(7, week.size)
        for (i in 1 until week.size) {
            assertTrue(week[i] > week[i - 1])
        }
        assertEquals(Calendar.SUNDAY, dow(week.last()))
    }

    @Test
    fun `加天能跨月`() {
        assertEquals(cal(2026, 12, 1), Days.addDays(cal(2026, 11, 30), 1))
        assertEquals(cal(2026, 1, 1), Days.addDays(cal(2025, 12, 31), 1))
    }

    @Test
    fun `当天起点把时分秒抹平`() {
        val start = Days.startOfDay(cal(2026, 11, 4, 17) + 12_345L)
        assertEquals(cal(2026, 11, 4), start)
        assertTrue(Days.sameDay(start, start + 3_600_000L))
        assertTrue(!Days.sameDay(start, Days.addDays(start, 1)))
    }

    @Test
    fun `周几标签对齐`() {
        assertEquals("一", Days.weekdayLabel(cal(2026, 11, 2)))
        assertEquals("日", Days.weekdayLabel(cal(2026, 11, 8)))
    }
}
