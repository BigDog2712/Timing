package com.timing.droid.ui

import android.os.Handler
import com.timing.droid.core.md.MdSync

/**
 * 前台自动同步的节拍器（何时同步、失败后退多久再试）。
 *
 * 为什么从 `MainActivity` 拆出来：外壳已经贴着单文件 300 行的硬线，而「多久同步一次」
 * 是一段自成一体的小策略，混在 Activity 里既读不清也不好单独验。
 *
 * ## 为什么按「本轮结果」排下一次，而不是固定间隔
 * 旧实现固定每 20 秒醒一次。SAF 授权失效 / 文件被别的应用占着时，每一轮都失败，
 * 却仍然每 20 秒重来一次：白耗电、白刷一遍状态文案，用户还以为是 App 卡住了。
 * 现在连续失败按 20s → 60s → 180s 退避（180s 封顶），一次成功立刻回到 20s。
 *
 * 退避只在「连续」失败时累积：中间成功一次就清零，网络/权限刚恢复时能马上追上进度。
 */
class SyncTicker(
    private val handler: Handler,
    private val sync: (onDone: (MdSync.Report) -> Unit) -> Unit,
) {

    private companion object {
        /**
         * 退避阶梯（毫秒）：20 秒是「Obsidian Sync 落盘延迟」与「耗电」之间的折中；
         * 失败后逐级拉长，180 秒是上限——再长用户会觉得同步彻底停了。
         */
        val BACKOFF_MS = longArrayOf(20_000L, 60_000L, 180_000L)
    }

    /** 已经连续失败几轮，同时是 [BACKOFF_MS] 的下标（0 = 正常节奏） */
    private var failures = 0

    /** 生命周期内才走时；`onPause` 之后停表（`removeCallbacks`） */
    private var running = false

    /** 本轮已经发出但还没拿到结果。用来区分「被跳过（上一轮仍在跑）」与「结果还没回」 */
    private var awaiting = false

    private val tick = object : Runnable {
        override fun run() {
            awaiting = true
            sync { report ->
                /* 迟到的「排队回调」直接丢弃：同一份 report 会同时到达「发起那轮」和
                   「被排队那轮」两个 ticker 回调（每次 run 都新建一个 lambda），
                   各计一次失败会让退避跳级（60s 直接变 180s）。节奏只由发起那轮决定。 */
                if (!awaiting) return@sync
                awaiting = false
                failures = if (report.ok) 0 else (failures + 1).coerceAtMost(BACKOFF_MS.size - 1)
                schedule()
            }
            /* 上一轮还没跑完时 requestSync 会直接返回、不给结果：这里按当前节奏续排，
               否则节拍器会永久停摆。等那一轮真的出结果，schedule() 会重新校准。 */
            if (awaiting) schedule()
        }
    }

    /** 回前台时调用：先同步一次，再按结果排后续。 */
    fun start() {
        running = true
        failures = 0
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    /** 切后台时调用：停表。下次 [start] 重新起，不保留退避状态（换了一次前台算新的一轮）。 */
    fun stop() {
        running = false
        handler.removeCallbacks(tick)
    }

    private fun schedule() {
        if (!running) return
        handler.removeCallbacks(tick)
        handler.postDelayed(tick, BACKOFF_MS[failures])
    }
}
