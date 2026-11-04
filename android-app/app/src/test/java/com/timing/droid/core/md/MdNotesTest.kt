package com.timing.droid.core.md

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 便利贴表格的渲染 / 解析。
 *
 * 期望值全部照抄桌面端 `services/md_sync/format/notes.rs` 的测试用例：两端写出的
 * 字节不一样，Obsidian 里就会来回震荡。
 */
class MdNotesTest {

    private fun row(
        content: String,
        item: String? = null,
        syncId: String = "",
        updatedAt: Long = 0L,
    ) = MdNotes.Row(syncId, item, content, updatedAt)

    @Test
    fun `渲染带竖线与换行的内容`() {
        val body = MdNotes.render(
            listOf(row("第一行 | 带竖线\n第二行", item = "生活", syncId = "7")),
        )
        assertTrue(body.startsWith("| 更新时间 | 事项 | 内容 |\n|---|---|---|"))
        assertTrue(body.contains("第一行 \\| 带竖线<br>第二行"))
        assertTrue(body.contains("<!-- tb-note:7 -->"))
    }

    @Test
    fun `没有号的行走不带 marker`() {
        val body = MdNotes.render(listOf(row("买牛奶")))
        assertTrue(body.contains("| 买牛奶 |"))
        assertFalse(body.contains("tb-note"))
    }

    @Test
    fun `事项为空时写破折号`() {
        val body = MdNotes.render(listOf(row("随手记")))
        assertTrue(body.contains("| — | 随手记 |"))
    }

    @Test
    fun `没有内容时渲染成空串`() {
        assertEquals("", MdNotes.render(listOf(row("   "))))
        assertEquals("", MdNotes.render(emptyList()))
    }

    @Test
    fun `往返保住竖线换行与号`() {
        val body = MdNotes.render(
            listOf(row("甲 | 乙\n丙", item = "写周报", syncId = "42", updatedAt = 1_700_000_000_000L)),
        )
        val parsed = MdNotes.parse(body)
        assertEquals(1, parsed.size)
        assertEquals("甲 | 乙\n丙", parsed[0].content)
        assertEquals("写周报", parsed[0].item)
        assertEquals("42", parsed[0].syncId)
        assertEquals(1_700_000_000_000L, parsed[0].updatedAt)
    }

    @Test
    fun `跳过表头分隔行空行缺列与空内容`() {
        val body = """
            | 更新时间 | 事项 | 内容 |
            |---|---|---|
            | 2026-10-20 09:30:00 | 生活 | 买牛奶 |

            | 只有两列 | 缺列 |
            | 2026-10-20 10:00:00 | 生活 |  |
        """.trimIndent()
        val parsed = MdNotes.parse(body)
        /* 只有「买牛奶」那行同时满足：三列、有内容、不是表头/分隔行 */
        assertEquals(1, parsed.size)
        assertEquals("买牛奶", parsed[0].content)
    }

    @Test
    fun `号认不出来时当普通内容`() {
        val body = "| 2026-10-20 09:30:00 | — | 内容 <!-- tb-note:abc --> |"
        val parsed = MdNotes.parse(body)
        assertEquals(1, parsed.size)
        assertEquals("", parsed[0].syncId)
        assertTrue(parsed[0].content.contains("tb-note:abc"))
    }

    @Test
    fun `表格行没闭合说明读到半截`() {
        assertTrue(MdNotes.looksTruncated("| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| 2026-10-20 | 生活 | 买牛"))
        assertFalse(MdNotes.looksTruncated("| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| 2026-10-20 | 生活 | 买牛奶 |"))
        assertTrue(MdNotes.looksTruncated("正常文本\uFFFD截断"))
    }
}
