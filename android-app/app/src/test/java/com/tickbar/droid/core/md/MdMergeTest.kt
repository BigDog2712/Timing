package com.tickbar.droid.core.md

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 三方合并的语义。这里每一条都对应一个真实会发生的情形，
 * 尤其是「两端同一天各记了几段」——那是最容易悄悄丢数据的地方。
 */
class MdMergeTest {

    private fun seg(start: Long, end: Long) = MdMerge.Seg(end, (end - start) / 1000)

    private fun mapOf(vararg rows: Triple<String, Long, Long>): Map<MdMerge.Key, MdMerge.Seg> {
        val out = LinkedHashMap<MdMerge.Key, MdMerge.Seg>()
        for ((item, start, end) in rows) out[MdMerge.Key(item, start)] = seg(start, end)
        return out
    }

    private fun key(item: String, start: Long) = MdMerge.Key(item, start)

    @Test
    fun `两端各记一条都会留下`() {
        val merged = MdMerge.merge(
            base = emptyMap(),
            local = mapOf(Triple("写作", 100L, 200L)),
            remote = mapOf(Triple("读书", 300L, 400L)),
        )

        assertEquals(2, merged.size)
        assertTrue(merged.containsKey(key("写作", 100)))
        assertTrue(merged.containsKey(key("读书", 300)))
    }

    @Test
    fun `手机新增的记录在桌面写过之后仍然保留`() {
        /* 桌面文件里已有 a、b、c；手机自己记了 d；基线是 a、b */
        val merged = MdMerge.merge(
            base = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L)),
            local = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L), Triple("d", 9L, 10L)),
            remote = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L), Triple("c", 5L, 6L)),
        )

        assertEquals(4, merged.size)
        assertTrue(merged.containsKey(key("d", 9)))
        assertTrue(merged.containsKey(key("c", 5)))
    }

    @Test
    fun `对面删掉的记录会传导过来`() {
        val merged = MdMerge.merge(
            base = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L)),
            local = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L)),
            remote = mapOf(Triple("a", 1L, 2L)),
        )

        assertEquals(setOf(key("a", 1)), merged.keys)
    }

    @Test
    fun `本机删掉的记录不会被文件复活`() {
        val merged = MdMerge.merge(
            base = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L)),
            local = mapOf(Triple("a", 1L, 2L)),
            remote = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L)),
        )

        assertEquals(setOf(key("a", 1)), merged.keys)
    }

    @Test
    fun `两端各自删掉不同记录时两条都消失`() {
        val merged = MdMerge.merge(
            base = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L)),
            local = mapOf(Triple("b", 3L, 4L)),
            remote = mapOf(Triple("a", 1L, 2L)),
        )

        assertTrue(merged.isEmpty())
    }

    @Test
    fun `同一条两端都改动时冲突以文件为准`() {
        val merged = MdMerge.merge(
            base = mapOf(Triple("a", 1L, 2L)),
            local = mapOf(Triple("a", 1L, 20L)),
            remote = mapOf(Triple("a", 1L, 30L)),
        )

        assertEquals(30L, merged[key("a", 1)]?.endMs)
    }

    @Test
    fun `同样的输入再合并一次结果不变`() {
        val base = mapOf(Triple("a", 1L, 2L), Triple("b", 3L, 4L))
        val local = mapOf(Triple("a", 1L, 2L), Triple("d", 9L, 10L))
        val remote = mapOf(Triple("a", 1L, 2L), Triple("c", 5L, 6L))

        val once = MdMerge.merge(base, local, remote)
        /* 第二轮：两端都已经是合并结果，基线也换成了它 */
        val twice = MdMerge.merge(once, once, once)

        assertEquals(once, twice)
    }

    @Test
    fun `进行中的段不参与合并`() {
        val entries = listOf(
            MdTimers.Entry(
                "写作",
                mutableListOf(
                    MdTimers.Interval(100L, 200L),
                    MdTimers.Interval(300L, 400L, ongoing = true),
                ),
            ),
        )

        val flat = MdMerge.flatten(entries)

        assertEquals(1, flat.size)
        assertEquals(200L, flat[key("写作", 100)]?.endMs)
    }

    @Test
    fun `按事项分组并保持时间顺序`() {
        val merged = mapOf(
            key("写作", 500L) to seg(500L, 600L),
            key("读书", 100L) to seg(100L, 200L),
            key("写作", 300L) to seg(300L, 400L),
        )

        val entries = MdMerge.toEntries(merged)

        assertEquals(2, entries.size)
        assertEquals("读书", entries[0].item)
        assertEquals("写作", entries[1].item)
        assertEquals(2, entries[1].intervals.size)
        assertEquals(300L, entries[1].intervals[0].startMs)
        assertEquals(500L, entries[1].intervals[1].startMs)
    }

    @Test
    fun `变化的键与消失的键能正确算出来`() {
        val before = mapOf(key("a", 1L) to seg(1L, 2L), key("b", 3L) to seg(3L, 4L))
        val after = mapOf(key("a", 1L) to seg(1L, 2L), key("c", 5L) to seg(5L, 6L))

        assertEquals(setOf(key("c", 5)), MdMerge.addedKeys(before, after))
        assertEquals(setOf(key("b", 3)), MdMerge.removedKeys(before, after))
    }
}
