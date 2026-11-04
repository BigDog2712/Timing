package com.tickbar.droid.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * 状态机的纯逻辑测试：不碰 Android 运行时，用假时钟推进。
 * 这是「没有真机也能验的那一半」——UI 与悬浮窗仍需装机看。
 */
class TimerCoreTest {

    private var now = 1_000L

    @Before
    fun setUp() {
        TimerCore.wipe()
        TimerCore.clock = { now }
        TimerCore.minRecordMs = 1_000L
    }

    @Test
    fun `正计时 暂停期间不累计`() {
        TimerCore.start("写代码")
        now += 10_000
        TimerCore.pause()
        assertEquals(10_000L, TimerCore.current().elapsed)

        now += 5_000                      // 暂停中，时钟走但不算钱
        assertEquals(10_000L, TimerCore.current().elapsed)

        TimerCore.resume()
        now += 2_000
        assertEquals(12_000L, TimerCore.current().elapsed)

        TimerCore.finish()
        assertEquals(1, TimerCore.sessions.size)
        assertEquals(12_000L, TimerCore.sessions[0].ms)
        assertEquals(TimerCore.Phase.IDLE, TimerCore.current().phase)
    }

    @Test
    fun `倒计时跑满自动结束并记为完成`() {
        TimerCore.startCountdown(1)       // 60s
        now += 61_000

        val s = TimerCore.current()
        assertEquals(TimerCore.Phase.DONE, s.phase)
        assertEquals(0L, s.remain)
        assertEquals(1, TimerCore.sessions.size)
        assertEquals(60_000L, TimerCore.sessions[0].ms)   // 只记到目标时长，不多记
        assertTrue(TimerCore.sessions[0].completed)
    }

    @Test
    fun `中途结束不算完成`() {
        TimerCore.startCountdown(10)
        now += 5_000
        TimerCore.finish()

        assertEquals(1, TimerCore.sessions.size)
        assertEquals(5_000L, TimerCore.sessions[0].ms)
        assertTrue(!TimerCore.sessions[0].completed)
    }

    @Test
    fun `低于最短时长不记账`() {
        TimerCore.minRecordMs = 5_000L
        TimerCore.start()
        now += 3_000
        TimerCore.finish()

        assertTrue(TimerCore.sessions.isEmpty())
        assertTrue(TimerCore.lastSession == null)
    }

    @Test
    fun `撤销移除最后一条`() {
        TimerCore.start()
        now += 2_000
        TimerCore.finish()
        assertEquals(1, TimerCore.sessions.size)

        TimerCore.undoLast()
        assertTrue(TimerCore.sessions.isEmpty())
        assertTrue(TimerCore.lastSession == null)
    }

    @Test
    fun `结束之后可以立刻再开一轮`() {
        TimerCore.start("A")
        now += 2_000
        TimerCore.finish()

        TimerCore.start("B")
        now += 3_000
        assertEquals(3_000L, TimerCore.current().elapsed)
        assertEquals("B", TimerCore.current().item)
        TimerCore.finish()
        assertEquals(2, TimerCore.sessions.size)
        assertEquals("B", TimerCore.sessions[0].item)   // 新的在前
    }

    @Test
    fun `剩余不足一分钟触发紧迫态`() {
        TimerCore.startCountdown(2)       // 120s
        now += 61_000                     // 剩 59s
        assertTrue(TimerCore.current().urgent)

        now += 60_000
        assertEquals(TimerCore.Phase.DONE, TimerCore.current().phase)
        assertTrue(!TimerCore.current().urgent)
    }

    // ------------------------------------------------------ 悬浮圆点几何

    @Test
    fun `圆点弧 正计时按秒环循环`() {
        val s = TimerCore.Snapshot(
            phase = TimerCore.Phase.RUNNING, mode = TimerCore.Mode.STOPWATCH, elapsed = 42_500L,
        )
        assertEquals(0.70833f, TimerCore.arcFraction(s), 1e-4f)
    }

    @Test
    fun `圆点弧 倒计时按剩余比例回落`() {
        val s = TimerCore.Snapshot(
            phase = TimerCore.Phase.RUNNING, mode = TimerCore.Mode.COUNTDOWN,
            elapsed = 90_000L, target = 300_000L,
        )
        assertEquals(0.7f, TimerCore.arcFraction(s), 1e-4f)
    }

    @Test
    fun `圆点时针 正计时按分钟走 60 分钟一圈`() {
        // 阶梯式：整分钟才跳一格（3 分 42 秒 → 第 3 格），不随秒微动
        val s = TimerCore.Snapshot(
            phase = TimerCore.Phase.RUNNING, mode = TimerCore.Mode.STOPWATCH, elapsed = 222_000L,
        )
        assertEquals(3f / 60f, TimerCore.needleFraction(s), 1e-4f)

        // 61 分钟绕回第 2 圈的第 1 分钟
        val over = s.copy(elapsed = 61L * 60_000L)
        assertEquals(1f / 60f, TimerCore.needleFraction(over), 1e-4f)
    }

    @Test
    fun `圆点时针 倒计时指在剩余位置`() {
        val s = TimerCore.Snapshot(
            phase = TimerCore.Phase.RUNNING, mode = TimerCore.Mode.COUNTDOWN,
            elapsed = 90_000L, target = 300_000L,
        )
        assertEquals(0.7f, TimerCore.needleFraction(s), 1e-4f)
    }

    @Test
    fun `圆点几何 待机时弧和针都归零`() {
        val s = TimerCore.Snapshot(phase = TimerCore.Phase.IDLE, elapsed = 999_999L)
        assertEquals(0f, TimerCore.arcFraction(s), 1e-4f)
        assertEquals(0f, TimerCore.needleFraction(s), 1e-4f)
    }
}
