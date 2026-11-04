package com.tickbar.droid.core.md

import com.tickbar.droid.core.RepoNote
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 便利贴三方合并的判定（不碰数据库：`deleted` 用假函数注入）。
 *
 * 这些用例覆盖的是**最容易出事**的四种情形：远端新增、远端删除、本机更新胜出、
 * 本机删除不能被自己拉回来。写错任何一条，用户都会看到「删了又回来」或「改完消失」。
 */
class MdNotesPlanTest {

    private fun local(
        id: Long,
        content: String,
        item: String? = null,
        syncId: String = "",
        updatedAt: Long = 1_000L,
    ) = RepoNote.Note(
        id = id,
        itemId = null,
        itemName = item,
        content = content,
        syncId = syncId,
        createdAt = 900L,
        updatedAt = updatedAt,
    )

    private fun row(
        content: String,
        item: String? = null,
        syncId: String = "",
        updatedAt: Long = 1_000L,
    ) = MdNotes.Row(syncId, item, content, updatedAt)

    @Test
    fun `远端新增的便利贴收进库并写回文件`() {
        val plan = MdNotesSync.plan(
            base = emptyList(),
            local = emptyList(),
            remote = listOf(row("买牛奶", item = "生活", syncId = "5")),
            deleted = { false },
        )
        assertEquals(1, plan.insert.size)
        assertEquals("买牛奶", plan.insert[0].content)
        assertEquals(1, plan.changed)
    }

    @Test
    fun `本机新建的写回文件`() {
        val plan = MdNotesSync.plan(
            base = emptyList(),
            local = listOf(local(1, "开会要带的东西")),
            remote = emptyList(),
            deleted = { false },
        )
        assertTrue(plan.insert.isEmpty())
        assertEquals(1, plan.rows.size)
        assertEquals("开会要带的东西", plan.rows[0].content)
    }

    @Test
    fun `远端改得更晚就以远端为准`() {
        val plan = MdNotesSync.plan(
            base = listOf(row("旧内容", syncId = "5", updatedAt = 1_000L)),
            local = listOf(local(1, "旧内容", syncId = "5", updatedAt = 1_000L)),
            remote = listOf(row("新内容", syncId = "5", updatedAt = 2_000L)),
            deleted = { false },
        )
        assertEquals(1, plan.update.size)
        assertEquals("新内容", plan.update[0].content)
        assertEquals(1, plan.changed)
    }

    @Test
    fun `本机改得更晚就保留本机并写回`() {
        val plan = MdNotesSync.plan(
            base = listOf(row("旧内容", syncId = "5", updatedAt = 1_000L)),
            local = listOf(local(1, "本机改过", syncId = "5", updatedAt = 3_000L)),
            remote = listOf(row("旧内容", syncId = "5", updatedAt = 1_000L)),
            deleted = { false },
        )
        assertTrue(plan.update.isEmpty())
        assertEquals("本机改过", plan.rows[0].content)
    }

    @Test
    fun `远端删掉且本机没再改就软删本机`() {
        val plan = MdNotesSync.plan(
            base = listOf(row("旧内容", syncId = "5", updatedAt = 1_000L)),
            local = listOf(local(1, "旧内容", syncId = "5", updatedAt = 1_000L)),
            remote = emptyList(),
            deleted = { false },
        )
        assertEquals(listOf(1L), plan.remove)
        assertEquals(1, plan.changed)
    }

    @Test
    fun `远端删了但本机刚改过就复活`() {
        val plan = MdNotesSync.plan(
            base = listOf(row("旧内容", syncId = "5", updatedAt = 1_000L)),
            local = listOf(local(1, "刚补的一行", syncId = "5", updatedAt = 5_000L)),
            remote = emptyList(),
            deleted = { false },
        )
        assertTrue(plan.remove.isEmpty())
        assertEquals("刚补的一行", plan.rows[0].content)
    }

    @Test
    fun `本机删掉的不会被文件里的旧行拉回来`() {
        val plan = MdNotesSync.plan(
            base = listOf(row("删掉的那张", syncId = "5", updatedAt = 1_000L)),
            local = emptyList(),
            remote = listOf(row("删掉的那张", syncId = "5", updatedAt = 1_000L)),
            deleted = { it == "5" },
        )
        assertTrue(plan.insert.isEmpty())
        assertTrue(plan.rows.isEmpty())
    }

    @Test
    fun `首次往返给本机无号的那张绑上桌面发的号`() {
        val plan = MdNotesSync.plan(
            base = emptyList(),
            local = listOf(local(7, "买咖啡豆")),
            remote = listOf(row("买咖啡豆", syncId = "12")),
            deleted = { false },
        )
        assertEquals(listOf(7L to "12"), plan.bind)
        assertEquals("12", plan.rows[0].syncId)
    }

    @Test
    fun `内容相同但事项不同的不会被认成同一张`() {
        val plan = MdNotesSync.plan(
            base = emptyList(),
            local = listOf(local(7, "周报", item = "工作")),
            remote = listOf(row("周报", item = "生活", syncId = "12")),
            deleted = { false },
        )
        assertEquals(1, plan.insert.size)
        assertTrue(plan.bind.isEmpty())
    }
}
