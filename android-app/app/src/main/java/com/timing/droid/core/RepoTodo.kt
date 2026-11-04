package com.timing.droid.core

import android.content.ContentValues

/**
 * 待办的落库层（从 [Repo] 拆出：那边已经到 300 行的硬上限）。
 *
 * 与 [Repo] 共用同一个 `SQLiteOpenHelper` 与同一条 `device_id`：待办将来要同步，
 * 每行都得能回答「这条是谁写的」。
 */
object RepoTodo {

    data class TodoRow(val id: Long, val title: String, val done: Boolean)

    fun load(): List<TodoRow> {
        val h = Repo.helper ?: return emptyList()
        val out = ArrayList<TodoRow>()
        h.readableDatabase.rawQuery(
            "SELECT id, title, done FROM todos WHERE deleted_at IS NULL " +
                "ORDER BY done ASC, sort_order ASC, id ASC",
            null,
        ).use { c ->
            while (c.moveToNext()) {
                out.add(TodoRow(c.getLong(0), c.getString(1), c.getInt(2) == 1))
            }
        }
        return out
    }

    fun add(title: String): Long {
        val h = Repo.helper ?: return 0L
        val ts = System.currentTimeMillis()
        val cv = ContentValues().apply {
            put("uid", Repo.uid())
            put("device_id", Repo.deviceId)
            put("rev", 1)
            put("title", title)
            put("done", 0)
            put("created_at", ts)
            put("updated_at", ts)
        }
        return h.writableDatabase.insert("todos", null, cv)
    }

    fun setDone(id: Long, done: Boolean) {
        val h = Repo.helper ?: return
        h.writableDatabase.execSQL(
            "UPDATE todos SET done = ?, updated_at = ?, rev = rev + 1 WHERE id = ?",
            arrayOf<Any>(if (done) 1 else 0, System.currentTimeMillis(), id),
        )
    }

    /** 软删（打 `deleted_at`），和桌面一致 —— 同步时要能知道「这条被删了」。 */
    fun remove(id: Long) {
        val h = Repo.helper ?: return
        val ts = System.currentTimeMillis()
        h.writableDatabase.execSQL(
            "UPDATE todos SET deleted_at = ?, updated_at = ?, rev = rev + 1 WHERE id = ?",
            arrayOf<Any>(ts, ts, id),
        )
    }
}
