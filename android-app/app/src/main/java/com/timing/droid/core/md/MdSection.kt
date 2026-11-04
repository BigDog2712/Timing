package com.timing.droid.core.md

/**
 * Markdown 区块的「外科手术」：只替换目标标题下的那一段，其余字节原样保留。
 *
 * 日记里除了 Timing 的区块还有大量用户手写内容，所以同步不能整篇重写。
 *
 * **本文件是桌面端 `src-tauri/src/infra/md_file.rs` 的逐行对应实现**：
 * 标题匹配、区块边界、追加位置、尾换行规则全部一致，两边改一处必须同步另一处，
 * 否则同一个文件会被两端改出不同形状，Obsidian Sync 就会不断产生冲突副本。
 *
 * 规则：
 * - 标题行必须符合 CommonMark（`#### 事项计时`，`#` 后跟空格才算标题）；
 * - 区块结束于**下一个等级 ≤ 当前等级的标题**，所以区块内允许更深的子标题；
 * - 行尾空白不敏感，标题文本区分大小写。
 */
object MdSection {

    /** 取出标题下的内容（不含标题行）。找不到标题返回 null，不伪造空串。 */
    fun body(text: String, heading: String): String? {
        val lines = text.split('\n')
        val found = findHeading(lines, heading) ?: return null
        val end = sectionEnd(lines, found.first, found.second)
        return lines.subList(found.first + 1, end).joinToString("\n").trim('\n')
    }

    /** 用 [body] 替换标题下的内容；标题不存在时追加到文末。 */
    fun replace(text: String, heading: String, body: String): String {
        val lines = text.split('\n')
        val found = findHeading(lines, heading) ?: return append(text, heading, body)
        val end = sectionEnd(lines, found.first, found.second)

        val out = ArrayList<String>(lines.size + 8)
        for (i in 0..found.first) out.add(lines[i])
        val trimmed = body.trimEnd()
        if (trimmed.isEmpty()) out.add("") else out.addAll(trimmed.split('\n'))
        for (i in end until lines.size) out.add(lines[i])

        var joined = out.joinToString("\n")
        if (!joined.endsWith("\n")) joined += "\n"
        return joined
    }

    /** 在文末追加一节（用于标题不存在 / 新文件）。 */
    fun append(text: String, heading: String, body: String): String {
        val out = StringBuilder(text.trimEnd())
        if (out.isNotEmpty()) out.append("\n\n")
        out.append(heading.trim()).append('\n')
        val trimmed = body.trimEnd()
        if (trimmed.isNotEmpty()) out.append(trimmed).append('\n')
        return out.toString()
    }

    /** 这一行是不是标题；是则返回等级（1–6），否则 null。 */
    fun headingLevel(line: String): Int? {
        val trimmed = line.trimStart()
        val level = trimmed.takeWhile { it == '#' }.length
        if (level !in 1..6) return null
        val rest = trimmed.substring(level)
        return if (rest.isEmpty() || rest.startsWith(' ') || rest.startsWith('\t')) level else null
    }

    /** 返回 `(标题行下标, 等级)`。 */
    private fun findHeading(lines: List<String>, heading: String): Pair<Int, Int>? {
        val target = heading.trim()
        lines.forEachIndexed { index, line ->
            if (line.trim() == target) {
                val level = headingLevel(line)
                if (level != null) return index to level
            }
        }
        return null
    }

    /** 区块结束行：下一个等级 ≤ 当前等级的标题；没有则到文件末尾。 */
    private fun sectionEnd(lines: List<String>, headIndex: Int, level: Int): Int {
        for (i in headIndex + 1 until lines.size) {
            val next = headingLevel(lines[i])
            if (next != null && next <= level) return i
        }
        return lines.size
    }
}
