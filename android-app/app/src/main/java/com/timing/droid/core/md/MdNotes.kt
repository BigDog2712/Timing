package com.timing.droid.core.md

/**
 * 便利贴表格的渲染 / 解析。
 *
 * **逐字对齐桌面端 `src-tauri/src/services/md_sync/format/notes.rs`**：同一个日记文件
 * 会被两端读写，输出形状必须完全一致，否则「一端写 → 另一端看见差异 → 回写」会
 * 无限震荡，还会把 Obsidian Sync 拖进冲突副本。
 *
 * ~~~text
 * | 更新时间 | 事项 | 内容 |
 * |---|---|---|
 * | 2026-10-20 09:30:00 | 生活 | 买牛奶 <!-- tb-note:3 --> |
 * ~~~
 *
 * 三个约定（与桌面同一套）：
 * 1. 内容里的 `|` 转义成 `\|`，换行写成 `<br>`；
 * 2. 行尾 `<!-- tb-note:N -->` 的 N 是**桌面端数据库的行号**，用来认「这是同一张」；
 * 3. 没有 marker 的行 = 用户（或手机第一次写出）新加的行。
 *
 * ## 手机为什么不自己发号
 * 桌面端 `apply_notes` 的规则是：行上有 id 但本机查不到 → 当成用户新加的行**插入一条**。
 * 手机若写自己的自增 id，桌面会按这个号命中它自己那张毫不相干的便利贴并改掉内容；
 * 若写个桌面认不出的非数字标记，桌面每轮都当新行插入，两端越同步越多。
 * 唯一不改桌面端的办法：手机首次进文件时**不带号**，由桌面发号，下一轮记进 `sync_id`
 * 后原样回写（见 `RepoNote.bindSyncId`）。
 */
object MdNotes {

    /** 表格里的一行。`localId` = 安卓本地 notes.id（从文件读出来的行是 0）。 */
    data class Row(
        val syncId: String,
        val item: String?,
        val content: String,
        val updatedAt: Long,
        val localId: Long = 0L,
    )

    private const val MARKER = "tb-note:"

    // ------------------------------------------------------------ 渲染

    /** 渲染成区块内容（不含标题行）。没有内容时返回空串，不往日记里塞空表。 */
    fun render(rows: List<Row>): String {
        val valid = rows.filter { it.content.isNotBlank() }
        if (valid.isEmpty()) return ""

        /* 桌面按 (updated_ms, id) 升序：时间相同的几行顺序稳定，才不会每轮重排。 */
        val sorted = valid.sortedWith(
            compareBy({ it.updatedAt }, { it.syncId.toLongOrNull() ?: Long.MAX_VALUE }),
        )

        val out = StringBuilder()
        out.append("| 更新时间 | 事项 | 内容 |\n|---|---|---|\n")
        for (row in sorted) {
            val time = if (row.updatedAt > 0L) MdTimers.formatTs(row.updatedAt) else ""
            val item = row.item?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.replace("|", "\\|")
                ?.replace("\n", " ")
                ?.replace("\r", " ")
                ?: "—"
            var content = row.content.replace("|", "\\|").replace("\n", "<br>")
            if (row.syncId.isNotEmpty()) content += " <!-- $MARKER${row.syncId} -->"
            out.append("| ").append(time).append(" | ").append(item).append(" | ")
                .append(content).append(" |\n")
        }
        return out.toString().trimEnd()
    }

    // ------------------------------------------------------------ 解析

    /** 解析区块内容。表头、分隔行、缺列的行、空行都跳过（与桌面同一套宽容度）。 */
    fun parse(body: String): List<Row> {
        val out = ArrayList<Row>()
        for (raw in body.split('\n')) {
            val line = raw.trim()
            if (!line.startsWith("|")) continue
            val cells = splitRow(line)
            if (cells.size < 3) continue
            if (cells[0].contains("更新时间")) continue
            if (cells.all { cell -> cell.all { it == '-' || it == ':' } }) continue
            if (cells.all { it.isEmpty() }) continue

            val (content, syncId) = stripMarker(cells[2])
            val text = content
                .replace("<br/>", "\n")
                .replace("<br />", "\n")
                .replace("<br>", "\n")
                .trim()
            if (text.isEmpty() && syncId.isEmpty()) continue

            out.add(
                Row(
                    syncId = syncId,
                    item = normalizeItem(cells[1]),
                    content = text,
                    updatedAt = MdTimers.parseTs(cells[0]) ?: 0L,
                ),
            )
        }
        return out
    }

    /**
     * 这段内容像不像「读到半截」。
     *
     * 与计时段不同，便利贴这里是表格：**表格行必须以 `|` 收尾**。SAF 的就地截断写
     * 经常断在半个单元格中间，那种行不以 `|` 结尾，是最好认的信号。
     * 判到可疑就整轮跳过——半截表格里少的行会被三方合并判成「用户删了」，然后删库。
     */
    fun looksTruncated(body: String): Boolean {
        if (body.contains('\uFFFD')) return true
        for (raw in body.split('\n')) {
            val line = raw.trim()
            if (line.startsWith("|") && !line.endsWith("|")) return true
        }
        return false
    }

    // ------------------------------------------------------------ 私有

    /** 按未转义的 `|` 切表格行；`\|` 还原成普通竖线（桌面 `split_row` 同实现）。 */
    private fun splitRow(line: String): List<String> {
        val trimmed = line.trim().trim('|')
        val cells = ArrayList<String>()
        val current = StringBuilder()
        var i = 0
        while (i < trimmed.length) {
            val ch = trimmed[i]
            if (ch == '\\' && i + 1 < trimmed.length && trimmed[i + 1] == '|') {
                current.append('|')
                i += 2
                continue
            }
            if (ch == '|') {
                cells.add(current.toString().trim())
                current.setLength(0)
            } else {
                current.append(ch)
            }
            i++
        }
        cells.add(current.toString().trim())
        return cells
    }

    /** 去掉行尾 `<!-- tb-note:12 -->`，返回 `(正文, 号)`。 */
    private fun stripMarker(cell: String): Pair<String, String> {
        /* 从最后一个注释找起：正文里可能本来就有 `<!-- ... -->`，不能把第一个当成号。 */
        val start = cell.lastIndexOf("<!--")
        if (start < 0) return cell to ""
        val marker = cell.substring(start).trimEnd()
        val inner = marker.removePrefix("<!--").removeSuffix("-->")
        if (inner == marker) return cell to ""
        val id = inner.trim().removePrefix(MARKER).trim()
        if (id == inner.trim() || id.toLongOrNull() == null) return cell to ""
        return cell.substring(0, start) to id
    }

    private fun normalizeItem(raw: String): String? {
        val value = raw.trim()
        return if (value.isEmpty() || value == "—" || value == "-") null else value
    }
}
