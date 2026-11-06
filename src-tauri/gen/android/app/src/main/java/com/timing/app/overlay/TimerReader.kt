package com.timing.app.overlay

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.Closeable
import java.io.File

/**
 * 悬浮条的数据源：**只读**打开 `timing.db`，取当前 active 会话。
 *
 * ## 为什么不复用 Rust 的状态机
 *
 * 悬浮条只需要「现在在跑什么、已经多久」，这是纯算术（`accumulated_sec` + 墙钟差），
 * 不含任何业务规则；而 30 秒丢弃、跨零点拆分、倒计时第二段没有目标值这些规则全在
 * Rust 的写路径上。所以这里只读、不写，也永远不调用 `start/pause/stop`——一旦在这里
 * 自己写库，就等于把计时口径复制出第二份，那正是老安卓工程被归档的原因。
 *
 * ## 为什么持有一个连接
 *
 * 悬浮条每秒刷新一次，每次 open/close 都要重新解析 WAL 索引，纯属浪费。连接在服务
 * `onCreate` 建立、`onDestroy` 关闭，随服务一起活。库是 WAL 模式，只读连接能看到
 * Rust 侧刚提交的内容（-wal / -shm 在同应用沙箱内，权限没问题），也不会阻塞写入。
 */
internal class TimerReader private constructor(private val db: SQLiteDatabase) : Closeable {

    /** 一次快照。`displaySec` 已按「正计时 / 倒计时」算好该显示哪一个数。 */
    data class Snap(
        val active: Boolean,
        val item: String,
        val elapsedSec: Long,
        val running: Boolean,
        val countdown: Boolean,
        val targetSec: Long,
    ) {
        /** 倒计时显示剩余（不为负），正计时显示已用。 */
        val displaySec: Long
            get() = if (countdown) (targetSec - elapsedSec).coerceAtLeast(0) else elapsedSec

        /** 倒计时最后一分钟要闪；正计时不闪。 */
        val urgent: Boolean
            get() = countdown && active && displaySec in 1..60

        companion object {
            val IDLE = Snap(false, "", 0, false, false, 0)
        }
    }

    fun read(now: Long = System.currentTimeMillis()): Snap = runCatching {
        db.rawQuery(
            "SELECT i.name, r.started_at, r.accumulated_sec, r.running_since, " +
                "r.mode, r.target_sec " +
                "FROM time_records r LEFT JOIN items i ON i.id = r.item_id " +
                "WHERE r.status = 'active' AND r.deleted_at IS NULL LIMIT 1",
            null,
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@use Snap.IDLE
            val runningSince = if (cursor.isNull(3)) null else cursor.getLong(3)
            val accumulated = cursor.getLong(2)
            Snap(
                active = true,
                item = cursor.getString(0) ?: "",
                elapsedSec = accumulated + runningDelta(runningSince, now),
                running = runningSince != null,
                countdown = cursor.getString(4) == "countdown",
                targetSec = cursor.getLong(5),
            )
        }
    }.getOrDefault(Snap.IDLE)

    override fun close() {
        runCatching { db.close() }
    }

    companion object {
        /** 打开只读连接；库还不存在（首启 / 还没建表）时返回 null，调用方按待机处理。 */
        fun open(ctx: Context): TimerReader? {
            val file = File(ctx.dataDir, "timing.db")
            if (!file.exists()) return null
            val db = runCatching {
                SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
            }.getOrNull() ?: return null
            return TimerReader(db)
        }

        private fun runningDelta(runningSince: Long?, now: Long): Long =
            if (runningSince == null) 0 else ((now - runningSince).coerceAtLeast(0)) / 1000
    }
}
