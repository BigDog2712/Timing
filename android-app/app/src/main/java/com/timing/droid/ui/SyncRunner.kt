package com.timing.droid.ui

import android.app.Activity
import android.os.Handler
import android.os.Looper
import com.timing.droid.core.md.MdCfg
import com.timing.droid.core.md.MdSync

/**
 * 同步执行器：后台线程、单轮互斥、撞车回调排队、前台节拍，全在这里。
 *
 * 从 `MainActivity` 抽出来有两个原因：外壳已经贴着单文件 300 行的线；而这几件事凑在一起
 * 自成一体，混在 Activity 里既读不清也不好单独验。
 *
 * ## 为什么撞车的回调要排队而不是丢掉
 * 设置页点「立即同步」会先把文案写成「同步中…」，等回调再改回真实结果。撞上正在跑的那轮
 * 时如果直接 return，那句文案就再没有人改回来 —— 界面会永久停在「同步中」。
 *
 * ## 为什么互斥是硬的
 * SAF 并发两轮会让「基线」互相覆盖（两轮都拿同一份旧基线判冲突），比晚 20 秒看到结果糟得多。
 */
class SyncRunner(
    private val a: Activity,
    /** 真的从文件收下了数据才回调：每 20 秒无条件刷新会把列表滚动位置重置。 */
    private val onPulled: () -> Unit,
) {

    /** 与节拍器共用一个 Handler：起停由 Activity 的生命周期统一管。 */
    private val handler = Handler(Looper.getMainLooper())

    private var syncing = false

    /** 撞车时等结果的回调，本轮结束时统一回填。 */
    private val pending = mutableListOf<(MdSync.Report) -> Unit>()

    /** 前台节拍：按「上一轮结果」排下一次，连续失败逐级退避（见 [SyncTicker]）。 */
    private val ticker = SyncTicker(handler) { done -> request(done) }

    /** 回前台：立刻同步一次，之后交给节拍器。 */
    fun start() = ticker.start()

    /** 切后台：停表。 */
    fun stop() = ticker.stop()

    fun request(onDone: ((MdSync.Report) -> Unit)? = null) {
        if (!MdCfg.enabled(a) || !MdCfg.configured(a)) {
            onDone?.invoke(MdSync.Report(MdSync.Action.NONE, "同步未配置"))
            return
        }
        if (syncing) {
            onDone?.let { pending.add(it) }
            return
        }
        syncing = true
        Thread {
            val report = runCatching { MdSync.sync(a) }.getOrElse {
                MdSync.Report(MdSync.Action.ERROR, "同步异常：${it.message}")
            }
            a.runOnUiThread {
                /* 收尾放 finally：主回调（设置页那串 View 操作）或页面刷新都可能抛，
                   队列若没被清掉，下一轮的 report 会被回填给这一批老回调 —— 那正是
                   「跨轮错配」：界面显示的是上一轮的结果，用户以为刚同步过了。
                   页面刷新与主回调各自 runCatching：一个抛了不影响另一个，也不影响收尾。 */
                try {
                    runCatching { onDone?.invoke(report) }
                    val pulled = report.action == MdSync.Action.PULLED ||
                        report.action == MdSync.Action.BOTH
                    if (pulled) runCatching { onPulled() }
                } finally {
                    syncing = false
                    if (pending.isNotEmpty()) {
                        val queued = pending.toList()
                        pending.clear()
                        queued.forEach { cb -> runCatching { cb(report) } }
                    }
                }
            }
        }.start()
    }
}
