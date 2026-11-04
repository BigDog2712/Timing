package com.timing.droid.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 便利贴编辑器纯函数的黄金用例。
 *
 * 这些行为**必须与桌面端 `src/lib/noteText.ts` 一致**：同一张便利贴在两端编辑，
 * 敲同样的键要得到同样的文本。桌面那边改了规则，这里跟着改。
 */
class NoteTextTest {

    @Test
    fun `行首破折号加空格变成圆点`() {
        /* 调用方会先把刚敲进去的那个空格撤掉，所以传进来的是 "-"、光标落在 1 */
        val plain = NoteText.bulletizeOnSpace("-", 1, 1)
        assertEquals("• ", plain?.text)
        assertEquals(2, plain?.start)

        /* 带空格时不该再匹配（否则圆点后面会多一个空格） */
        assertNull(NoteText.bulletizeOnSpace("- ", 2, 2))
    }

    @Test
    fun `缩进后的破折号也认`() {
        val edit = NoteText.bulletizeOnSpace("  -", 3, 3)
        assertEquals("  • ", edit?.text)
        assertEquals(4, edit?.start)
    }

    @Test
    fun `行中间的破折号不动`() {
        assertNull(NoteText.bulletizeOnSpace("abc-", 4, 4))
        assertNull(NoteText.bulletizeOnSpace("- a", 3, 3))
    }

    @Test
    fun `圆点行回车续一个同缩进的圆点`() {
        val edit = NoteText.continueListOnEnter("• 排期表", 5, 5)
        assertEquals("• 排期表\n• ", edit?.text)
        /* 新文本末尾 = 5（原行）+ 1（换行）+ 2（圆点）= 8 */
        assertEquals(8, edit?.start)
    }

    @Test
    fun `缩进的圆点行续行保留缩进`() {
        val edit = NoteText.continueListOnEnter("  • 子项", 6, 6)
        assertEquals("  • 子项\n  • ", edit?.text)
    }

    @Test
    fun `空圆点行回车退出列表`() {
        val edit = NoteText.continueListOnEnter("• ", 2, 2)
        assertEquals("\n", edit?.text)
        assertEquals(1, edit?.start)
    }

    @Test
    fun `非圆点行回车交给键盘`() {
        assertNull(NoteText.continueListOnEnter("普通文字", 4, 4))
    }

    @Test
    fun `加一级缩进作用到选区覆盖的每一行`() {
        val text = "第一行\n第二行"
        val edit = NoteText.indentSelection(text, 0, text.length, outdent = false)
        assertEquals("  第一行\n  第二行", edit.text)
        assertEquals(2, edit.start)
    }

    @Test
    fun `反缩进最多去掉已有的缩进`() {
        val text = "  甲\n乙"
        val edit = NoteText.indentSelection(text, 0, text.length, outdent = true)
        assertEquals("甲\n乙", edit.text)
    }

    @Test
    fun `清单标题取首行并截断`() {
        assertEquals("明天开会", NoteText.titleOf("明天开会\n细节"))
        assertEquals("未命名便利贴", NoteText.titleOf("   "))
        assertEquals("123456789012345678…", NoteText.titleOf("1234567890123456789"))
    }
}
