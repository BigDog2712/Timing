package com.timing.droid.core

import android.content.ContentValues
import android.content.Context

/**
 * 落库层。`TimerCore` 只认识 [TimerCore.Store] 这个接口，不 import 任何 SQLite 类，
 * 这样状态机在纯 JVM 单测里能换成一个假实现。
 *
 * 线程约定：全部在**主线程**调用。数据量是「一天几十条」，SQLite 一次写入 ~1ms，
 * 不值得为它引线程池 + 回调；真要变重了再把这层挪到 IO 线程，接口不用改。
 */
object Repo : TimerCore.Store {

    internal var helper: Db? = null

    /** 本机身份，写进每行的 `device_id`。首次生成后长期不变，冲突合并时靠它分辨来源。 */
    internal var deviceId = ""

    /**
     * 本地库是否已就绪。
     *
     * 同步必须检查它：库没开时 `loadDay` 会「安静返回空」，而空集在同步里代表
     * 「本机这一天没有记录」，会把它当成用户删光了，从而把文件里的数据删掉。
     */
    val ready: Boolean get() = helper != null

    fun init(ctx: Context) {
        val app = ctx.applicationContext
        if (helper == null && !gaveUp) helper = openOrRebuild(app)
        if (deviceId.isEmpty()) deviceId = Prefs.deviceId(app)
    }

    /** 已经试过重建还是打不开：进程内不再重试，避免每次调用都去删一次库。 */
    @Volatile
    private var gaveUp = false

    /**
     * 打开库；打不开（文件损坏 / 目录异常）就先留现场再重建。
     *
     * 取舍：宁可丢一份本机镜像，也不要让 App 永远打不开 —— 这次设计里权威数据是
     * Obsidian 里那篇 Markdown，SQLite 只是缓存与救援来源，删它不是灾难。
     * 返回 null 表示彻底打不开，此时所有落库操作安静失败，界面走内存模式。
     */
    private fun openOrRebuild(app: Context): Db? {
        val first = Db(app)
        if (runCatching { first.readableDatabase }.isSuccess) return first
        runCatching { first.close() }

        runCatching {
            val dir = app.getDatabasePath(Db.NAME).parentFile ?: return@runCatching
            val src = java.io.File(dir, Db.NAME)
            // 留一份现场，万一以后要人工捞
            if (src.exists()) {
                src.renameTo(java.io.File(dir, "${Db.NAME}.broken-${System.currentTimeMillis()}"))
            }
            listOf("-wal", "-shm", "-journal").forEach {
                java.io.File(dir, Db.NAME + it).delete()
            }
        }
        runCatching { app.deleteDatabase(Db.NAME) }

        val rebuilt = Db(app)
        if (runCatching { rebuilt.readableDatabase }.isSuccess) return rebuilt
        runCatching { rebuilt.close() }
        gaveUp = true
        return null
    }

    internal fun uid(): String = java.util.UUID.randomUUID().toString()

    // ------------------------------------------------------------ 计时记录

    override fun loadDay(dayStart: Long): List<TimerCore.Session> {
        val h = helper ?: return emptyList()
        val from = dayStart
        val to = Days.addDays(dayStart, 1)
        val out = ArrayList<TimerCore.Session>()
        h.readableDatabase.rawQuery(
            """
            SELECT r.id, r.accumulated_sec, r.ended_at, r.completed, IFNULL(i.name, '未归类')
              FROM time_records r LEFT JOIN items i ON i.id = r.item_id
             WHERE r.deleted_at IS NULL AND r.ended_at >= ? AND r.ended_at < ?
             ORDER BY r.ended_at DESC
            """.trimIndent(),
            arrayOf(from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    TimerCore.Session(
                        id = c.getLong(0),
                        item = c.getString(4),
                        ms = c.getLong(1) * 1000L,
                        endedAt = c.getLong(2),
                        completed = c.getInt(3) == 1,
                    ),
                )
            }
        }
        return out
    }

    override fun save(s: TimerCore.Session): Long {
        val h = helper ?: return 0L
        val db = h.writableDatabase
        val ts = System.currentTimeMillis()
        val itemId = itemId(db, s.item, ts)
        val started = (s.endedAt - s.ms).coerceAtMost(s.endedAt)
        val cv = ContentValues().apply {
            put("uid", uid())
            put("device_id", deviceId)
            put("rev", 1)
            put("item_id", itemId)
            put("status", "saved")
            put("started_at", started)
            put("ended_at", s.endedAt)
            put("accumulated_sec", s.ms / 1000L)
            put("completed", if (s.completed) 1 else 0)
            put("created_at", ts)
            put("updated_at", ts)
        }
        return db.insert("time_records", null, cv)
    }

    /** 软删除（打 `deleted_at`），和桌面一致——将来同步时要能知道「这条被删了」。 */
    override fun remove(id: Long) {
        if (id <= 0L) return
        val h = helper ?: return
        h.writableDatabase.execSQL(
            "UPDATE time_records SET deleted_at = ?, updated_at = ?, rev = rev + 1 " +
                "WHERE id = ? AND deleted_at IS NULL",
            arrayOf(System.currentTimeMillis(), System.currentTimeMillis(), id),
        )
    }

    /** 取（必要时建）事项行。同名事项复用同一 id，不重复插。 */
    internal fun itemId(db: android.database.sqlite.SQLiteDatabase, name: String, ts: Long): Long {
        db.rawQuery(
            "SELECT id FROM items WHERE name = ? AND deleted_at IS NULL LIMIT 1",
            arrayOf(name),
        ).use { c -> if (c.moveToFirst()) return c.getLong(0) }
        val cv = ContentValues().apply {
            put("name", name)
            put("created_at", ts)
            put("updated_at", ts)
        }
        return db.insert("items", null, cv)
    }

    // ------------------------------------------------------------ 聚合

    /** 一周 7 天的总时长（下标对齐 [Days.week] 的返回值）。 */
    fun weekTotals(days: List<Long>): LongArray {
        val out = LongArray(days.size)
        val h = helper ?: return out
        if (days.isEmpty()) return out
        val from = days.first()
        val to = Days.addDays(days.last(), 1)
        val buckets = HashMap<Long, Long>()
        h.readableDatabase.rawQuery(
            "SELECT ended_at, accumulated_sec FROM time_records " +
                "WHERE deleted_at IS NULL AND ended_at >= ? AND ended_at < ?",
            arrayOf(from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                val day = Days.startOfDay(c.getLong(0))
                buckets[day] = (buckets[day] ?: 0L) + c.getLong(1) * 1000L
            }
        }
        days.forEachIndexed { i, day -> out[i] = buckets[day] ?: 0L }
        return out
    }

    /** 某区间内按事项汇总，降序。 */
    fun byItemBetween(from: Long, to: Long): List<Pair<String, Long>> {
        val h = helper ?: return emptyList()
        val out = ArrayList<Pair<String, Long>>()
        h.readableDatabase.rawQuery(
            """
            SELECT IFNULL(i.name, '未归类') AS n, SUM(r.accumulated_sec) AS s
              FROM time_records r LEFT JOIN items i ON i.id = r.item_id
             WHERE r.deleted_at IS NULL AND r.ended_at >= ? AND r.ended_at < ?
             GROUP BY n ORDER BY s DESC
            """.trimIndent(),
            arrayOf(from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) out.add(c.getString(0) to c.getLong(1) * 1000L)
        }
        return out
    }

    // ------------------------------------------------------------ 同步用（Markdown 双向）

    /** 一天里的一条已结束记录，字段与 Planner 区块里的 `start` / `end` 一一对应。 */
    data class Rec(
        val id: Long,
        val item: String,
        val startedAt: Long,
        val endedAt: Long,
        val sec: Long,
        val updatedAt: Long,
    )

    /**
     * 某天已结束的记录，按开始时间升序。
     *
     * **按 `started_at` 归日**（不是 `ended_at`）—— 这是桌面端 `md_sync::export` 的口径，
     * 必须一致：否则一段 23:50 → 次日 00:15 的会话会在两端的两个日记文件里各写一遍，
     * 同步时互相判成「对面多了一条」，越同步越乱。
     */
    fun recordsForDay(from: Long, to: Long): List<Rec> {
        val h = helper ?: return emptyList()
        val out = ArrayList<Rec>()
        h.readableDatabase.rawQuery(
            """
            SELECT r.id, IFNULL(i.name, '未归类'), r.started_at, r.ended_at,
                   r.accumulated_sec, r.updated_at
              FROM time_records r LEFT JOIN items i ON i.id = r.item_id
             WHERE r.deleted_at IS NULL AND r.ended_at IS NOT NULL
               AND r.started_at >= ? AND r.started_at < ?
             ORDER BY r.started_at ASC
            """.trimIndent(),
            arrayOf(from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    Rec(
                        id = c.getLong(0),
                        item = c.getString(1),
                        startedAt = c.getLong(2),
                        endedAt = c.getLong(3),
                        sec = c.getLong(4),
                        updatedAt = c.getLong(5),
                    ),
                )
            }
        }
        return out
    }

    /** 某天记录里最大的 `updated_at`，冲突判定时代表「本机最后改动时刻」。 */
    fun latestUpdate(from: Long, to: Long): Long {
        val h = helper ?: return 0L
        h.readableDatabase.rawQuery(
            "SELECT IFNULL(MAX(updated_at), 0) FROM time_records " +
                "WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ?",
            arrayOf(from.toString(), to.toString()),
        ).use { c -> return if (c.moveToFirst()) c.getLong(0) else 0L }
    }

    /**
     * 从 Markdown 导入一段：同事项同起点视为同一段（幂等，重复同步不会堆重复记录）。
     *
     * 为什么用 `(item_id, started_at)` 当自然键：Planner 区块里没有行 id 可用
     * （桌面的计时区块就没写隐藏 id），而一个事项在同一毫秒开两次是不可能的。
     */
    fun upsertRecord(item: String, startedAt: Long, endedAt: Long, sec: Long): Long {
        val h = helper ?: return 0L
        val db = h.writableDatabase
        val ts = System.currentTimeMillis()
        val itemId = itemId(db, item, ts)
        db.rawQuery(
            "SELECT id FROM time_records WHERE item_id = ? AND started_at = ? " +
                "AND deleted_at IS NULL LIMIT 1",
            arrayOf(itemId.toString(), startedAt.toString()),
        ).use { c ->
            if (c.moveToFirst()) {
                val id = c.getLong(0)
                db.execSQL(
                    "UPDATE time_records SET ended_at = ?, accumulated_sec = ?, updated_at = ?, " +
                        "rev = rev + 1, device_id = ? WHERE id = ?",
                    arrayOf<Any>(endedAt, sec, ts, deviceId, id),
                )
                return id
            }
        }
        val cv = ContentValues().apply {
            put("uid", uid())
            put("device_id", deviceId)
            put("rev", 1)
            put("item_id", itemId)
            put("status", "saved")
            put("started_at", startedAt)
            put("ended_at", endedAt)
            put("accumulated_sec", sec)
            put("completed", 0)
            put("created_at", ts)
            put("updated_at", ts)
        }
        return db.insert("time_records", null, cv)
    }

    /** 清空全部业务数据（设置页「清空记录」用）。 */
    fun wipeAll() {
        val h = helper ?: return
        val db = h.writableDatabase
        listOf("time_records", "todos").forEach { db.execSQL("DELETE FROM $it") }
    }
}
