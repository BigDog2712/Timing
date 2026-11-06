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
 * 就会出现两份计时口径。所以这里只读数据库，短按/长按都只做「展开」「回主界面」。
 */
class PillService : Service() {

    companion object {
        /** 小圆点形态下，点一下展开成条，看几秒再收回（老版本同一个数）。 */
        private const val EXPAND_MS = 3500L

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

    private var pill: PillView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var rotation: RotationWatcher? = null

    private val main = Handler(Looper.getMainLooper())
    private var expanded = false
    private var lastRunning = false
    private var lastW = -1
    private var lastNoti = ""

    // ------------------------------------------------------------ 生命周期

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WindowManager::class.java)
        nm = getSystemService(NotificationManager::class.java)
        runCatching { OverlayNoti.ensureChannel(nm) }
        // 库可能还没建（首启），那就一直是待机——不要因此让服务起不来
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
        return START_STICKY
    }

    /**
     * 进前台。Android 14 起 `specialUse` 类型必须与 manifest 声明一致，显式传 type 在
     * 部分 ROM 上比两参版本更稳；低版本仍走两参（三参版本是 API 29 才有的）。
     */
    private fun enterForeground(): Boolean = runCatching {
        val snap = reader?.read() ?: TimerReader.Snap.IDLE
        val notification = OverlayNoti.build(this, snap)
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
        val snap = reader?.read() ?: TimerReader.Snap.IDLE

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
        if (snap.urgent) view.blinkOn = !view.blinkOn else if (!view.blinkOn) view.blinkOn = true

        // 宽度随文字 / 形态变，wrap_content 需要主动通知窗口重算
        if (view.width != lastW && view.width > 0) {
            lastW = view.width
            lp?.let { params -> runCatching { wm.updateViewLayout(view, params) } }
        }
        lastNoti = OverlayNoti.push(nm, this, snap, lastNoti)
    }

    /** 500ms 一跳：推进时长 + 倒计时最后 60s 的 1 秒闪烁（与老版本同频）。 */
    private val ticker = object : Runnable {
        override fun run() {
            render()
            main.postDelayed(this, 500L)
        }
    }

    // ------------------------------------------------------------ 手势动作

    /**
     * 短按。
     *
     * 老版本三档：待机 → 开始计时；圆点未展开 → 展开；其余 → 暂停/继续。
     * 这版不能改计时状态，所以退化成两档：**圆点未展开先展开看时长，其余一律回主界面**。
     * 也就是说「先点一下看看到底多久了，再点一下进去操作」，不会误触暂停。
     */
    private fun onTap() {
        if (Prefs.overlayStyle(this) == Prefs.STYLE_DOT && !expanded) {
            expandTemporarily()
        } else {
            openApp()
        }
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

    private fun openApp() {
        runCatching { startActivity(OverlayNoti.openIntent(this)) }
    }
}
