package com.timing.app.overlay

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
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
        /** 已累计的整秒（不含本次 running 段）。绘制时用它现算，才有亚秒精度。 */
        val accumulatedSec: Long = 0,
        /** 本轮 running 的起点（墙钟毫秒）。暂停 / 待机时为 null。 */
        val runningSince: Long? = null,
    ) {
        /** 倒计时显示剩余（不为负），正计时显示已用。 */
        val displaySec: Long
            get() = if (countdown) (targetSec - elapsedSec).coerceAtLeast(0) else elapsedSec

        /**
         * 带小数的已用秒 —— **绘制专用**。
         *
         * 悬浮条每 500ms 才读一次库，如果圆点的弧只跟着这个整数秒走，就是一格一格地跳
         * （6°/秒 的台阶），看起来像卡顿。真实时间在两次读库之间照样在走，所以这里用
         * 「累计秒 + 现算的墙钟差」还原连续值，逐帧重绘才有顺滑的扫动。
         */
        fun elapsedAt(now: Long): Double {
            val since = runningSince ?: return accumulatedSec.toDouble()
            return accumulatedSec + (now - since).coerceAtLeast(0) / 1000.0
        }

        /** 绘制用的显示值：倒计时给剩余（可为小数），正计时给已用。 */
        fun displayAt(now: Long): Double {
            val elapsed = elapsedAt(now)
            return if (countdown) (targetSec - elapsed).coerceAtLeast(0.0) else elapsed
        }

        /** 倒计时最后一分钟要闪；正计时不闪。 */
        val urgent: Boolean
            get() = countdown && active && displaySec in 1..60

        companion object {
            val IDLE = Snap(false, "", 0, false, false, 0)
        }
    }

    /* [V0.11.22] 失败必须留痕。
     v0.11.21 及之前这里是 `runCatching{…}.getOrDefault(Snap.IDLE)`：SQL 一旦因为列缺失 /
     库被锁 / WAL 没建好而抛异常，悬浮条就**永久待机**，而 logcat 里一个字都没有——
     用户看到的是「主界面在计时、悬浮窗不动」，排查时没有任何线索。 */
    fun read(now: Long = System.currentTimeMillis()): Snap = try {
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
                accumulatedSec = accumulated,
                runningSince = runningSince,
            )
        }
    } catch (err: Exception) {
        Log.w(TAG, "read timing.db failed: ${err.message}", err)
        Snap.IDLE
    }

    override fun close() {
        runCatching { db.close() }
    }

    companion object {
        /** logcat 标签：`adb logcat -s TimingPill` 一条命令就能看到悬浮条的全部现场。 */
        private const val TAG = "TimingPill"

        /**
         * 打开连接；库还不存在（首启 / 还没建表）时返回 null，调用方按待机处理。
         *
         * [V0.11.22] 先试**读写**再退只读：WAL 模式的库用 `OPEN_READONLY` 打开时，SQLite 要
         * 能建 / 写 `-shm`，某些 ROM 或某些时刻会直接抛 `unable to open database file`。
         * 本进程从不写这个库，读写打开只是为了少一条被拒的理由。
         *
         * 两次都失败也**不缓存这个失败**：`PillService` 会退避重试（库可能是首启才建出来的）。
         */
        fun open(ctx: Context): TimerReader? {
            val file = File(ctx.dataDir, "timing.db")
            if (!file.exists()) return null
            for (flags in intArrayOf(SQLiteDatabase.OPEN_READWRITE, SQLiteDatabase.OPEN_READONLY)) {
                val db = runCatching {
                    SQLiteDatabase.openDatabase(file.path, null, flags)
                }.onFailure { err ->
                    Log.w(TAG, "open timing.db failed (flags=$flags): ${err.message}", err)
                }.getOrNull()
                if (db != null) return TimerReader(db)
            }
            return null
        }

        private fun runningDelta(runningSince: Long?, now: Long): Long =
            if (runningSince == null) 0 else ((now - runningSince).coerceAtLeast(0)) / 1000
    }
}
