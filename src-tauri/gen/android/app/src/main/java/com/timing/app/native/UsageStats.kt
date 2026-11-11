package com.timing.app.native

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/**
 * 应用使用时间采集（Android，`UsageStatsManager`）。
 *
 * ## 为什么必须用 UsageStatsManager
 * 安卓上「哪个应用在前台多久」只有这一个系统口子。它要 **`PACKAGE_USAGE_STATS`** —— 一个
 * **特殊权限**：`checkSelfPermission` 永远返回拒（它不在运行时权限那套里），只能靠
 * `AppOpsManager` 读 `OPSTR_GET_USAGE_STATS` 判，且用户必须去系统设置里手动打开。
 * 所以这里没有任何「请求权限」的代码，只有「查状态」和「帮他跳过去」。
 *
 * ## 口径（与 PC 版对齐的部分、不对齐的部分）
 * - **只算前台**：`ACTIVITY_RESUMED` → `ACTIVITY_PAUSED`/`STOPPED` 之间的区间。
 * - **息屏当切走**：`SCREEN_NON_INTERACTIVE` / `KEYGUARD_SHOWN` 一律关掉当前区间；
 *   `SCREEN_INTERACTIVE` / `KEYGUARD_HIDDEN` 不自动开启——用户可能锁屏后就干别的去了。
 * - 后台播放、后台下载**不计**（系统也只给前台）。
 * - 不采任何内容：只有包名与毫秒。
 *
 * ## 已知边界
 * 系统只保留最近几天的明细事件（各 ROM 不同，常见 7 天）。更早的数据只能靠宿主落库的历史，
 * 这是 `app_usage` 表存在的理由（本类只负责「今天这一段」）。
 */
object UsageStats {

    /** `queryEvents` 一次最多取多少条：一天的重度使用约 3–5 千条，取 2 万足够且不会卡主线程。 */
    private const val MAX_EVENTS = 20_000

    /** 特殊权限没有运行时申请，只能读 AppOps。 */
    fun hasPermission(context: Context): Boolean {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                ops.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            } else {
                @Suppress("DEPRECATION")
                ops.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            }
        }.getOrDefault(AppOpsManager.MODE_ERRORED)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** 跳到系统「使用情况访问」页。不同 ROM 的入口不一致，失败时回落本应用详情页。 */
    fun openSettings(context: Context) {
        val candidates = listOf(
            Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (intent in candidates) {
            val ok = runCatching {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                true
            }.getOrDefault(false)
            if (ok) return
        }
    }

    /**
     * 取 [fromMs, toMs) 的前台时长，按包名聚合。
     *
     * 返回 `[{pkg, sec, first, last}]`：`first` / `last` 是该包今天第一次/最后一次进入前台的
     * 时刻（毫秒），用于「几点开始用的」这类展示。**不返回事件流水** —— 那要几千行，
     * 卡片也画不下（方案书 §2① 已拍「按包聚合」）。
     */
    fun queryDay(context: Context, fromMs: Long, toMs: Long): JSONArray {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return JSONArray()
        if (!hasPermission(context)) return JSONArray()

        val events = runCatching { manager.queryEvents(fromMs, toMs) }.getOrNull()
            ?: return JSONArray()

        val totals = HashMap<String, Long>()
        val first = HashMap<String, Long>()
        val last = HashMap<String, Long>()
        var currentPkg: String? = null
        var currentSince = 0L
        var scanned = 0

        fun close(atMs: Long) {
            val pkg = currentPkg ?: return
            val span = (atMs - currentSince).coerceAtLeast(0)
            if (span > 0) {
                totals[pkg] = (totals[pkg] ?: 0L) + span
                if (first[pkg] == null) first[pkg] = currentSince
                last[pkg] = atMs
            }
            currentPkg = null
        }

        val event = UsageEvents.Event()
        while (events.hasNextEvent() && scanned < MAX_EVENTS) {
            events.getNextEvent(event)
            scanned += 1
            val at = event.timeStamp
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    close(at)
                    currentPkg = event.packageName
                    currentSince = at
                }
                UsageEvents.Event.ACTIVITY_PAUSED,
                UsageEvents.Event.ACTIVITY_STOPPED -> {
                    if (event.packageName == currentPkg) close(at)
                }
                UsageEvents.Event.SCREEN_NON_INTERACTIVE,
                UsageEvents.Event.KEYGUARD_SHOWN -> close(at)
                else -> Unit
            }
        }
        /* 末尾还开着的区间：算到「现在」与窗口末尾里较小的那个 */
        close(minOf(toMs, System.currentTimeMillis()))

        val out = JSONArray()
        for ((pkg, ms) in totals) {
            val row = JSONObject()
            row.put("packageName", pkg)
            row.put("sec", ms / 1000)
            row.put("first", first[pkg] ?: 0L)
            row.put("last", last[pkg] ?: 0L)
            out.put(row)
        }
        return out
    }
}
