package com.tickbar.droid.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** 时间显示口径，与桌面 `src/lib/format.ts` 对齐。 */
class TimeFmtTest {

    @Test
    fun `不足一小时只显示分秒`() {
        assertEquals("00:00", TimeFmt.clock(0))
        assertEquals("00:59", TimeFmt.clock(59_900))
        assertEquals("59:59", TimeFmt.clock(3_599_000))
    }

    @Test
    fun `满一小时补上小时段`() {
        assertEquals("01:00:00", TimeFmt.clock(3_600_000))
        assertEquals("02:03:04", TimeFmt.clock(7_384_000))
    }

    @Test
    fun `倒计时向上取整 不会提前显示 00 00`() {
        assertEquals("00:01", TimeFmt.clock(400, ceil = true))
        assertEquals("01:00", TimeFmt.clock(59_100, ceil = true))
        assertEquals("00:00", TimeFmt.clock(0, ceil = true))
    }

    @Test
    fun `汇总结论`() {
        assertEquals("0s", TimeFmt.human(0))
        assertEquals("45s", TimeFmt.human(45_000))
        assertEquals("1m", TimeFmt.human(90_000))
        assertEquals("1h 5m", TimeFmt.human(3_930_000))
        assertEquals("2h", TimeFmt.human(7_200_000))
    }
}
