package com.timing.droid.core.md

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 计时区块的渲染 / 解析（Planner 兼容格式）。
 *
 * **逐字对齐桌面端 `src-tauri/src/services/md_sync/format.rs`**。同一个日记文件被两端
 * 读写，输出形状必须完全一致，否则「一端写 → 另一端看见差异 → 回写」会无限震荡，
 * 并把 Obsidian Sync 拖进冲突副本。
 *
 * ~~~text
 * - [ ] 事项名
 *   ```yaml
 *   planner:
 *     log:
 *       - start: 2026-10-14 00:30:51
 *         end: 2026-10-14 01:07:41
 *         duration: 36m50s
 *   ```
 * ~~~
 *
 * 三个约定：
 * 1. 解析只认 `- [ ]` / `- [x]` 清单项与 `start:` / `end:`，区块内其他文字当注释忽略；
 * 2. `duration:` 是给人看的派生值，**不参与落库**（落库只认 start/end）；
 * 3. `ongoing: true` 是「宿主正在计时」的标记，导入侧要跳过它，导出侧要原样保留它
 *    ——否则本机会把桌面端刚写出的实时段抹掉，下一轮桌面又写回来，来回抖动。
 */
object MdTimers {

    private val TS_FULL = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
    private val TS_MINUTE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
    private val TS_SLASH = DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss")

    /** 一段计时（epoch ms）。[ongoing] 为 true 时 [endMs] 只是渲染近似值，不是事实。 */
    data class Interval(
        val startMs: Long,
        val endMs: Long,
        val ongoing: Boolean = false,
        val durationSec: Long? = null,
    )

    /** 一个事项名下的若干段。 */
    data class Entry(val item: String, val intervals: MutableList<Interval> = mutableListOf())

    // ------------------------------------------------------------ 渲染

    /** 渲染成区块内容（不含标题行）。没有有效段时返回空串，不往日记里塞空区块。 */
    fun render(entries: List<Entry>): String {
        val sorted = entries
            .filter { it.intervals.isNotEmpty() }
            .sortedBy { entry -> entry.intervals.minOf { it.startMs } }

        val out = StringBuilder()
        for (entry in sorted) {
            out.append("- [ ] ").append(sanitizeName(entry.item)).append('\n')
            out.append("  ```yaml\n")
            out.append("  planner:\n")
            out.append("    log:\n")
            for (interval in entry.intervals.sortedBy { it.startMs }) {
                out.append("      - start: ").append(formatTs(interval.startMs)).append('\n')
                out.append("        end: ").append(formatTs(interval.endMs)).append('\n')
                interval.durationSec?.let {
                    out.append("        duration: ").append(formatDuration(it)).append('\n')
                }
                if (interval.ongoing) out.append("        ongoing: true\n")
            }
            out.append("  ```\n")
        }
        return out.trimEnd().toString()
    }

    // ------------------------------------------------------------ 解析

    /** 解析区块内容。没有有效 start/end 的清单项会被丢弃。 */
    fun parse(body: String): List<Entry> {
        val entries = ArrayList<Entry>()
        var current: Int? = null
        var pendingStart: Long? = null
        var pendingIndex: Int? = null

        for (raw in body.split('\n')) {
            val line = raw.trim()
            if (line.startsWith("#")) {
                current = null
                pendingStart = null
                pendingIndex = null
                continue
            }
            val name = checkboxName(line)
            if (name != null) {
                val clean = sanitizeName(name)
                if (clean.isEmpty()) {
                    current = null
                    continue
                }
                val index = entries.indexOfFirst { it.item == clean }
                if (index >= 0) {
                    current = index
                } else {
                    entries.add(Entry(clean))
                    current = entries.size - 1
                }
                pendingStart = null
                pendingIndex = null
                continue
            }
            val index = current ?: continue

            val startValue = yamlValue(line, "start:")
            if (startValue != null) {
                pendingStart = parseTs(startValue)
                pendingIndex = null
                continue
            }
            val endValue = yamlValue(line, "end:")
            if (endValue != null) {
                val start = pendingStart ?: continue
                pendingStart = null
                val end = parseTs(endValue) ?: continue
                if (end > start) {
                    entries[index].intervals.add(Interval(start, end))
                    pendingIndex = entries[index].intervals.size - 1
                }
                continue
            }
            val durationValue = yamlValue(line, "duration:")
            if (durationValue != null) {
                /* 只认紧跟在 end: 之后的那一段；不消费 pendingIndex，后面可能还有 ongoing: */
                pendingIndex?.let { position ->
                    entries[index].intervals[position] =
                        entries[index].intervals[position].copy(
                            durationSec = parseDuration(durationValue),
                        )
                }
                continue
            }
            val ongoingValue = yamlValue(line, "ongoing:")
            if (ongoingValue != null) {
                val position = pendingIndex
                if (position != null) {
                    pendingIndex = null
                    if (ongoingValue.trim() in listOf("true", "yes", "1")) {
                        entries[index].intervals[position] =
                            entries[index].intervals[position].copy(ongoing = true)
                    }
                }
            }
        }

        return entries
            .filter { it.intervals.isNotEmpty() }
            .onEach { entry -> entry.intervals.sortBy { it.startMs } }
            .sortedBy { entry -> entry.intervals.minOf { it.startMs } }
    }

    /** 清掉派生值（落库前调用）：`duration` 不参与事实。 */
    fun stripDurations(entries: List<Entry>): List<Entry> = entries.map { entry ->
        entry.copy(intervals = entry.intervals.map { it.copy(durationSec = null) }.toMutableList())
    }

    /**
     * 这段内容像不像「读到半截」。
     *
     * SAF 的 `openOutputStream(uri, "wt")` 是**就地截断写**，不是原子替换。同步插件
     * （Remotely Save）下载、Obsidian 自身重写、本应用写入，三方随时可能撞在一起，
     * 于是「读到半个文件」是真实存在的窗口。
     *
     * 后果比看起来严重：半截文件里少掉的条目，在三方合并里会被判定成「用户删了」，
     * 于是本机跟着删库。所以读到可疑内容时必须**整轮跳过**，宁可晚一轮，不能删错。
     *
     * 判据都是精确的，不会误伤用户的正常编辑：
     * - 非法 UTF-8（截断在中文多字节字符中间）→ 解码后出现替换字符；
     * - 代码围栏 ` ``` ` 不成对 → 必然断在某个块内部；
     * - 整篇为空另有判据（由调用方比对基线判断）。
     */
    fun looksTruncated(body: String): Boolean {
        if (body.contains('\uFFFD')) return true
        val fences = body.lineSequence().count { it.trim().startsWith("```") }
        return fences % 2 != 0
    }

    // ------------------------------------------------------------ 时间

    fun formatTs(ms: Long): String =
        LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault()).format(TS_FULL)

    /** 宽松解析：`yyyy-MM-dd HH:mm:ss` / `yyyy-MM-dd HH:mm` / `yyyy/MM/dd HH:mm:ss`。 */
    fun parseTs(raw: String): Long? {
        val value = raw.trim().trim('"').trim('\'').trim()
        if (value.isEmpty()) return null
        for (formatter in listOf(TS_FULL, TS_MINUTE, TS_SLASH)) {
            try {
                val local = LocalDateTime.parse(value, formatter)
                return local.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            } catch (_: Exception) {
                // 换下一种格式
            }
        }
        return null
    }

    /** 向下对齐到整分钟（进行中的段用它当 end，避免每 2 秒重写一次日记）。 */
    fun floorToMinute(ms: Long): Long = Math.floorDiv(ms, 60_000L) * 60_000L

    /** `1h34m20s` / `46m06s` / `45s`。纯展示，不参与任何时间计算。 */
    fun formatDuration(sec: Long): String {
        val total = sec.coerceAtLeast(0)
        val hours = total / 3600
        val minutes = (total % 3600) / 60
        val seconds = total % 60
        val out = StringBuilder()
        if (hours > 0) out.append(hours).append('h')
        if (minutes > 0 || hours > 0) out.append(String.format("%02dm", minutes))
        if (seconds > 0 || out.isEmpty()) {
            if (out.isEmpty()) out.append(seconds).append('s')
            else out.append(String.format("%02ds", seconds))
        }
        return out.toString()
    }

    /** [formatDuration] 的逆；认不出来返回 null（渲染时就不写这一行）。 */
    fun parseDuration(raw: String): Long? {
        val value = raw.trim().trim('"').trim('\'').trim()
        if (value.isEmpty()) return null
        value.toLongOrNull()?.let { return it.coerceAtLeast(0) }

        var total = 0L
        var digits = StringBuilder()
        var units = 0
        for (ch in value) {
            if (ch.isDigit()) {
                digits.append(ch)
                continue
            }
            val factor = when (ch.lowercaseChar()) {
                'h' -> 3600L
                'm' -> 60L
                's' -> 1L
                else -> return null
            }
            val count = digits.toString().toLongOrNull() ?: return null
            digits = StringBuilder()
            total += count * factor
            units++
        }
        if (digits.isNotEmpty() || units == 0) return null
        return total
    }

    // ------------------------------------------------------------ 私有

    private fun yamlValue(line: String, key: String): String? {
        val rest = line.removePrefix("- ")
        return if (rest.startsWith(key)) rest.substring(key.length) else null
    }

    private fun checkboxName(line: String): String? {
        for (prefix in listOf("- [ ]", "- [x]", "- [X]", "* [ ]", "* [x]", "* [X]")) {
            if (line.startsWith(prefix)) return line.substring(prefix.length)
        }
        return null
    }

    private fun sanitizeName(raw: String): String = raw.replace("\n", " ").replace("\r", " ").trim()
}
