package com.tickbar.droid.core.md

import android.content.Context
import com.tickbar.droid.core.Repo
import com.tickbar.droid.core.RepoNote
import java.time.LocalDate

/**
 * 便利贴那一轮的 Markdown 双向同步。
 *
 * 从 [MdSync] 拆出来，一是为了守住单文件 300 行，二是它和计时段的合并口径**根本不同**：
 * 计时段有天然键（事项 + 开始时刻），便利贴没有——只能靠「桌面发的号 + 内容」认人。
 *
 * ## 一次同步做四步
 * 1. 读三方：本机当天动过的便利贴 / 文件里的表格 / 上次本机写出的表格（基线）；
 * 2. 逐行认人：有号的按号认；没号的按「内容 + 事项」认（首次往返时桌面刚发号）；
 * 3. 双向落地：远端新的收进库、远端改过的覆盖库、远端删掉的软删库；
 * 4. 交出「该写成什么样」：**本函数不碰文件**，只把区块正文还给 [MdSync]，
 *    由它和计时区块合并后一次写盘（同一轮写两次文件等于让 Obsidian 看到两次改动，
 *    也把「桌面端同时写入」的窗口拉长一倍）。
 *
 * ## 为什么手机不带自己的号
 * 见 [MdNotes] 的类注释：桌面端遇到不认识的号会新建一行，手机一旦自己发号，
 * 两端就会无限增殖。
 */
object MdNotesSync {

    /**
     * 一轮的结果。
     *
     * - `changed`：收下 / 移除的便利贴张数；
     * - `nextBody`：便利贴区块**该写成的内容**，null 表示文件里那一块已经是最新的；
     * - `baseline`：这轮的规范形态（不管写不写都要记，作为下轮三方判定的锚点）；
     * - `skipped` / `failed`：整轮跳过 / 出错的原因。
     */
    data class Outcome(
        val changed: Int = 0,
        val nextBody: String? = null,
        val baseline: String = "",
        val skipped: String? = null,
        val failed: String? = null,
    )

    /**
     * @param text 已由 [MdSync] 读到的整篇日记。传进来而不是自己去读，
     *             是为了让一轮同步只做一次 SAF 读（那是整条链上最慢的一步）。
     */
    fun run(
        ctx: Context,
        text: String,
        from: Long,
        to: Long,
        date: LocalDate,
    ): Outcome {
        if (!Repo.ready) return Outcome(skipped = "本地库未就绪")

        val heading = MdCfg.notesHeading(ctx)
        val baseText = MdCfg.baseline(ctx, MdCfg.KIND_NOTES, date)
        val base = if (baseText == null) emptyList() else MdNotes.parse(baseText)
        val local = RepoNote.inDay(from, to)

        val body = MdSection.body(text, heading)
        if (body != null && MdNotes.looksTruncated(body)) {
            return Outcome(skipped = "日记似乎正在被写入，本轮跳过")
        }
        if (text.isBlank() && base.isNotEmpty()) {
            return Outcome(skipped = "日记似乎是空的，本轮跳过")
        }

        val remote = if (body == null) emptyList() else MdNotes.parse(body)
        val plan = plan(base, local, remote)

        // ---- 落地一：数据库（先绑定号，再写内容，否则按号找不到刚认领的那条）
        for ((id, syncId) in plan.bind) RepoNote.bindSyncId(id, syncId)
        for (row in plan.insert) RepoNote.upsertFromSync(toIncoming(row))
        for (row in plan.update) RepoNote.upsertFromSync(toIncoming(row))
        for (id in plan.remove) RepoNote.softDelete(id)

        // ---- 落地二：算出区块正文，交回 MdSync 合并写盘
        val nextBody = MdNotes.render(plan.rows)
        val normalizedRemote = if (body == null) "" else MdNotes.render(remote)
        val needWrite = body == null && nextBody.isNotEmpty() ||
            body != null && normalizedRemote != nextBody

        return Outcome(
            changed = plan.changed,
            nextBody = if (needWrite) nextBody else null,
            baseline = nextBody,
        )
    }

    // ------------------------------------------------------------ 合并

    /** 这一轮要做的事：库怎么改、文件写成什么样。 */
    internal class Plan(
        val bind: List<Pair<Long, String>> = emptyList(),
        val insert: List<MdNotes.Row> = emptyList(),
        val update: List<MdNotes.Row> = emptyList(),
        val remove: List<Long> = emptyList(),
        val rows: List<MdNotes.Row> = emptyList(),
        val changed: Int = 0,
    )

    /**
     * 三方合并。`deleted` 可注入，纯粹为了让这套判定能在没有 SQLite 的单测里跑
     * （它只回答一个问题：这个号对应的便利贴是不是被本机删掉了）。
     */
    internal fun plan(
        base: List<MdNotes.Row>,
        local: List<RepoNote.Note>,
        remote: List<MdNotes.Row>,
        deleted: (String) -> Boolean = RepoNote::isDeleted,
    ): Plan {
        val bySync = HashMap<String, RepoNote.Note>()
        val unbound = ArrayList<RepoNote.Note>()
        for (note in local) {
            if (note.syncId.isEmpty()) unbound.add(note) else bySync[note.syncId] = note
        }
        val baseBySync = HashMap<String, MdNotes.Row>()
        for (row in base) if (row.syncId.isNotEmpty()) baseBySync[row.syncId] = row

        val bind = ArrayList<Pair<Long, String>>()
        val insert = ArrayList<MdNotes.Row>()
        val update = ArrayList<MdNotes.Row>()
        val remove = ArrayList<Long>()
        val rows = ArrayList<MdNotes.Row>()
        /** 本地已被远端认领的 id，后面不再当「本机新增」重复处理 */
        val claimed = HashSet<Long>()
        var changed = 0

        for (row in remote) {
            val hit = claim(row, bySync, unbound, claimed)

            if (hit == null) {
                /* 本机删过这张（墓碑还在）→ 文件里这行算「该删的」，从输出里去掉。 */
                if (row.syncId.isNotEmpty() && deleted(row.syncId)) continue
                if (row.content.isBlank()) continue
                insert.add(row)
                rows.add(row)
                changed++
                continue
            }

            claimed.add(hit.id)
            val syncId = when {
                row.syncId.isNotEmpty() -> row.syncId
                else -> hit.syncId
            }
            if (row.syncId.isNotEmpty() && hit.syncId.isEmpty()) bind.add(hit.id to row.syncId)

            val sameContent = hit.content == row.content && (hit.itemName ?: "") == (row.item ?: "")
            when {
                sameContent -> rows.add(
                    MdNotes.Row(syncId, row.item, row.content, maxOf(row.updatedAt, hit.updatedAt), hit.id),
                )
                /* 远端更新：收下（最后写入者胜，与桌面「冲突最后写入者胜」一致） */
                row.updatedAt > hit.updatedAt -> {
                    update.add(MdNotes.Row(syncId, row.item, row.content, row.updatedAt, hit.id))
                    rows.add(MdNotes.Row(syncId, row.item, row.content, row.updatedAt, hit.id))
                    changed++
                }
                /* 本机更新：保留本机，靠写回文件让对面跟上 */
                else -> rows.add(MdNotes.Row(syncId, hit.itemName, hit.content, hit.updatedAt, hit.id))
            }
        }

        for (note in local) {
            if (claimed.contains(note.id) || note.content.isBlank()) continue
            val baseRow = if (note.syncId.isEmpty()) null else baseBySync[note.syncId]

            /* 基线里没有 = 本机这段时间新建的；有但本机改得更晚 = 远端删了而本机还在写。
               两种都写回文件（后者等于「复活」，宁可多留一条，也不静默吃掉用户刚打的字）。 */
            val keepLocal = baseRow == null || note.updatedAt > baseRow.updatedAt
            if (keepLocal) {
                rows.add(MdNotes.Row(note.syncId, note.itemName, note.content, note.updatedAt, note.id))
                continue
            }
            remove.add(note.id)
            changed++
        }

        return Plan(bind, insert, update, remove, rows, changed)
    }

    /**
     * 认人：先按号，再按「内容 + 事项」。
     *
     * 后一条只对**本机还没拿到号**的便利贴生效，命中的就是「本机写出去 → 桌面插入副本
     * 并发了号 → 这轮读回来」的那一条。内容相同但事项不同的不认，避免把两张便条
     * 绑成一对。
     */
    private fun claim(
        row: MdNotes.Row,
        bySync: Map<String, RepoNote.Note>,
        unbound: List<RepoNote.Note>,
        claimed: Set<Long>,
    ): RepoNote.Note? {
        if (row.syncId.isNotEmpty()) {
            bySync[row.syncId]?.let { return it }
        }
        if (row.content.isBlank()) return null
        return unbound.firstOrNull {
            !claimed.contains(it.id) &&
                it.content == row.content &&
                (it.itemName ?: "") == (row.item ?: "")
        }
    }

    private fun toIncoming(row: MdNotes.Row) = RepoNote.Incoming(
        syncId = row.syncId,
        itemName = row.item,
        content = row.content,
        updatedAt = if (row.updatedAt > 0L) row.updatedAt else System.currentTimeMillis(),
    )
}
