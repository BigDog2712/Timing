package com.tickbar.droid.core.md

import android.content.Context
import com.tickbar.droid.core.Days
import com.tickbar.droid.core.Repo
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Markdown 双向同步的编排层。
 *
 * 一次同步做三件事，顺序不能换：
 *
 * 1. **读三方**：本机库（local）、日记文件（remote）、上次本机写出的内容（base）；
 * 2. **合并**（[MdMerge]）——按 `(事项, 开始时刻)` 逐条三方判定，两边的改动都留下；
 * 3. **双向落地**：合并结果既写回数据库，也写回日记（只在真的不同时才写）。
 *
 * 与桌面端 `services/md_sync` 的差别只有一处，而且是刻意的：桌面端是**二选一**
 * （SQL 变 → 导出，文件变 → 导入），因为它假设只有一个写入者。手机接进来之后，
 * 同一天会有两个写入者，二选一必然丢数据，所以这里升级成三方合并。
 *
 * ## 只同步「当天」
 *
 * `base` 是按天存的，跨天合并需要连历史基线一起搬，v1 不做。所以：
 * 打开 App 时同步今天，历史日期靠桌面端照常维护。
 */
object MdSync {

    enum class Action { NONE, PULLED, PUSHED, BOTH, ERROR }

    data class Report(val action: Action, val message: String, val path: String = "") {
        val ok: Boolean get() = action != Action.ERROR
    }

    private val CLOCK = DateTimeFormatter.ofPattern("HH:mm")

    fun sync(ctx: Context, now: Long = System.currentTimeMillis()): Report {
        val stamp = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).format(CLOCK)

        fun done(report: Report): Report {
            MdCfg.setLastStatus(ctx, "${report.message} · $stamp")
            return report
        }

        if (!MdCfg.enabled(ctx)) return done(Report(Action.NONE, "同步未开启"))
        if (!MdCfg.configured(ctx)) return done(Report(Action.ERROR, "还没选择 Obsidian 目录"))
        if (!Repo.ready) return done(Report(Action.ERROR, "本地库未就绪"))

        val vault = SafVault.open(ctx, MdCfg.treeUri(ctx))
            ?: return done(Report(Action.ERROR, "目录授权已失效，请重新选择"))

        val date = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).toLocalDate()
        val from = Days.startOfDay(now)
        val to = Days.addDays(from, 1)
        val relPath = MdCfg.expand(MdCfg.fileTemplate(ctx), date)
        val heading = MdCfg.heading(ctx)

        // ---- 本机侧
        val localRecs = Repo.recordsForDay(from, to)
        val localMap = LinkedHashMap<MdMerge.Key, MdMerge.Seg>()
        val idOf = HashMap<MdMerge.Key, Long>()
        for (rec in localRecs) {
            val key = MdMerge.Key(rec.item, rec.startedAt)
            localMap[key] = MdMerge.Seg(rec.endedAt, rec.sec)
            idOf[key] = rec.id
        }

        // ---- 基线与远端
        val baseText = MdCfg.baseline(ctx, MdCfg.KIND_TIMERS, date)
        val baseMap = if (baseText == null) {
            emptyMap()
        } else {
            MdMerge.flatten(MdTimers.parse(baseText))
        }

        var node = vault.findFile(relPath)
        if (node == null) {
            /* 本机没数据、也没有基线 → 不凭空在 vault 里造一篇空日记 */
            if (localMap.isEmpty() && baseMap.isEmpty()) {
                return done(Report(Action.NONE, "无变化", relPath))
            }
            node = vault.ensureFile(relPath)
                ?: return done(Report(Action.ERROR, "无法创建日记文件", relPath))
        }

        val text = vault.readText(node)
            ?: return done(Report(Action.ERROR, "读取日记失败", relPath))
        val currentBody = MdSection.body(text, heading)

        /*
         * 读到半截就整轮跳过。
         *
         * 同步插件（Remotely Save）下载、Obsidian 自己重写、本应用写入，都可能让文件
         * 短暂处于「写了一半」的状态。半截文件里少的条目在三方合并里会被判成「用户删了」，
         * 于是本机跟着删库 —— 这是这个方案唯一会真丢数据的地方，必须挡死。
         *
         * 整篇为空单独判：用户删区块会留下标题和正文，不可能把整篇清成空文件。
         */
        val truncated = currentBody != null && MdTimers.looksTruncated(currentBody)
        val emptied = text.isBlank() && baseMap.isNotEmpty()
        if (truncated || emptied) {
            return done(Report(Action.NONE, "日记似乎正在被写入，本轮跳过", relPath))
        }

        val remoteEntries = MdTimers.parse(currentBody ?: "")
        val remoteMap = MdMerge.flatten(remoteEntries)

        // ---- 合并
        val merged = MdMerge.merge(baseMap, localMap, remoteMap)

        // ---- 落地一：数据库
        var changed = 0
        for (key in MdMerge.addedKeys(localMap, merged)) {
            val seg = merged[key] ?: continue
            Repo.upsertRecord(key.item, key.startMs, seg.endMs, seg.sec)
            changed++
        }
        var removed = 0
        for (key in MdMerge.removedKeys(localMap, merged)) {
            val id = idOf[key] ?: continue
            Repo.remove(id)
            removed++
        }

        // ---- 落地二：日记（进行中的实时段原样带上，不参与合并）
        val nextBody = MdMerge.renderMerged(merged, remoteEntries)
        /* 用归一化形态比较：只有「事实」变了才写盘，顶得住 Linter 之类的格式重排。 */
        val needWrite = currentBody == null ||
            MdMerge.normalized(currentBody) != MdMerge.normalized(nextBody)
        if (needWrite) {
            val nextText = if (currentBody == null) {
                MdSection.append(text, heading, nextBody)
            } else {
                MdSection.replace(text, heading, nextBody)
            }
            runCatching { vault.writeText(node, nextText) }
                .onFailure { return done(Report(Action.ERROR, "写日记失败：${it.message}", relPath)) }
        }

        /* 基线永远存「不含 ongoing」的版本：ongoing 每两秒变一次，存进来会让基线永远抖动。 */
        MdCfg.setBaseline(ctx, MdCfg.KIND_TIMERS, date, MdTimers.render(MdMerge.toEntries(merged)))

        val parts = ArrayList<String>()
        if (changed > 0) parts.add("收下 $changed 段")
        if (removed > 0) parts.add("移除 $removed 段")
        if (needWrite) parts.add("写入日记")
        if (parts.isEmpty()) return done(Report(Action.NONE, "无变化", relPath))

        val action = when {
            changed > 0 || removed > 0 -> if (needWrite) Action.BOTH else Action.PULLED
            else -> Action.PUSHED
        }
        return done(Report(action, parts.joinToString("、"), relPath))
    }
}
