package com.tickbar.droid.core

import android.content.ContentValues

/**
 * 便利贴的落库层。
 *
 * 与 [Repo] 同一套线程约定：**主线程调用**（md 同步那一轮在后台线程，SQLiteOpenHelper
 * 本身串行化，读写仍然安全；这也是现有 `Repo.recordsForDay` 被同步线程调用的现状）。
 *
 * 软删除：`deleted_at` 打标记而不是 `DELETE`，因为 Markdown 同步要靠「行还在、只是删了」
 * 判断是用户删的，还是对面新增的。硬删会让下一轮同步把它当成远端新行又插回来。
 */
object RepoNote {

    /** 正文上限，与桌面 `NOTE_CONTENT_MAX_LEN` 同值。 */
    const val CONTENT_MAX_LEN = 4000

    data class Note(
        val id: Long,
        val itemId: Long?,
        /** 关联事项名；`item_id` 为空或指向已删事项时为 null */
        val itemName: String?,
        val content: String,
        /**
         * Markdown 表格里那行的号（`<!-- tb-note:N -->` 的 N）。空串 = 还没拿到号。
         *
         * 手机**从不自己发号**，只用桌面端发下来的号，原因见 `Db.NOTES` 的注释。
         */
        val syncId: String,
        val createdAt: Long,
        val updatedAt: Long,
    ) {
        /** 空的便利贴不进清单、不写进日记（桌面同一个口径）。 */
        val blank: Boolean get() = content.isBlank()
    }

    // ------------------------------------------------------------ 读

    /** 全部未删便利贴，最近改过在前（清单页直接用这个顺序）。 */
    fun list(): List<Note> {
        val h = Repo.helper ?: return emptyList()
        val out = ArrayList<Note>()
        h.readableDatabase.rawQuery(
            """
            SELECT n.id, n.item_id, i.name, n.content, n.sync_id, n.created_at, n.updated_at
              FROM notes n LEFT JOIN items i ON i.id = n.item_id
             WHERE n.deleted_at IS NULL
             ORDER BY n.updated_at DESC, n.id DESC
            """.trimIndent(),
            null,
        ).use { c ->
            while (c.moveToNext()) out.add(row(c))
        }
        return out
    }

    fun get(id: Long): Note? {
        if (id <= 0L) return null
        val h = Repo.helper ?: return null
        h.readableDatabase.rawQuery(
            """
            SELECT n.id, n.item_id, i.name, n.content, n.sync_id, n.created_at, n.updated_at
              FROM notes n LEFT JOIN items i ON i.id = n.item_id
             WHERE n.id = ? AND n.deleted_at IS NULL
            """.trimIndent(),
            arrayOf(id.toString()),
        ).use { c -> return if (c.moveToFirst()) row(c) else null }
    }

    /** 某事项名下的便利贴（最近改过在前）。 */
    fun listForItem(itemName: String): List<Note> =
        list().filter { it.itemName == itemName }

    /**
     * 当天「动过」的便利贴：当天创建或当天改过。
     *
     * 与桌面 `repo::notes_in_day` 同口径。只写当天相关的，是因为日记是「那一天」的记录
     * —— 否则昨天贴的便条会天天跟着出现在今天和以后每一天。
     */
    fun inDay(from: Long, to: Long): List<Note> {
        val h = Repo.helper ?: return emptyList()
        val out = ArrayList<Note>()
        h.readableDatabase.rawQuery(
            """
            SELECT n.id, n.item_id, i.name, n.content, n.sync_id, n.created_at, n.updated_at
              FROM notes n LEFT JOIN items i ON i.id = n.item_id
             WHERE n.deleted_at IS NULL
               AND ((n.created_at >= ? AND n.created_at < ?) OR (n.updated_at >= ? AND n.updated_at < ?))
             ORDER BY n.updated_at ASC, n.id ASC
            """.trimIndent(),
            arrayOf(from.toString(), to.toString(), from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) out.add(row(c))
        }
        return out
    }

    // ------------------------------------------------------------ 写

    /**
     * 新建一张。[itemName] 为 null = 随记（不挂事项）。
     *
     * 事项名不存在时会建一行 `items`（与桌面 `ensure_item` 同语义）：便利贴挂的是
     * 「那个事项」，不是一串临时字符串，否则按事项筛就筛不出来。
     */
    fun create(itemName: String?, content: String, now: Long = System.currentTimeMillis()): Long {
        val h = Repo.helper ?: return 0L
        val db = h.writableDatabase
        val itemId = itemName?.trim()?.takeIf { it.isNotEmpty() }?.let { Repo.itemId(db, it, now) }
        val cv = ContentValues().apply {
            put("uid", Repo.uid())
            put("device_id", Repo.deviceId)
            put("rev", 1)
            if (itemId != null) put("item_id", itemId)
            put("content", clamp(content))
            put("sync_id", "")
            put("created_at", now)
            put("updated_at", now)
        }
        return db.insert("notes", null, cv)
    }

    /** 改正文。内容与事项都没变时不落库、不动 `updated_at`（避免同步基线抖动）。 */
    fun setContent(id: Long, content: String, now: Long = System.currentTimeMillis()): Int {
        val h = Repo.helper ?: return 0
        val next = clamp(content)
        val current = get(id) ?: return 0
        if (current.content == next) return 0
        return h.writableDatabase.update(
            "notes",
            ContentValues().apply {
                put("content", next)
                put("updated_at", now)
                put("rev", revOf(id) + 1)
            },
            "id = ? AND deleted_at IS NULL",
            arrayOf(id.toString()),
        )
    }

    /** 改关联事项。[itemName] 为 null = 解绑成随记。 */
    fun setItem(id: Long, itemName: String?, now: Long = System.currentTimeMillis()): Int {
        val h = Repo.helper ?: return 0
        val db = h.writableDatabase
        val current = get(id) ?: return 0
        if (current.itemName == itemName?.trim()?.takeIf { it.isNotEmpty() }) return 0
        val itemId = itemName?.trim()?.takeIf { it.isNotEmpty() }?.let { Repo.itemId(db, it, now) }
        val cv = ContentValues().apply {
            if (itemId == null) putNull("item_id") else put("item_id", itemId)
            put("updated_at", now)
        }
        return db.update("notes", cv, "id = ? AND deleted_at IS NULL", arrayOf(id.toString()))
    }

    /** 软删除。已经删过（或不存在）返回 0，调用方据此判断「这条本来就没有」。 */
    fun softDelete(id: Long, now: Long = System.currentTimeMillis()): Int {
        val h = Repo.helper ?: return 0
        return h.writableDatabase.update(
            "notes",
            ContentValues().apply {
                put("deleted_at", now)
                put("updated_at", now)
            },
            "id = ? AND deleted_at IS NULL",
            arrayOf(id.toString()),
        )
    }

    // ------------------------------------------------------------ Markdown 同步用

    /** 从 Markdown 收下的一行。 */
    data class Incoming(
        val syncId: String,
        val itemName: String?,
        val content: String,
        val updatedAt: Long,
    )

    /**
     * 同步落库：有号且本机已有 → 更新；否则按号新建。
     *
     * [updatedAt] 用**文件里那一行的时间**，不是 `now`。写成 `now` 会让每轮同步都把
     * `updated_at` 改一遍，于是「当天动过」判据永远成立、日记每轮重写、Obsidian
     * 端不断产生新版本 —— 时间必须跟着数据走，不能跟着同步动作走。
     */
    fun upsertFromSync(row: Incoming, now: Long = System.currentTimeMillis()): Long {
        val h = Repo.helper ?: return 0L
        val db = h.writableDatabase
        val content = clamp(row.content)
        val existing = if (row.syncId.isEmpty()) null else bySyncId(row.syncId)
        if (existing != null) {
            if (existing.content == content && existing.itemName == row.itemName) return existing.id
            val itemId = row.itemName?.trim()?.takeIf { it.isNotEmpty() }
                ?.let { Repo.itemId(db, it, now) }
            val cv = ContentValues().apply {
                put("content", content)
                if (itemId == null) putNull("item_id") else put("item_id", itemId)
                put("updated_at", row.updatedAt)
            }
            db.update("notes", cv, "id = ?", arrayOf(existing.id.toString()))
            return existing.id
        }
        val itemId = row.itemName?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { Repo.itemId(db, it, now) }
        val cv = ContentValues().apply {
            put("uid", Repo.uid())
            put("device_id", Repo.deviceId)
            put("rev", 1)
            if (itemId != null) put("item_id", itemId)
            put("content", content)
            put("sync_id", row.syncId)
            put("created_at", row.updatedAt)
            put("updated_at", row.updatedAt)
        }
        return db.insert("notes", null, cv)
    }

    /** 按号找（含已删的：删过的便利贴若在文件里又出现，要复活同一条而不是再建一条）。 */
    fun bySyncId(syncId: String): Note? {
        if (syncId.isEmpty()) return null
        val h = Repo.helper ?: return null
        h.readableDatabase.rawQuery(
            """
            SELECT n.id, n.item_id, i.name, n.content, n.sync_id, n.created_at, n.updated_at
              FROM notes n LEFT JOIN items i ON i.id = n.item_id
             WHERE n.sync_id = ? AND n.deleted_at IS NULL
             LIMIT 1
            """.trimIndent(),
            arrayOf(syncId),
        ).use { c -> return if (c.moveToFirst()) row(c) else null }
    }

    /**
     * 这个号对应的便利贴是不是**本机删掉的**（墓碑判定，专门看已删的行）。
     *
     * 同步时非查不可：本机删掉一张之后，文件里那行还在，如果只按「文件里有、库里没有」
     * 判断，就会把它当远端新增又插回来——用户删了三次它回来三次。
     */
    fun isDeleted(syncId: String): Boolean {
        if (syncId.isEmpty()) return false
        val h = Repo.helper ?: return false
        h.readableDatabase.rawQuery(
            "SELECT 1 FROM notes WHERE sync_id = ? AND deleted_at IS NOT NULL LIMIT 1",
            arrayOf(syncId),
        ).use { c -> return c.moveToFirst() }
    }

    /** 记住桌面端发下来的号。内容是空的便利贴这时才第一次有机会进文件。 */
    fun bindSyncId(id: Long, syncId: String) {        if (id <= 0L || syncId.isEmpty()) return
        val h = Repo.helper ?: return
        h.writableDatabase.update(
            "notes",
            ContentValues().apply { put("sync_id", syncId) },
            "id = ?",
            arrayOf(id.toString()),
        )
    }

    /** 记一个号回来（同步时把本机新行映射到桌面刚发的号上）。 */
    fun rebind(id: Long, syncId: String, updatedAt: Long) {
        if (id <= 0L || syncId.isEmpty()) return
        val h = Repo.helper ?: return
        h.writableDatabase.update(
            "notes",
            ContentValues().apply {
                put("sync_id", syncId)
                put("updated_at", updatedAt)
            },
            "id = ?",
            arrayOf(id.toString()),
        )
    }

    // ------------------------------------------------------------ 私有

    private fun row(c: android.database.Cursor) = Note(
        id = c.getLong(0),
        itemId = if (c.isNull(1)) null else c.getLong(1),
        itemName = if (c.isNull(2)) null else c.getString(2),
        content = c.getString(3) ?: "",
        syncId = c.getString(4) ?: "",
        createdAt = c.getLong(5),
        updatedAt = c.getLong(6),
    )

    private fun clamp(text: String): String =
        if (text.length > CONTENT_MAX_LEN) text.substring(0, CONTENT_MAX_LEN) else text

    private fun revOf(id: Long): Int {
        val h = Repo.helper ?: return 1
        h.readableDatabase.rawQuery("SELECT rev FROM notes WHERE id = ?", arrayOf(id.toString()))
            .use { c -> return if (c.moveToFirst()) c.getInt(0) else 1 }
    }
}
