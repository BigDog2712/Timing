package com.timing.droid.core.md

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 区块定位的契约。这些用例的意义不在「能跑」，而在于**锁住与桌面端的一致性**：
 * 任何一条改红了，说明安卓端会开始把用户的日记改成另一种形状。
 */
class MdSectionTest {

    private val doc = """
        # 2026-11-03

        早上写了点东西。

        #### 事项计时
        - [ ] 旧内容

        #### 便利贴
        | a | b |
        |---|---|
        | 1 | 2 |

        #### 日记
        用户手写的正文，绝不能被碰到。
    """.trimIndent()

    @Test
    fun `取出标题下的内容不含标题行`() {
        val body = MdSection.body(doc, "#### 事项计时")
        assertEquals("- [ ] 旧内容", body)
    }

    @Test
    fun `只替换目标区块其余内容原样保留`() {
        val updated = MdSection.replace(doc, "#### 事项计时", "- [ ] 新内容")

        assertEquals("- [ ] 新内容", MdSection.body(updated, "#### 事项计时"))
        /* 三处用户内容必须逐字还在 */
        assertEquals(
            true,
            updated.contains("早上写了点东西。"),
        )
        assertEquals(true, updated.contains("| 1 | 2 |"))
        assertEquals(true, updated.contains("用户手写的正文，绝不能被碰到。"))
        assertEquals(false, updated.contains("旧内容"))
    }

    @Test
    fun `区块内的更深标题不会被当成结束`() {
        val text = """
            #### 事项计时
            - [ ] A

            ##### 备注
            这条是区块内的子标题
            #### 便利贴
            x
        """.trimIndent()

        val body = MdSection.body(text, "#### 事项计时")
        assertEquals("- [ ] A\n\n##### 备注\n这条是区块内的子标题", body)

        /* 写区块时，区块内的一切（含更深的子标题）都属于这一块，会被整体替换 —— 与桌面一致 */
        val updated = MdSection.replace(text, "#### 事项计时", "- [ ] B")
        assertEquals("- [ ] B", MdSection.body(updated, "#### 事项计时"))
        assertEquals(true, updated.contains("#### 便利贴\nx"))
    }

    @Test
    fun `标题不存在时追加到文末`() {
        val updated = MdSection.replace("只有一句话", "#### 事项计时", "- [ ] A")
        assertEquals("只有一句话\n\n#### 事项计时\n- [ ] A\n", updated)
    }

    @Test
    fun `空文件追加不产生前导空行`() {
        val updated = MdSection.replace("", "#### 事项计时", "- [ ] A")
        assertEquals("#### 事项计时\n- [ ] A\n", updated)
    }

    @Test
    fun `写入空内容只清空区块保留标题`() {
        val updated = MdSection.replace(doc, "#### 事项计时", "")
        assertEquals("", MdSection.body(updated, "#### 事项计时"))
        assertEquals(true, updated.contains("#### 便利贴"))
    }

    @Test
    fun `找不到标题返回 null 而不是空串`() {
        assertNull(MdSection.body(doc, "#### 不存在的标题"))
    }

    @Test
    fun `井号后必须有空格才算标题`() {
        assertEquals(4, MdSection.headingLevel("#### 事项计时"))
        assertNull(MdSection.headingLevel("####事项计时"))
        assertEquals(1, MdSection.headingLevel("# 一级"))
        assertEquals(6, MdSection.headingLevel("###### 六级"))
        assertNull(MdSection.headingLevel("####### 七级"))
        assertEquals(4, MdSection.headingLevel("#### "))
    }

    @Test
    fun `七级井号不算标题也不会截断区块`() {
        val text = "#### 事项计时\n- [ ] A\n####### 这是正文\n- [x] B"
        val body = MdSection.body(text, "#### 事项计时")
        assertEquals("- [ ] A\n####### 这是正文\n- [x] B", body)
    }
}
