package com.timing.app.overlay

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Choreographer
import android.view.WindowManager
import com.timing.app.native.Prefs

/**
 * 悬浮层宿主。
 *
 * ## 为什么必须是一个前台服务
 *
 * - `TYPE_APPLICATION_OVERLAY` 的窗口要在应用退到后台后继续存在，只能挂在服务上；
 * - Android 8+ 的后台服务会被限制，必须 `startForeground`，否则几秒后被杀。
 *
 * ## 与老版本 `OverlayService` 的关系
 *
 * 窗口、形态切换、手势、刷新节奏全部照搬；**唯一的差别是不碰计时状态机**：
 * 老版本直接持有 `TimerCore`，点一下就暂停；Tauri 版里状态机在 Rust，原生层再写一遍
 * 就会出现两份计时口径。所以这里一个字节都不写库，短按只把「有人按了一下」投给前端。
 *
 * ## 显示源（[V0.11.27] 改过，别改回去）
 *
 * ```text
 * Rust 推来的快照（Prefs.overlaySnapshot）   ← 优先：状态机算出来的
 *   └─ 没有 → 只读打开 timing.db 现取一次     ← 兜底
 * ```
 *
 * v0.11.22 只有兜底那条，于是「库读不到」＝「悬浮条永远待机，而且一个字都不说」。真机上
 * 这就是主人报的「主界面在计时，悬浮条和主界面无联系」。现在改成推 + 兜底，并且**两条路
 * 出问题都会写进通知副标题**（`Snap.note` / `lastTapError`）——排查不用再靠猜。
 */
class PillService : Service() {

    companion object {
        /** 小圆点形态下，点一下展开成条，看几秒再收回（老版本同一个数）。 */
        private const val EXPAND_MS = 3500L

        /** logcat 标签（与 `TimerReader` 同一个）：`adb logcat -s TimingPill`。 */
        private const val TAG = "TimingPill"

        /**
         * 事件名。**必须**与前端 `hooks/usePillAction.ts` 的 `PILL_TOGGLE_EVENT` 一致——
         * 两边各写一份字符串，改一处忘另一处的表现是「点了没反应」，而且两边都不报错。
         */
        internal const val EVENT_TOGGLE = "pill:toggle"

        /**
         * 「结束本次计时」的事件名（[V0.11.28]）。必须与前端 `usePillAction.ts` 的
         * `PILL_FINISH_EVENT` 一致 —— 同 `pill:toggle`，两边各写一份字符串。
         */
        internal const val EVENT_FINISH = "pill:finish"

        /** 落进 `Prefs.PendingAction.kind` 的两种动作。 */
        internal const val KIND_TOGGLE = "toggle"
        internal const val KIND_FINISH = "finish"

        /**
         * 通知栏按钮来的两条意图（[V0.11.28]）。
         *
         * 老版本的通知按钮直接调 `TimerCore.toggle()` / `finish()`；现在状态机在 Rust，
         * 原生层只能把动作当成**新的输入**原路投给前端，走与短按完全相同的那条链。
         */
        internal const val ACTION_TOGGLE = "com.timing.app.action.PILL_TOGGLE"
        internal const val ACTION_FINISH = "com.timing.app.action.PILL_FINISH"

        /** 「刚结束」的满圈绿环停留多久。老版本有 `Phase.DONE`，这版靠时间窗补一个落点。 */
        private const val DONE_FX_MS = 3_000L

        /**
         * 「有人按了一下」的投递口（[V0.11.22]）。
         *
         * 由 `TimingNativePlugin.onLoad()` 赋值、`onDestroy()` 置空。返回 `true` = 事件真的
         * 投出去了（有 JS 在听）；`false` / `null` = 没人在听，调用方退回「打开主界面」。
         *
         * 为什么用静态量而不是让 Service 持有 Activity：Service 的生命周期比 Activity 长，
         * 直接持有会泄漏；这里只握一个由插件赋值的函数引用，插件自己在 `onDestroy` 里清掉。
         */
        internal var bridge: ((String) -> Boolean)? = null

        /** 库还没建出来 / 打开失败时的重试间隔。 */
        private const val REOPEN_MS = 5_000L

        /** 设置里改了形态 / 归位：让正在跑的服务立刻重排，不用等下一帧。 */
        private const val ACTION_REFRESH = "com.timing.app.action.OVERLAY_REFRESH"

        fun start(ctx: Context) {
            // Android 12+ 从后台启动前台服务会抛 ForegroundServiceStartNotAllowedException，
            // 部分国产 ROM 也会直接拦。包一层：起不来就起不来，绝不能让宿主进程跟着崩。
            runCatching {
                ctx.startForegroundService(Intent(ctx, PillService::class.java))
            }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, PillService::class.java)) }
        }

        /** 设置开关 / 授权返回后调用：该开就开，该关就关。 */
        fun sync(ctx: Context) {
            if (Prefs.overlayEnabled(ctx) && Settings.canDrawOverlays(ctx)) start(ctx) else stop(ctx)
        }

        /** 形态变了 / 位置归位：让在跑的服务立刻重画（服务没跑就什么都不做）。 */
        fun refresh(ctx: Context) {
            runCatching {
                ctx.startService(Intent(ctx, PillService::class.java).setAction(ACTION_REFRESH))
            }
        }
    }

    private lateinit var wm: WindowManager
    private lateinit var nm: NotificationManager
    private var reader: TimerReader? = null
    private var lastOpenTryMs = 0L

    /** 最近一次「点了但没能打开主界面」的原因（[V0.11.27]）；落进通知副标题。 */
    private var lastTapError: String? = null

    private var pill: PillView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var rotation: RotationWatcher? = null

    private val main = Handler(Looper.getMainLooper())
    private var expanded = false
    private var lastRunning = false
    private var lastActive = false

    /** 「刚结束」绿环的到期时刻（墙钟毫秒，0 = 不在这个窗口里）。 */
    private var doneUntil = 0L
    private var lastW = -1
    private var lastNoti = ""

    // ------------------------------------------------------------ 生命周期

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WindowManager::class.java)
        nm = getSystemService(NotificationManager::class.java)
        runCatching { OverlayNoti.ensureChannel(nm) }
        // 库可能还没建（首启），那就先待机——不要因此让服务起不来
        reader = TimerReader.open(this)
        rotation = RotationWatcher { main.post { reflow() } }.also { it.start(this) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 必须在 5 秒内进前台，否则 ANR / 被杀，所以第一件事就是 startForeground。
        // 进不了前台（权限被拒 / ROM 限制）就自己退场：让系统在 5 秒后杀进程的话，
        // 会连累用户正在用的 App，表现就是「用着用着闪退」。
        if (!enterForeground()) {
            shutdown()
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == ACTION_REFRESH) {
            lastW = -1
            render()
            return START_STICKY
        }

        // 贴不上（无权限 / 被拦）只影响小条本身，服务与通知照常
        runCatching { attach() }
        /* 通知栏那两个按钮（[V0.11.28]）：动作本身不在这里执行 —— 状态机在 Rust，
           原生层只把它当成一次**新的输入**投给前端，走与短按完全相同的那条链。 */
        when (intent?.action) {
            ACTION_TOGGLE -> requestAction(KIND_TOGGLE)
            ACTION_FINISH -> requestAction(KIND_FINISH)
        }
        return START_STICKY
    }

    /**
     * 进前台。Android 14 起 `specialUse` 类型必须与 manifest 声明一致，显式传 type 在
     * 部分 ROM 上比两参版本更稳；低版本仍走两参（三参版本是 API 29 才有的）。
     */
    private fun enterForeground(): Boolean = runCatching {
        val notification = OverlayNoti.build(this, noticeOf(currentSnap()))
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                OverlayNoti.ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(OverlayNoti.ID, notification)
        }
        true
    }.getOrDefault(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    private fun shutdown() {
        setAnimating(false)
        main.removeCallbacksAndMessages(null)
        rotation?.stop(this)
        rotation = null
        pill?.let { view ->
            runCatching { wm.removeView(view) }
        }
        pill = null
        lp = null
        reader?.close()
        reader = null
    }

    /**
     * 拿一个能用的读库连接（[V0.11.22]）。
     *
     * v0.11.21 及之前 `reader` 只在 `onCreate` 开一次：库那时还没建出来（首启）、或
     * 打开失败（WAL + 只读的老问题）就**永久待机**，表现正是主人报的那一句
     * 「主界面唤起计时，悬浮窗无法计时」。现在改成失败后每 5 秒重试一次——
     * 重试本身很便宜（一次 open），但它是这条链路唯一的自愈点。
     */
    private fun ensureReader(): TimerReader? {
        reader?.let { return it }
        val now = System.currentTimeMillis()
        if (now - lastOpenTryMs < REOPEN_MS) return null
        lastOpenTryMs = now
        val opened = TimerReader.open(this)
        if (opened == null) {
            Log.w(TAG, "timing.db 还打不开（服务启动时可能还没建库），5 秒后重试")
            return null
        }
        reader = opened
        lastW = -1 // 库刚换上：触发一次重新测量，否则宽度可能停在待机那一版
        return opened
    }

    /**
     * 当前要显示的快照（[V0.11.27]）：**先看 Rust 推来的，再看库**。
     *
     * 顺序不能反。推来的那份是状态机算出来的（暂停时 `runningSince` 为 null、倒计时给目标值），
     * 而库只是它的持久化投影；再说了，库里读不到东西的时候，推来的那份照样是准的
     * ——这正是这一轮修的那个「主界面在计时、悬浮条不动」。
     */
    private fun currentSnap(): TimerReader.Snap {
        pushedSnap()?.let { return it }
        val opened = ensureReader()
            ?: return TimerReader.Snap.IDLE.copy(note = "读不到计时库：" + TimerReader.lastProbe)
        return opened.read()
    }

    /**
     * 从偏好里读 Rust 推来的快照。
     *
     * 不设「过期时间」：`runningSince` 是绝对墙钟时刻，一份几小时前推的快照在计时中照样
     * 能算出正确的时长；设过期反而会把一份**正确**的数据丢掉，退回那条会失败的老路。
     */
    private fun pushedSnap(): TimerReader.Snap? =
        TimerReader.Snap.fromPush(Prefs.overlaySnapshot(this), System.currentTimeMillis())

    /** 通知里要额外说的那句话：先报「点不动」，再报「读不到」，两者都是用户能行动的信息。 */
    private fun noticeOf(snap: TimerReader.Snap): TimerReader.Snap {
        val note = lastTapError ?: snap.note
        return if (note == null) snap else snap.copy(note = note)
    }

    // ------------------------------------------------------------ 窗口

    private fun attach() {
        if (pill != null) return
        if (!Settings.canDrawOverlays(this)) return

        val view = PillView(this)
        view.dotMode = Prefs.overlayStyle(this) != Prefs.STYLE_BAR
        val params = PillGeometry.params(this, Prefs.overlayX(this), Prefs.overlayY(this))
        view.setOnTouchListener(
            PillDrag(this, wm, view, params, ::onTap, ::openApp),
        )

        runCatching { wm.addView(view, params) }.getOrElse { return }

        pill = view
        lp = params
        applyClamp()
        main.post(ticker)
    }

    /** 收边：坐标超出屏幕时拉回来（首贴、旋转、分屏都会调用）。 */
    private fun applyClamp() {
        val view = pill ?: return
        val params = lp ?: return
        if (!PillGeometry.clamp(this, view, params)) return
        runCatching { wm.updateViewLayout(view, params) }
    }

    /** 旋转 / 分屏后重新收边，并把新位置记住。 */
    private fun reflow() {
        val params = lp ?: return
        applyClamp()
        Prefs.setOverlayPos(this, params.x, params.y)
        lastW = -1 // 触发一次重新测量（横竖屏密度不变，但可用宽度变了）
        render()
    }

    /** 回到「灵动岛位」：水平居中、状态栏下 4dp。偏好已由调用方清掉。 */
    private fun resetPos() {
        val params = lp ?: return
        PillGeometry.reset(this, params)
        applyClamp()
        pill?.let { view -> runCatching { wm.updateViewLayout(view, params) } }
    }

    private fun render() {
        val view = pill ?: return
        val snap = currentSnap()

        // 从「没在跑」变成「在跑」：圆点先展开几秒把时长亮出来。
        // 老版本靠「点小圆点开始计时」来触发这一步；这版开始动作在 Rust，所以改成
        // 观察到状态变化就展开 —— 用户在 App 里点开始、退回桌面，看到的体感是一样的。
        val becameRunning = snap.running && !lastRunning
        lastRunning = snap.running
        if (becameRunning && !expanded && Prefs.overlayStyle(this) == Prefs.STYLE_DOT) {
            expanded = true
            main.removeCallbacks(collapse)
            main.postDelayed(collapse, EXPAND_MS)
        }

        view.dotMode = Prefs.overlayStyle(this) != Prefs.STYLE_BAR && !expanded
        view.snap = snap

        /* 「刚结束」：`active` 从 true 掉到 false 的那一帧起，画 3 秒满圈绿环。
           状态机结束后直接回 idle，不留这个落点的话，用户看到的是「环忽然没了」——
           和「本来就是待机」长得一模一样，分不清是结束还是坏了。重新开始计时则立刻撤掉。 */
        val now = System.currentTimeMillis()
        if (lastActive && !snap.active) doneUntil = now + DONE_FX_MS
        if (snap.active) doneUntil = 0L
        lastActive = snap.active
        view.done = now < doneUntil

        // 计时中才逐帧重绘；其余时刻停在最后画面上，不占 GPU
        setAnimating(snap.active && snap.running)
        if (snap.urgent) view.blinkOn = !view.blinkOn else if (!view.blinkOn) view.blinkOn = true

        // 宽度随文字 / 形态变，wrap_content 需要主动通知窗口重算
        if (view.width != lastW && view.width > 0) {
            lastW = view.width
            lp?.let { params -> runCatching { wm.updateViewLayout(view, params) } }
        }
        lastNoti = OverlayNoti.push(nm, this, noticeOf(snap), lastNoti)
    }

    /** 500ms 一跳：推进时长 + 倒计时最后 60s 的 1 秒闪烁（与老版本同频）。 */
    private val ticker = object : Runnable {
        override fun run() {
            render()
            main.postDelayed(this, 500L)
        }
    }

    // ------------------------------------------------------------ 逐帧重绘

    /**
     * 只在「计时中」跑的一条逐帧重绘。
     *
     * 读库仍然是 500ms 一次（那是状态检测），但圆点的弧和分针要顺滑，就得按屏幕刷新率
     * 重画：`Snap` 里存了 `runningSince`，每帧用墙钟现算带小数的秒，弧就是连续扫过去的
     * 而不是每半秒跳 3°。暂停 / 待机 / 没在计时时立刻停掉，不空转。
     */
    private var animating = false

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!animating) return
            pill?.invalidate()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun setAnimating(on: Boolean) {
        if (on == animating) return
        animating = on
        val choreographer = Choreographer.getInstance()
        choreographer.removeFrameCallback(frame)
        if (on) choreographer.postFrameCallback(frame)
    }

    // ------------------------------------------------------------ 手势动作

    /**
     * 短按（[V0.11.22] 恢复老版本的三档手感，但状态机仍在 Rust）。
     *
     * ```text
     * 待机                  → 开始计时
     * 圆点形态 + 未展开      → 展开看时长（3.5 秒后收回），不动状态
     * 其余（药丸 / 已展开）  → 暂停 / 继续
     * 长按                  → 回主界面（PillDrag 回调）
     * ```
     *
     * 「能操作」不等于「在这里改状态」：本类一个字节都不写库，只把「有人按了一下」交给
     * `TimingNativePlugin.trigger`，由前端调 `togglePause()` 走 Rust 那一份状态机。
     * 事件投不出去（WebView 已销毁 / 前端没挂监听）就退回打开主界面——宁可多一步，
     * 也不做「点了没反应」。
     */
    private fun onTap() {
        val snap = currentSnap()
        /* 圆点未展开、且确实有一场计时在：先给用户看时长。这是唯一「不吃掉这一按」的分支。 */
        if (snap.active && Prefs.overlayStyle(this) == Prefs.STYLE_DOT && !expanded) {
            expandTemporarily()
            return
        }
        requestAction(KIND_TOGGLE)
    }

    /**
     * 把一个用户动作投给前端（[V0.11.28] 从 `onTap` 里抽出来，通知按钮共用）。
     *
     * 为什么动作要「先落标记再投事件」：`trigger` 只在 WebView 活着且前端挂着监听时有效，
     * 而这一按可能发生在进程被回收之后（安卓上很常见）。标记留在盘上，App 回到前台时
     * 由前端问一次 `overlayTakeTap` 补做——同一按只会被补做一次，因为前端接走时会清掉它。
     *
     * 标记里带 `kind`：补做必须知道补的是「切换」还是「结束」，猜错比不补更糟。
     */
    private fun requestAction(kind: String) {
        val event = if (kind == KIND_FINISH) EVENT_FINISH else EVENT_TOGGLE
        lastTapError = null
        Prefs.markPendingAction(this, kind)
        if (bridge?.invoke(event) != true) {
            Log.w(TAG, "没有前端在听 $event：退回打开主界面（标记保留给前台补做）")
            openApp()
        }
        render()
    }

    private fun expandTemporarily() {
        if (Prefs.overlayStyle(this) != Prefs.STYLE_DOT) return
        expanded = true
        render()
        main.removeCallbacks(collapse)
        main.postDelayed(collapse, EXPAND_MS)
    }

    private val collapse = Runnable {
        expanded = false
        render()
    }

    /**
     * 回主界面。
     *
     * [V0.11.27] 失败不再静默 `runCatching`：从后台服务拉起 Activity 在部分 ROM（尤其
     * 开了「后台弹出界面」限制的）上会被拦，而这条路径正是「点了没反应、App 也没打开」
     * 的唯一解释。拦下来就把原因写进通知副标题——用户至少能看见「点不动，因为系统不让」，
     * 而不是对着一个没反应的药丸。
     */
    private fun openApp() {
        runCatching { startActivity(OverlayNoti.openIntent(this)) }
            .onFailure { err ->
                lastTapError = "点悬浮条没能打开主界面：${err.message ?: err.javaClass.simpleName}"
                Log.w(TAG, lastTapError!!, err)
            }
    }
}
