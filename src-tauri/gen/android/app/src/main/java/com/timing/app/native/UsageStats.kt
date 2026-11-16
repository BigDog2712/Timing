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
 * ## 只用一个来源：事件流，按 **同一个 Activity** 配对（0.12.8 定稿）
 *
 * 进入 = 该 Activity 的 `ACTIVITY_RESUMED`；离开 = **同一个 Activity 的**
 * `ACTIVITY_PAUSED` / `ACTIVITY_STOPPED`；另外 `SCREEN_NON_INTERACTIVE` /
 * `KEYGUARD_SHOWN` 会把当时开着的 Activity 一起结掉。
 *
 * 这就是系统自己的记账方式，也是「设置 → 健康使用手机」那个页面的算法。实测对齐
 * （同一台机器、同一天，四个应用全部吻合到分钟）：
 *
 * | 应用 | 系统页面 | 本算法 |
 * |---|---|---|
 * | 王者荣耀 | 1 小时 56 分 | 1h56m59s |
 * | 哔哩哔哩 | 1 小时 24 分 | 1h23m44s |
 * | Timing | 46 分 | 0h46m36s |
 * | 微信 | 32 分 | 0h32m48s |
 *
 * ## 两个被否掉的写法（都真机验证过，别再回去）
 *
 * **① 拿 `queryAndAggregateUsageStats` / `queryUsageStats` 的总量**：那个数是「内存里的
 * 当日累计」，而 MIUI 的日界**不是本地 00:00**（`dumpsys usagestats` 的
 * `In-memory daily stats timeRange="11/14 14:36 – 11/15 14:33"`）。于是「今天」拿到的是
 * **昨天下午 + 今天**的和：王者荣耀被算成 5 小时 12 分，而系统自己的页面上写的是 1 小时 56 分。
 * 逐桶查也救不了 —— 今天的窗口里一个桶起点都没有（那个桶起点在昨天 14:36）。
 *
 * **② 拿「另一个包 RESUMED」当离开**：同一个应用内部换 Activity（游戏过场、微信从视频页
 * 回聊天页）是一串同刻到达的 RESUMED/PAUSED，按包配对会把连续使用切碎；反过来，别的包
 * RESUMED 也不代表这个包的 Activity 真的停了 —— 实测 10:47 微信 RESUMED，而王者的
 * SGameActivity 直到 12:17 息屏才 PAUSED，系统把这一整段都算给王者。按包配对那天只
 * 算出 25 分钟，系统页面写 1 小时 56 分。
 *
 * ## 为什么不会再有「多段不到一分钟」
 * 按 Activity 配对出的相邻区间**首尾相接**（A 暂停的同时 B 恢复），`mergeByPackage`
 * 会把它们并成连续的一条。真机数据里哔哩哔哩一天有上百个 Activity 切换，合并之后是
 * 几条几十分钟的长段 —— 与用户的体感一致。
 *
 * 后台播放、后台下载**不计**（系统也只给前台）。不采任何内容：只有包名与毫秒。
 *
 * ## 已知边界
 * 系统只保留最近几天的明细事件（各 ROM 不同，常见 7 天）。更早的数据只能靠宿主落库的
 * 历史，这是 `app_usage` / `app_usage_span` 两张表存在的理由。
 */
object UsageStats {

    /** `queryEvents` 一次最多取多少条：一天的重度使用约 3–5 千条，取 2 万足够且不会卡主线程。 */
    private const val MAX_EVENTS = 20_000

    /** 短于这个宽度的前台区间不记：不足 1 秒的切换是噪声，界面上也只会显示成「09:00-09:00」。 */
    private const val MIN_SPAN_MS = 1000L

    /** 一段前台区间（毫秒）。内部结构，不进 JSON。 */
    private class Span(val pkg: String, val from: Long, val to: Long) {
        val ms: Long get() = (to - from).coerceAtLeast(0)
    }

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
     * 取 [fromMs, toMs) 的前台时长与用它的时段。
     *
     * 回 `{ rows: [{packageName, sec, first, last}], spans: [{packageName, from, to}] }`。
     * 窗口约定是**本地日整天** [00:00, 次日 00:00)，由 Rust 侧算好传进来 —— Kotlin 不做
     * 本地日推算，两边各算一次必然在时区/夏令时上分叉。
     *
     * `rows` 里的三个数**全部从 `spans` 推**：混用「系统总量 + 事件时段」时，界面上会出现
     * 「合计 5 小时 12 分 / 只有 3 段 25 分钟」，用户只会得到一个结论：算错了。
     *
     * `spans` 是**扁平**的 `[{packageName, from, to}]` 而不是塞进各自的 row：跨桥的列表
     * 只走 `jsArrayOf`，元素是 `JSONObject` 时这条路已在真机上跑通（`apps` 就是），
     * 元素是**嵌套 `JSONArray`** 时则没有先例。少赌一种装法，多写一行分组而已。
     */
    fun queryDay(context: Context, fromMs: Long, toMs: Long): JSONObject {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return JSONObject()
        if (!hasPermission(context)) return JSONObject()

        val spans = collectSpans(manager, fromMs, toMs)

        val secMs = HashMap<String, Long>()
        val firstOf = HashMap<String, Long>()
        val lastOf = HashMap<String, Long>()
        for (span in spans) {
            secMs[span.pkg] = (secMs[span.pkg] ?: 0L) + span.ms
            val first = firstOf[span.pkg]
            if (first == null || span.from < first) firstOf[span.pkg] = span.from
            val last = lastOf[span.pkg]
            if (last == null || span.to > last) lastOf[span.pkg] = span.to
        }

        val rows = JSONArray()
        for ((pkg, ms) in secMs) {
            val row = JSONObject()
            row.put("packageName", pkg)
            row.put("sec", ms / 1000)
            /* 首末都从段推：系统的 `firstTimeStamp` 是「日桶起点」不是「首次使用」，
               拿它填会把每一行都写成 00:00；`lastTimeUsed` 和段不同源，会出现
               「最后 13:25」而时段列表停在 12:40 的错位。 */
            row.put("first", firstOf[pkg] ?: 0L)
            row.put("last", lastOf[pkg] ?: 0L)
            rows.put(row)
        }

        /* 诊断：排查「数字对不上系统页面」时先看这一行（`adb logcat -s TimingUsage`）。
           段数按合并后计 —— 合并前能有几百条，那个数字没有解释价值。 */
        if (spans.isNotEmpty()) {
            val top = secMs.entries.sortedByDescending { it.value }.take(5)
                .joinToString { "${it.key}=${it.value / 1000}s" }
            android.util.Log.i(
                "TimingUsage",
                "window=$fromMs..$toMs 段=${spans.size} | $top",
            )
        }

        val out = JSONObject()
        out.put("rows", rows)
        out.put("spans", spansOf(spans))
        return out
    }

    /**
     * 事件流 → 已配对、已合并的前台区间。
     *
     * 键是 **包名 + Activity 类名**：只有「同一个 Activity 自己暂停」才算离开。
     * 用 `instanceId` 更精细（多窗口下同类 Activity 可能有两份），但它旧版本上没有，
     * 而同类 Activity 同时前台的情况本项目见不到 —— 取简。
     */
    private fun collectSpans(manager: UsageStatsManager, fromMs: Long, toMs: Long): List<Span> {
        val events = runCatching { manager.queryEvents(fromMs, toMs) }.getOrNull()
            ?: return emptyList()
        val raw = ArrayList<Span>()
        /** Activity 键 → 进入前台的时刻。同一 Activity 重复 RESUMED 时保留最早那一刻。 */
        val open = HashMap<String, Long>()
        var scanned = 0

        fun closeKey(key: String, atMs: Long) {
            val since = open.remove(key) ?: return
            if (atMs > since) raw.add(Span(pkgOf(key), since, atMs))
        }

        /* 息屏/锁屏：当时开着的全都结掉。系统通常也会补一条 PAUSED，但**不保证**
           （长时段被配额丢事件时就没有），留着会让这段一直延伸到第二天。 */
        fun closeAll(atMs: Long) {
            for (key in open.keys.toList()) closeKey(key, atMs)
        }

        val event = UsageEvents.Event()
        while (events.hasNextEvent() && scanned < MAX_EVENTS) {
            events.getNextEvent(event)
            scanned += 1
            val at = event.timeStamp
            val key = keyOf(event) ?: continue
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    if (!open.containsKey(key)) open[key] = at
                }
                UsageEvents.Event.ACTIVITY_PAUSED,
                UsageEvents.Event.ACTIVITY_STOPPED -> closeKey(key, at)
                UsageEvents.Event.SCREEN_NON_INTERACTIVE,
                UsageEvents.Event.KEYGUARD_SHOWN -> closeAll(at)
                else -> Unit
            }
        }
        /* 末尾还开着的：算到「现在」与窗口末尾里较小的那个（历史窗口不会超过窗口末尾） */
        closeAll(minOf(toMs, System.currentTimeMillis()))

        return mergeByPackage(raw)
    }

    /** `包名#类名`。类名为空时退化成 `包名#` —— 那时只能按包配对，聊胜于无。 */
    private fun keyOf(event: UsageEvents.Event): String? {
        val pkg = event.packageName ?: return null
        if (pkg.isEmpty()) return null
        return pkg + "#" + (event.className ?: "")
    }

    private fun pkgOf(key: String): String = key.substringBefore('#')

    /**
     * 按包合并相接/重叠的区间，再丢掉不足 [MIN_SPAN_MS] 的。
     *
     * **顺序不能反**：先合并，一段 300 毫秒的碎片会被并进邻居（本来就不该单独成段）；
     * 先滤再加，长段就会被拆成两个。合并后相邻区间首尾相接（A 暂停的同时 B 恢复），
     * 所以「一天上百次切换」最终只剩几条长段 —— 这正是用户看到的样子。
     */
    private fun mergeByPackage(raw: List<Span>): List<Span> {
        val byPkg = LinkedHashMap<String, MutableList<Span>>()
        for (span in raw) byPkg.getOrPut(span.pkg) { ArrayList() }.add(span)
        val out = ArrayList<Span>(raw.size)
        for ((pkg, list) in byPkg) {
            list.sortBy { it.from }
            var from = list[0].from
            var to = list[0].to
            for (next in list.drop(1)) {
                if (next.from <= to) {
                    if (next.to > to) to = next.to
                } else {
                    if (to - from >= MIN_SPAN_MS) out.add(Span(pkg, from, to))
                    from = next.from
                    to = next.to
                }
            }
            if (to - from >= MIN_SPAN_MS) out.add(Span(pkg, from, to))
        }
        out.sortBy { it.from }
        return out
    }

    /** 段列表 → 跨桥的扁平数组。元素是 `JSONObject`，走 `jsArrayOf` 那条已验证的路。 */
    private fun spansOf(spans: List<Span>): JSONArray {
        val out = JSONArray()
        for (span in spans) {
            val item = JSONObject()
            item.put("packageName", span.pkg)
            item.put("from", span.from)
            item.put("to", span.to)
            out.put(item)
        }
        return out
    }
}
