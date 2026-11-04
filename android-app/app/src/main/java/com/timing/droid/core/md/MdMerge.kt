package com.timing.droid.core.md

/**
 * 两端日记的**三方合并**（3-way merge）。
 *
 * ## 为什么不能简单地「文件优先」或「数据库优先」
 *
 * 桌面端原本是单机同步：以「上次写出的区块」为基线，二选一。但手机接进来之后，
 * 同一天可能两端各自记了不同的段落。任何「一边覆盖另一边」的策略都会丢数据：
 * 手机刚记的 30 分钟会被桌面刚写的区块抹掉，反之亦然。
 *
 * ## 该用哪三个版本
 *
 * | 记号 | 含义 |
 * |---|---|
 * | `base` | 上一次本机写出时的区块（= 两端都见过的那一版） |
 * | `local` | 本机数据库现在的样子 |
 * | `remote` | 日记文件现在的样子（可能被桌面端或用户改过） |
 *
 * 对每个 `(事项, 开始时刻)` 逐条判定：
 *
 * 1. `local == remote` → 取谁都一样（含两边都删了的情况）；
 * 2. `local == base` → 只有对面动过 → 取 `remote`（新增 / 修改 / 删除都会传导过来）；
 * 3. `remote == base` → 只有本机动过 → 取 `local`；
 * 4. 其余 → 两边都动了同一条，冲突。取 `remote`（文件优先）。
 *
 * 只有第 4 种会丢一边的改动。而 `(事项, 开始时刻)` 做键意味着「同一条记录被两端
 * 同时改」几乎不会发生——时段记录一旦落盘就是不可变的，用户也不会去手改秒数。
 *
 * ## 键为什么不用行的 `id`
 *
 * Planner 区块里没有 id（这是它既有的格式，桌面端也没埋）。而一个事项在同一毫秒
 * 开两次是不可能的，所以 `(事项, 开始时刻)` 是天然主键，且两端无需共享 id 空间。
 */
object MdMerge {

    /** 一条计时的身份：事项 + 开始时刻。 */
    data class Key(val item: String, val startMs: Long)

    /** 一条计时的事实部分。`sec` 是派生/展示值，不参与相等判定。 */
    data class Seg(val endMs: Long, val sec: Long)

    /**
     * 展平成「键 → 段」。
     *
     * **`ongoing` 的段一律丢弃**：它是桌面端「正在计时」的临时投影，每两秒就会变一次。
     * 让它参与比较会让基线永远抖动，两边不停地互相覆盖。它由调用方原样搬运，不参与合并。
     */
    fun flatten(entries: List<MdTimers.Entry>): Map<Key, Seg> {
        val out = LinkedHashMap<Key, Seg>()
        for (entry in entries) {
            for (interval in entry.intervals) {
                if (interval.ongoing) continue
                val key = Key(entry.item, interval.startMs)
                out[key] = Seg(interval.endMs, interval.durationSec ?: (interval.endMs - interval.startMs) / 1000)
            }
        }
        return out
    }

    /** 三方合并。`preferRemote` = 真冲突时文件优先。 */
    fun merge(
        base: Map<Key, Seg>,
        local: Map<Key, Seg>,
        remote: Map<Key, Seg>,
        preferRemote: Boolean = true,
    ): Map<Key, Seg> {
        val keys = LinkedHashSet<Key>()
        keys.addAll(base.keys)
        keys.addAll(local.keys)
        keys.addAll(remote.keys)

        val out = LinkedHashMap<Key, Seg>()
        for (key in keys) {
            val b = base[key]
            val l = local[key]
            val r = remote[key]
            val pick = when {
                l == r -> l
                l == b -> r
                r == b -> l
                else -> if (preferRemote) r else l
            }
            if (pick != null) out[key] = pick
        }
        return out
    }

    /** 把「键 → 段」还原成渲染用的结构（按事项分组、段内按开始时间升序）。 */
    fun toEntries(map: Map<Key, Seg>): List<MdTimers.Entry> {
        val grouped = LinkedHashMap<String, MutableList<Pair<Long, Seg>>>()
        for ((key, seg) in map) {
            grouped.getOrPut(key.item) { mutableListOf() }.add(key.startMs to seg)
        }
        return grouped.map { (item, list) ->
            MdTimers.Entry(
                item,
                list.sortedBy { it.first }
                    .map { (start, seg) -> MdTimers.Interval(start, seg.endMs, durationSec = seg.sec) }
                    .toMutableList(),
            )
        }.sortedBy { entry -> entry.intervals.minOf { it.startMs } }
    }

    /**
     * 渲染合并结果，并把远端仍在进行中的段**原样搬回**。
     *
     * `flatten` 会丢掉 `ongoing`（它每 2 秒变一次，参与比较会让基线永远抖动），
     * 但丢掉之后本机一写盘，桌面端正在计时的那一段就被抹掉了 —— 下一轮桌面又写回来，
     * 来回震荡。所以搬运是必须的：本机既不吞掉它，也不把它当成已完成记录落库。
     */
    fun renderMerged(
        merged: Map<Key, Seg>,
        remote: List<MdTimers.Entry>,
    ): String {
        val out = toEntries(merged).toMutableList()
        for (entry in remote) {
            for (interval in entry.intervals) {
                if (!interval.ongoing) continue
                val target = out.firstOrNull { it.item == entry.item }
                if (target != null) {
                    target.intervals.add(interval)
                } else {
                    out.add(MdTimers.Entry(entry.item, mutableListOf(interval)))
                }
            }
        }
        return MdTimers.render(out)
    }

    /**
     * 判断「是否需要写盘」时用的归一化形态：`parse` 后重新 `render`。
     *
     * 直接比原文会被**格式抖动**打成死循环：Obsidian 的 Linter / YAML 格式化插件
     * 会把 `duration: 30m` 改成 `duration: "30m"`、把缩进从 2 空格改成 4 空格。
     * 本机读进来一 render，就变回自己的写法，判定「文件变了」→ 写回 → 插件再改
     * → 再写回 …… Remotely Save 每一轮都上传一次，两端互相覆盖。
     *
     * 归一化之后，只有**事实层面**（哪个事项、几点开始、几点结束）的差异才算变化。
     */
    fun normalized(body: String): String = MdTimers.render(MdTimers.parse(body))

    /** 只有本机侧有的键（用于「该往数据库补哪些」）。 */
    fun addedKeys(before: Map<Key, Seg>, after: Map<Key, Seg>): Set<Key> {
        val out = LinkedHashSet<Key>()
        for ((key, seg) in after) if (before[key] != seg) out.add(key)
        return out
    }

    /** 合并后消失的键（用于「该软删哪些」）。 */
    fun removedKeys(before: Map<Key, Seg>, after: Map<Key, Seg>): Set<Key> {
        val out = LinkedHashSet<Key>()
        for (key in before.keys) if (after[key] == null) out.add(key)
        return out
    }
}
