package com.timing.droid.core

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Calendar

/**
 * 内核与落库接口之间的契约：记一条就写库、撤销要删库、跨零点要换天。
 * 用假 Store，不依赖 SQLite —— 真库的行为由装机验证。
 */
class StoreTest {

    private var mono = 1_000L
    private var wall = 0L

    private class Fake : TimerCore.Store {
        val rows = mutableListOf<TimerCore.Session>()
        val removed = mutableListOf<Long>()
        var loads = 0
        private var seq = 100L

        override fun loadDay(dayStart: Long): List<TimerCore.Session> {
            loads++
            return rows.filter { Days.sameDay(it.endedAt, dayStart) }
        }

        override fun save(s: TimerCore.Session): Long {
            val id = ++seq
            rows.add(s.copy(id = id))
            return id
        }

        override fun remove(id: Long) {
            removed.add(id)
            rows.removeAll { it.id == id }
        }
    }

    private val store = Fake()

    private fun dayAt(y: Int, m: Int, d: Int, h: Int): Long =
        Calendar.getInstance().apply {
            clear()
            set(y, m - 1, d, h, 0, 0)
        }.timeInMillis

    @Before
    fun setUp() {
        TimerCore.wipe()
        store.rows.clear()
        store.removed.clear()
        wall = dayAt(2026, 11, 3, 10)
        TimerCore.clock = { mono }
        TimerCore.clockMs = { wall }
        TimerCore.minRecordMs = 1_000L
        TimerCore.store = store
        TimerCore.reloadToday()
    }

    @After
    fun tearDown() = TimerCore.wipe()

    @Test
    fun `结束一条会写库并带上 id`() {
        TimerCore.start("写周报")
        mono += 5_000
        TimerCore.finish()

        assertEquals(1, store.rows.size)
        assertEquals("写周报", store.rows[0].item)
        assertEquals(5_000L, store.rows[0].ms)
        assertTrue(store.rows[0].id > 0L)
        // 内存里那条也要带上同一个 id，否则删不掉
        assertEquals(store.rows[0].id, TimerCore.sessions[0].id)
    }

    @Test
    fun `撤销要把库里那条也删掉`() {
        TimerCore.start()
        mono += 3_000
        TimerCore.finish()
        val id = TimerCore.sessions[0].id

        TimerCore.undoLast()
        assertEquals(listOf(id), store.removed)
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun `太短的不写库`() {
        TimerCore.minRecordMs = 10_000L
        TimerCore.start()
        mono += 2_000
        TimerCore.finish()

        assertTrue(store.rows.isEmpty())
        assertTrue(TimerCore.sessions.isEmpty())
    }

    @Test
    fun `跨零点自动换天 只装当天记录`() {
        TimerCore.start("昨晚")
        mono += 4_000
        TimerCore.finish()
        assertEquals(1, TimerCore.sessions.size)

        // 睡到第二天中午，中间隔了远超 60 秒（跨天检查的节流窗口）
        wall = dayAt(2026, 11, 4, 12)
        val s = TimerCore.current()

        assertTrue(TimerCore.sessions.isEmpty())   // 昨天的记录不在「今天」里
        assertTrue(s.phase == TimerCore.Phase.IDLE)
        assertTrue(store.rows.size == 1)           // 但库里还在
    }

    @Test
    fun `重新装载能把库里的今日记录读回内存`() {
        TimerCore.start("A")
        mono += 2_000
        TimerCore.finish()
        TimerCore.sessions.clear()          // 模拟进程重启后内存被清空

        TimerCore.reloadToday()
        assertEquals(1, TimerCore.sessions.size)
        assertEquals("A", TimerCore.sessions[0].item)
    }
}
