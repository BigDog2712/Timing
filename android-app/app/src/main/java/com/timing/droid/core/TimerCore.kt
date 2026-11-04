package com.timing.droid.core

import android.os.SystemClock

/**
 * 计时内核 —— 全部业务状态的唯一来源。
 *
 * 三条原则：
 *  1. **时钟可注入**：生产用 `SystemClock.elapsedRealtime()`（单调，用户改系统时间不影响时长），
 *     单测注入手推的假时钟；墙钟（`clockMs`）只用于「这条记录属于哪一天」。
 *  2. **不在内核里起 Timer**：谁要刷新谁自己 tick（悬浮层 500ms、首页 250ms），
 *     内核只做「读的时候把时间推进到 now」。
 *  3. **落库走 [Store] 接口**：内核不 import 任何 SQLite 类，纯 JVM 可测。
 *
 * 今日记录是内存里的镜像，权威数据在库里；跨零点时自动换一天。
 */
object TimerCore {

    enum class Phase { IDLE, RUNNING, PAUSED, DONE }
    enum class Mode { STOPWATCH, COUNTDOWN }

    /** 持久化出口。安卓实现在 [Repo]，单测里塞假实现。 */
    interface Store {
        fun loadDay(dayStart: Long): List<Session>
        fun save(s: Session): Long
        fun remove(id: Long)
    }

    /** 不可变快照：UI 只读它，不直接改内核字段。 */
    data class Snapshot(
        val phase: Phase = Phase.IDLE,
        val mode: Mode = Mode.STOPWATCH,
        val item: String = "专注",
        val elapsed: Long = 0L,
        val target: Long = 0L,
    ) {
        val remain: Long get() = (target - elapsed).coerceAtLeast(0L)

        /** 界面上显示哪个数字：倒计时显示剩余，正计时显示已用。 */
        val display: Long get() = if (mode == Mode.COUNTDOWN) remain else elapsed

        val active: Boolean get() = phase == Phase.RUNNING || phase == Phase.PAUSED
        val urgent: Boolean get() = mode == Mode.COUNTDOWN && active && remain <= 60_000L
    }

    /** 一条已结束的记录。`id = 0` 表示还没落库（或库没就绪）。 */
    data class Session(
        val item: String,
        val ms: Long,
        val endedAt: Long,
        val completed: Boolean,
        val id: Long = 0L,
    )

    // ------------------------------------------------------------ 悬浮圆点几何
    // 纯函数放在内核而不是 PillView：角度是时间语义，错了要到真机才看得出来，JVM 测得到。

    /**
     * 进度弧的比例。
     * 倒计时 = 剩余比例（从满圈往回退，分钟级）；正计时 = 60 秒一圈循环，纯「还活着」的动感。
     */
    fun arcFraction(s: Snapshot): Float = when {
        s.mode == Mode.COUNTDOWN && s.target > 0L -> s.remain.toFloat() / s.target.toFloat()
        s.phase == Phase.IDLE -> 0f
        else -> (s.elapsed % 60_000L) / 60_000f
    }

    /**
     * 时针的比例 —— 分针语义：正计时 60 分钟转一圈（每分钟走 6°，一分钟跳一格），
     * 倒计时跟弧同比例（剩多少，针就指哪儿）。第一版误写成秒环，一分钟就转满一圈，太快。
     */
    fun needleFraction(s: Snapshot): Float = when {
        s.mode == Mode.COUNTDOWN && s.target > 0L -> s.remain.toFloat() / s.target.toFloat()
        s.phase == Phase.IDLE -> 0f
        else -> (s.elapsed / 60_000L % 60L) / 60f
    }

    private var snap = Snapshot()
    private var banked = 0L   // 暂停前累计的时长
    private var anchor = 0L   // 本段起点（elapsedRealtime）；0 = 没在跑

    private val watchers = LinkedHashSet<(Snapshot) -> Unit>()

    /** 今日记录，新的在前。是库里的镜像，不是权威。 */
    val sessions = mutableListOf<Session>()

    /** 最近一条，供「3 秒撤销条」使用。 */
    var lastSession: Session? = null
        private set

    /** 低于该时长不计入记录（MainActivity 启动时从 Prefs 灌进来）。 */
    var minRecordMs: Long = 30_000L

    /** 持久化出口，null = 纯内存模式（单测默认如此）。 */
    var store: Store? = null

    /**
     * 可替换的单调时钟。生产环境用 `elapsedRealtime`（用户改系统时间不影响时长），
     * 单测注入一个手动推进的假时钟。
     */
    var clock: () -> Long = { SystemClock.elapsedRealtime() }

    /** 可替换的墙钟，只用来判断「哪一天」。 */
    var clockMs: () -> Long = { System.currentTimeMillis() }

    private var dayStart = 0L
    private var dayCheckedAt = 0L

    // ---------------------------------------------------------------- 订阅

    fun observe(watcher: (Snapshot) -> Unit): () -> Unit {
        watchers.add(watcher)
        watcher(snap)
        return { watchers.remove(watcher) }
    }

    private fun emit() {
        val s = snap
        watchers.toList().forEach { it(s) }
    }

    // ---------------------------------------------------------------- 读

    /**
     * 取当前快照，顺便把时间推进到 now、顺便检查是否跨零点。
     * 倒计时跑到 0 会在这里当场收口（桌面口径：到点恒结束并保存，没有「到点继续」的开关）。
     */
    fun current(): Snapshot {
        rollIfNeeded()
        if (anchor == 0L) return snap
        val elapsed = banked + (clock() - anchor)
        if (snap.mode == Mode.COUNTDOWN && elapsed >= snap.target) {
            banked = snap.target
            anchor = 0L
            snap = snap.copy(elapsed = snap.target, phase = Phase.DONE)
            record(snap.target, completed = true)
            emit()
            return snap
        }
        if (elapsed != snap.elapsed) snap = snap.copy(elapsed = elapsed)
        return snap
    }

    fun todayTotalMs(): Long = sessions.sumOf { it.ms }

    fun byItem(): List<Pair<String, Long>> =
        sessions.groupBy { it.item }
            .map { (k, v) -> k to v.sumOf { it.ms } }
            .sortedByDescending { it.second }

    /** 今日里出现过的事项名，新的在前，供「换事项」列表用。 */
    fun recentItems(): List<String> = sessions.map { it.item }.distinct().take(8)

    // ---------------------------------------------------------------- 写

    fun start(item: String = snap.item) = reset(Phase.RUNNING, Mode.STOPWATCH, item, 0L)

    fun startCountdown(minutes: Int, item: String = snap.item) {
        val total = minutes.coerceIn(1, 600) * 60_000L
        reset(Phase.RUNNING, Mode.COUNTDOWN, item, total)
    }

    fun toggle() {
        when (snap.phase) {
            Phase.RUNNING -> pause()
            Phase.PAUSED -> resume()
            Phase.IDLE, Phase.DONE -> start()
        }
    }

    fun pause() {
        if (snap.phase != Phase.RUNNING) return
        val s = current()
        if (s.phase != Phase.RUNNING) return
        banked = s.elapsed
        anchor = 0L
        snap = snap.copy(phase = Phase.PAUSED)
        emit()
    }

    fun resume() {
        if (snap.phase != Phase.PAUSED) return
        anchor = clock()
        snap = snap.copy(phase = Phase.RUNNING)
        emit()
    }

    /** 结束：记录一条（够长的话），回到待机。 */
    fun finish() {
        val s = current()
        when (s.phase) {
            Phase.DONE -> clear()          // 倒计时已到点并记过账，只需收尾
            Phase.RUNNING, Phase.PAUSED -> {
                record(s.elapsed, completed = false)
                clear()
            }
            Phase.IDLE -> Unit
        }
    }

    fun switchItem(name: String) {
        val n = name.trim()
        if (n.isEmpty()) return
        snap = snap.copy(item = n)
        emit()
    }

    fun undoLast() {
        val s = lastSession ?: return
        sessions.remove(s)
        store?.remove(s.id)
        lastSession = null
        emit()
    }

    fun dismissUndo() {
        if (lastSession == null) return
        lastSession = null
        emit()
    }

    fun deleteSession(s: Session) {
        sessions.remove(s)
        store?.remove(s.id)
        if (lastSession == s) lastSession = null
        emit()
    }

    // ---------------------------------------------------------------- 日历

    /** 从库里重新拉今天的记录（启动 / 回到前台 / 手动刷新时调）。 */
    fun reloadToday() {
        dayStart = Days.startOfDay(clockMs())
        dayCheckedAt = clockMs()
        sessions.clear()
        sessions.addAll(store?.loadDay(dayStart) ?: emptyList())
        lastSession = null
        emit()
    }

    /**
     * 跨零点检查。为省开销，一分钟最多算一次日历；日期没变就直接返回。
     * 悬浮层常驻后台过夜时，靠这里把「今日」翻页。
     */
    private fun rollIfNeeded() {
        val now = clockMs()
        if (dayStart != 0L && now - dayCheckedAt < 60_000L) return
        dayCheckedAt = now
        val today = Days.startOfDay(now)
        // 首次调用不装载数据（谁初始化的谁负责 load），只把日期锚点立起来
        if (dayStart == 0L) {
            dayStart = today
            return
        }
        if (today == dayStart) return
        dayStart = today
        sessions.clear()
        sessions.addAll(store?.loadDay(today) ?: emptyList())
        lastSession = null
    }

    // ---------------------------------------------------------------- 内部

    private fun reset(phase: Phase, mode: Mode, item: String, target: Long) {
        banked = 0L
        anchor = clock()
        snap = Snapshot(phase, mode, item.trim().ifEmpty { "专注" }, 0L, target)
        emit()
    }

    private fun clear() {
        banked = 0L
        anchor = 0L
        snap = Snapshot(phase = Phase.IDLE, mode = Mode.STOPWATCH, item = snap.item)
        emit()
    }

    private fun record(ms: Long, completed: Boolean) {
        if (ms < minRecordMs) return   // 太短的不记，避免误触堆出一堆 1 秒记录
        val draft = Session(snap.item, ms, clockMs(), completed)
        val id = store?.save(draft) ?: 0L
        val s = draft.copy(id = id)
        sessions.add(0, s)
        lastSession = s
    }

    /** 单测用：把内核恢复到冷启动状态。生产代码不调用。 */
    internal fun wipe() {
        snap = Snapshot()
        banked = 0L
        anchor = 0L
        sessions.clear()
        lastSession = null
        minRecordMs = 30_000L
        store = null
        dayStart = 0L
        dayCheckedAt = 0L
        clock = { SystemClock.elapsedRealtime() }
        clockMs = { System.currentTimeMillis() }
    }
}
