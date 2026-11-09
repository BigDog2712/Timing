package com.timing.app.overlay

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import java.io.Closeable
import java.io.File
import org.json.JSONObject

/**
 * 悬浮条的数据源。
 *
 * ## 两条路，顺序固定（[V0.11.27]）
 *
 * ```text
 * Prefs.overlaySnapshot（Rust 状态机推来的快照）  ← 优先
 *   └─ 没有 / 太旧 → 只读打开 timing.db 现取一次   ← 兜底
 * ```
 *
 * v0.11.22 只有兜底那条，于是「库读不到」就等于「悬浮条永远待机」，且没有任何反馈
 * ——用户在手机上看到的正是「主界面在计时，悬浮条不动」。现在显示源换成 Rust 推的快照
 * （它是唯一状态机算出来的），读库退回兜底，并且**读失败会写进 `note`**，
 * 悬浮条的通知与日志都能看见原因。
 *
 * ## 为什么仍然只读
 *
 * 悬浮条只需要「现在在跑什么、已经多久」，这是纯算术（`accumulated_sec` + 墙钟差），
 * 不含任何业务规则；而 30 秒丢弃、跨零点拆分、倒计时第二段没有目标值这些规则全在
 * Rust 的写路径上。所以这里只读、不写，也永远不调用 `start/pause/stop`——一旦在这里
 * 自己写库，就等于把计时口径复制出第二份，那正是老安卓工程被归档的原因。
 */
internal class TimerReader private constructor(
    private val db: SQLiteDatabase,
    /** 真正选中的库路径（诊断用：报障时要能说出「读的是哪个文件」）。 */
    val path: String,
) : Closeable {

    /** 最近一次读失败的原因；成功后清空。 */
    var lastError: String? = null
        private set

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
        /**
         * 诊断用的一句话（[V0.11.27]）。
         *
         * `null` = 这份快照是可信的；非空 = 显示的是兜底值，原因是它。
         * 落进通知副标题与 `logcat -s TimingPill`：**兜底返回值必须配一条能看见的原因**，
         * 否则「坏了」和「待机」长得一模一样（v0.11.22 踩过）。
         */
        val note: String? = null,
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

            /**
             * 把 Rust 推来的快照 JSON 变成显示用的 [Snap]（[V0.11.27]）。
             *
             * 字段名与 `models::overlay::OverlaySnapshot` 的 `camelCase` 序列化一一对应。
             * 解析失败回 `null` —— 调用方退回读库，而不是猜一个待机（猜待机会让
             * 「推坏了」看起来像「没在计时」）。
             */
            fun fromPush(json: String, now: Long): Snap? {
                if (json.isEmpty()) return null
                val obj = runCatching { JSONObject(json) }.getOrNull() ?: return null
                val status = obj.optString("status", "idle")
                val accumulated = obj.optLong("accumulatedSec", 0L)
                val since = if (obj.isNull("runningSince")) null else obj.optLong("runningSince").takeIf { it > 0 }
                val running = status == "running" && since != null
                return Snap(
                    active = status != "idle",
                    item = obj.optString("item", ""),
                    elapsedSec = accumulated + if (running) ((now - since!!).coerceAtLeast(0)) / 1000 else 0,
                    running = running,
                    countdown = obj.optString("mode", "countup") == "countdown",
                    targetSec = obj.optLong("targetSec", 0L),
                    accumulatedSec = accumulated,
                    runningSince = since,
                )
            }
        }
    }

    /* [V0.11.22] 失败必须留痕。
     v0.11.21 及之前这里是 `runCatching{…}.getOrDefault(Snap.IDLE)`：SQL 一旦因为列缺失 /
     库被锁 / WAL 没建好而抛异常，悬浮条就**永久待机**，而 logcat 里一个字都没有——
     用户看到的是「主界面在计时、悬浮窗不动」，排查时没有任何线索。 */
    fun read(now: Long = System.currentTimeMillis()): Snap = try {
        val snap = db.rawQuery(
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
        lastError = null
        snap
    } catch (err: Exception) {
        lastError = err.message ?: err.javaClass.simpleName
        Log.w(TAG, "read $path failed: $lastError", err)
        Snap.IDLE.copy(note = "读库失败：$lastError")
    }

    override fun close() {
        runCatching { db.close() }
    }

    companion object {
        /** logcat 标签：`adb logcat -s TimingPill` 一条命令就能看到悬浮条的全部现场。 */
        private const val TAG = "TimingPill"

        /**
         * 最近一次「探路」的结论（[V0.11.27]）。
         *
         * 形如 `timing.db=不存在; data/timing.db=无 time_records; …`。
         * 存在的理由：库读不到时，**唯一有价值的信息是「试过哪些路径、各自什么下场」**。
         * 没有它，报障只能靠猜（v0.11.22/0.11.26 各有一次这样的问询）。
         */
        var lastProbe: String = ""
            private set

        /**
         * 打开连接。库还不存在 / 打不开时返回 `null`，调用方按待机处理。
         *
         * [V0.11.27] 从「认死 `dataDir/timing.db`」改成**探路**：
         * 数据根的口径（`app_data_dir` → 安卓 `getDataDir`）是从代码推出来的，一旦哪天
         * 变了或者换了个落点，认死一个路径就会静默退化成「永远待机」。现在按候选清单
         * 逐个试，并且**只有当库里真有 `time_records` 表**才算命中——空库（比如某次
         * 误建的 0 字节文件）不算。
         *
         * 先试**读写**再退只读：WAL 模式的库用 `OPEN_READONLY` 打开时，SQLite 要能建 /
         * 写 `-shm`，某些 ROM 或某些时刻会直接抛 `unable to open database file`。
         * 本进程从不写这个库，读写打开只是为了少一条被拒的理由。
         */
        fun open(ctx: Context): TimerReader? {
            val tried = mutableListOf<String>()
            for (file in candidates(ctx)) {
                val name = label(ctx, file)
                if (!file.exists()) {
                    tried += "$name=不存在"
                    continue
                }
                var openError: String? = null
                var opened = false
                for (flags in intArrayOf(SQLiteDatabase.OPEN_READWRITE, SQLiteDatabase.OPEN_READONLY)) {
                    val db = runCatching {
                        SQLiteDatabase.openDatabase(file.path, null, flags)
                    }.onFailure { err ->
                        openError = err.message ?: err.javaClass.simpleName
                        Log.w(TAG, "open ${file.path} failed (flags=$flags): $openError", err)
                    }.getOrNull() ?: continue
                    opened = true

                    val rows = runCatching {
                        db.rawQuery("SELECT count(*) FROM time_records", null).use { c ->
                            c.moveToFirst()
                            c.getInt(0)
                        }
                    }
                    if (rows.isSuccess) {
                        tried += "$name=可读 ${rows.getOrDefault(0)} 行"
                        lastProbe = tried.joinToString("; ")
                        Log.w(TAG, "timing.db 选中：${file.path}（$lastProbe）")
                        return TimerReader(db, file.path)
                    }
                    /* 能打开但没有这张表：多半不是业务库（或是个空文件），换下一个候选。
                       不再试只读：同一份文件换个 flag 也变不出这张表。 */
                    tried += "$name=无 time_records"
                    runCatching { db.close() }
                    break
                }
                if (!opened) tried += "$name=打不开(${openError ?: "未知原因"})"
            }
            lastProbe = tried.joinToString("; ").ifEmpty { "没有候选路径" }
            Log.w(TAG, "timing.db 全部候选都不可用：$lastProbe")
            return null
        }

        /**
         * 候选路径，按可能性排序。
         *
         * - `timing.db`：`app_data_dir` = 安卓 `getDataDir`，正常就在这一层；
         * - `data/` `files/`：历史上换过落点口径时出现过的两层；
         * - 一层子目录 + 全盘 2 层内的 `*.db`：最后的手段，按修改时间新的在前。
         */
        private fun candidates(ctx: Context): List<File> {
            val root = ctx.dataDir
            val direct = listOf(
                File(root, "timing.db"),
                File(root, "data/timing.db"),
                File(root, "files/timing.db"),
            )
            val nested = runCatching {
                root.listFiles { f -> f.isDirectory }?.map { File(it, "timing.db") } ?: emptyList()
            }.getOrDefault(emptyList())
            val loose = runCatching {
                root.walkTopDown().maxDepth(2)
                    .filter { it.isFile && it.name.endsWith(".db") }
                    .sortedByDescending { it.lastModified() }
                    .take(8)
                    .toList()
            }.getOrDefault(emptyList())
            return (direct + nested.filter { it.exists() } + loose)
                .distinctBy { it.absolutePath }
        }

        /** 诊断串里只留相对路径：通知 / 日志都短，带全路径会挤掉别的信息。 */
        private fun label(ctx: Context, file: File): String {
            /* `Context.getDataDir()` 返回 `File`，不是字符串——直接 `trimEnd('/')` 编不过。 */
            val prefix = ctx.dataDir.absolutePath.trimEnd('/') + "/"
            return file.absolutePath.removePrefix(prefix).trimStart('/').ifEmpty { file.name }
        }

        private fun runningDelta(runningSince: Long?, now: Long): Long =
            if (runningSince == null) 0 else ((now - runningSince).coerceAtLeast(0)) / 1000
    }
}
