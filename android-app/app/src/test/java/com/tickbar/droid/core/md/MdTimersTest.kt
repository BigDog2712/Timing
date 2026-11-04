package com.tickbar.droid.core.md

import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Planner 格式的契约。**往返幂等**是这里最重要的用例：
 * 只要 `render → parse → render` 恒等，两端就不会因为「形状不同」互相覆盖。
 */
class MdTimersTest {

    private fun at(y: Int, m: Int, d: Int, h: Int, mi: Int, s: Int): Long =
        LocalDateTime.of(y, m, d, h, mi, s)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()

    @Test
    fun `渲染成 Planner 能读的形状`() {
        val entry = MdTimers.Entry(
            "timing优化",
            mutableListOf(MdTimers.Interval(at(2026, 10, 14, 0, 30, 51), at(2026, 10, 14, 1, 7, 41), durationSec = 2210)),
        )

        val expected = """
            - [ ] timing优化
              ```yaml
              planner:
                log:
                  - start: 2026-10-14 00:30:51
                    end: 2026-10-14 01:07:41
                    duration: 36m50s
              ```
        """.trimIndent()

        assertEquals(expected, MdTimers.render(listOf(entry)))
    }

    @Test
    fun `往返渲染完全一致`() {
        val entries = listOf(
            MdTimers.Entry(
                "写作",
                mutableListOf(
                    MdTimers.Interval(at(2026, 11, 3, 9, 0, 0), at(2026, 11, 3, 10, 12, 30), durationSec = 4350),
                    MdTimers.Interval(at(2026, 11, 3, 14, 0, 0), at(2026, 11, 3, 14, 5, 0), durationSec = 300),
                ),
            ),
            MdTimers.Entry(
                "读书",
                mutableListOf(MdTimers.Interval(at(2026, 11, 3, 11, 0, 0), at(2026, 11, 3, 11, 45, 0))),
            ),
        )

        val once = MdTimers.render(entries)
        val twice = MdTimers.render(MdTimers.parse(once))
        assertEquals(once, twice)
    }

    @Test
    fun `仍在计时的段被识别且往返保留`() {
        val body = """
            - [ ] 写作
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 09:00:00
                    end: 2026-11-03 09:30:00
                    ongoing: true
              ```
        """.trimIndent()

        val parsed = MdTimers.parse(body)
        assertEquals(1, parsed.size)
        assertTrue(parsed[0].intervals[0].ongoing)
        /* 原样写回，「正在计时」这个标记不能在本机凭空消失 */
        assertEquals(body, MdTimers.render(parsed))
    }

    @Test
    fun `区块里的注释与其它文字被忽略`() {
        val body = """
            今天状态不错，先写两段。

            - [ ] 写作
              说明：这段是手动补的
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 09:00:00
                    end: 2026-11-03 09:30:00
              ```

            - [ ] 读书
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 10:00:00
                    end: 2026-11-03 10:20:00
              ```
        """.trimIndent()

        val parsed = MdTimers.parse(body)
        assertEquals(2, parsed.size)
        assertEquals("写作", parsed[0].item)
        assertEquals("读书", parsed[1].item)
        assertEquals(1, parsed[0].intervals.size)
    }

    @Test
    fun `同名事项的多段合并到一组`() {
        val body = """
            - [ ] 写作
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 09:00:00
                    end: 2026-11-03 09:30:00
              ```

            - [ ] 写作
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 14:00:00
                    end: 2026-11-03 14:10:00
              ```
        """.trimIndent()

        val parsed = MdTimers.parse(body)
        assertEquals(1, parsed.size)
        assertEquals(2, parsed[0].intervals.size)
        /* 段内按开始时间升序，渲染时才稳定 */
        assertTrue(parsed[0].intervals[0].startMs < parsed[0].intervals[1].startMs)
    }

    @Test
    fun `end 不晚于 start 的段被丢弃`() {
        val body = """
            - [ ] 写作
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 09:00:00
                    end: 2026-11-03 09:00:00
                  - start: 2026-11-03 10:00:00
              ```
        """.trimIndent()
        assertEquals(0, MdTimers.parse(body).size)
    }

    @Test
    fun `没有段的事项不会渲染出空清单项`() {
        assertEquals("", MdTimers.render(listOf(MdTimers.Entry("空事项"))))
        assertEquals("", MdTimers.render(emptyList()))
    }

    @Test
    fun `时长渲染与解析互逆`() {
        assertEquals("45s", MdTimers.formatDuration(45))
        /* 只有秒时按原样写「6s」而非「06s」—— 与桌面 format_duration 一致 */
        assertEquals("6s", MdTimers.formatDuration(6))
        assertEquals("05m", MdTimers.formatDuration(300))
        assertEquals("46m06s", MdTimers.formatDuration(2766))
        assertEquals("1h34m20s", MdTimers.formatDuration(5660))

        for (sec in listOf(0L, 6L, 45L, 300L, 2766L, 5660L, 73_000L)) {
            assertEquals(sec, MdTimers.parseDuration(MdTimers.formatDuration(sec)))
        }
        assertEquals(90L, MdTimers.parseDuration("90"))
        assertEquals(3600L, MdTimers.parseDuration("1h"))
        assertEquals(null, MdTimers.parseDuration("半小时"))
    }

    @Test
    fun `时间解析宽松但不会把胡话当时间`() {
        assertEquals(at(2026, 11, 3, 9, 0, 0), MdTimers.parseTs("2026-11-03 09:00:00"))
        assertEquals(at(2026, 11, 3, 9, 0, 0), MdTimers.parseTs("2026-11-03 09:00"))
        assertEquals(at(2026, 11, 3, 9, 0, 0), MdTimers.parseTs("2026/11/03 09:00:00"))
        assertEquals(null, MdTimers.parseTs("昨天下午"))
        assertEquals(null, MdTimers.parseTs(""))
    }

    @Test
    fun `清掉派生时长后事实不变`() {
        val entries = listOf(
            MdTimers.Entry(
                "写作",
                mutableListOf(MdTimers.Interval(at(2026, 11, 3, 9, 0, 0), at(2026, 11, 3, 9, 30, 0), durationSec = 1800)),
            ),
        )
        val stripped = MdTimers.stripDurations(entries)
        assertEquals(null, stripped[0].intervals[0].durationSec)
        assertEquals(at(2026, 11, 3, 9, 0, 0), stripped[0].intervals[0].startMs)
    }
}
