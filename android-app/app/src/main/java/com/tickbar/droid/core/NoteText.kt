package com.tickbar.droid.core

/**
 * 便利贴正文的纯文本编辑操作。
 *
 * **逐函数对齐桌面端 `src/lib/noteText.ts`**：同一个人在手机和电脑上写同一张便利贴，
 * 敲 `-` + 空格、敲回车续行、按缩进，得到的文本必须一模一样，否则两端来回复制粘贴时
 * 圆点和缩进会越变越乱。桌面那边有同一组用例（`noteText.test.ts`），改动要两边一起改。
 *
 * 全是纯函数：输入（文本, 选区）→ 输出（新文本, 新选区），不碰 View、不碰库，
 * 所以能在纯 JVM 单测里跑，不用连安卓设备。
 */
object NoteText {

    /** 一级缩进 = 2 个空格（桌面同值）。 */
    const val INDENT = "  "

    /** 圆点 + 一个空格（桌面同值）。 */
    const val BULLET = "• "

    /** 编辑结果：新文本 + 编辑后应落的选区。 */
    data class Edit(val text: String, val start: Int, val end: Int)

    /** [pos] 所在行的行首下标。 */
    fun lineStart(text: String, pos: Int): Int {
        val index = text.lastIndexOf('\n', pos - 1)
        return index + 1
    }

    /** [pos] 所在行的行尾下标（不含换行符）。 */
    fun lineEnd(text: String, pos: Int): Int {
        val index = text.indexOf('\n', pos)
        return if (index < 0) text.length else index
    }

    /**
     * 行首敲 `-` 后按空格：把破折号换成圆点 `• `。
     *
     * 不满足条件（不是行首那个孤零零的破折号）返回 null，交给键盘输入自己处理。
     */
    fun bulletizeOnSpace(text: String, start: Int, end: Int): Edit? {
        if (start != end) return null
        val head = text.substring(lineStart(text, start), start)
        if (!Regex("^\\s*-$").matches(head)) return null
        val bulletStart = start - 1
        val next = text.substring(0, bulletStart) + BULLET + text.substring(start)
        val caret = bulletStart + BULLET.length
        return Edit(next, caret, caret)
    }

    /**
     * 圆点行（`• `）按回车：续一行同样缩进的圆点。
     *
     * 圆点后面什么都没有时，回车表示「列表写完了」——把这个空圆点整段去掉，
     * 光标落在新的空行行首。不这样处理的话，用户永远退不出列表。
     */
    fun continueListOnEnter(text: String, start: Int, end: Int): Edit? {
        if (start != end) return null
        val from = lineStart(text, start)
        val current = text.substring(from, start)
        val match = Regex("^(\\s*)•\\s?").find(current) ?: return null
        if (match.range.first != 0) return null

        val indent = match.groupValues[1]
        val rest = current.substring(match.value.length)
        if (rest.isNotEmpty()) {
            val caret = start + 1 + indent.length + BULLET.length
            val next = text.substring(0, start) + "\n" + indent + BULLET + text.substring(start)
            return Edit(next, caret, caret)
        }
        val next = text.substring(0, from) + "\n" + text.substring(start)
        return Edit(next, from + 1, from + 1)
    }

    /**
     * 对选区覆盖的每一行加 / 减一级缩进。
     *
     * 手机上没 Tab 键，走编辑页底部那两个按钮；电脑上是 Tab / Shift+Tab。
     */
    fun indentSelection(text: String, start: Int, end: Int, outdent: Boolean): Edit {
        val from = lineStart(text, start)
        val to = lineEnd(text, end)

        var firstDelta = 0
        val lines = text.substring(from, to).split('\n')
        val nextLines = lines.mapIndexed { index, line ->
            if (outdent) {
                val strip = when {
                    line.startsWith(INDENT) -> INDENT.length
                    line.startsWith(" ") -> 1
                    else -> 0
                }
                if (index == 0) firstDelta = -strip
                line.substring(strip)
            } else {
                if (index == 0) firstDelta = INDENT.length
                INDENT + line
            }
        }

        val nextBlock = nextLines.joinToString("\n")
        val next = text.substring(0, from) + nextBlock + text.substring(to)
        val caret = maxOf(from, start + firstDelta)
        val caretEnd = maxOf(caret, end + (nextBlock.length - (to - from)))
        return Edit(next, caret, caretEnd)
    }

    /** 清单里显示的标题：正文首行，超长截断；没有正文算「未命名」（桌面同口径，18 字）。 */
    fun titleOf(content: String, max: Int = 18): String {
        val first = content.split('\n').firstOrNull()?.trim().orEmpty()
        if (first.isEmpty()) return "未命名便利贴"
        return if (first.length > max) first.substring(0, max) + "…" else first
    }

    /** 列表卡片第二行的时间：今天给 `HH:mm`，昨天给「昨天」，更早给 `M/d`。 */
    fun stampOf(ms: Long, now: Long = System.currentTimeMillis()): String {
        val zone = java.time.ZoneId.systemDefault()
        val day = java.time.Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
        val today = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        return when {
            day == today -> java.time.Instant.ofEpochMilli(ms).atZone(zone)
                .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
            day == today.minusDays(1) -> "昨天"
            else -> "${day.monthValue}/${day.dayOfMonth}"
        }
    }
}
