package com.tickbar.droid.overlay

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
import com.tickbar.droid.core.Prefs
import com.tickbar.droid.core.Repo
import com.tickbar.droid.core.TimerCore
import com.tickbar.droid.ui.MainActivity

/**
 * 悬浮层宿主。
 *
 * 为什么必须是一个前台服务：
 *  - `TYPE_APPLICATION_OVERLAY` 的窗口要在应用退到后台后继续存在，只能挂在服务上；
 *  - Android 8+ 后台服务会被限制，必须 `startForeground`，否则几秒后被杀；
 *  - 顺带解决「计时不被系统冻结」——前台服务期间进程是活跃的。
 *
 * 它与 UI 共享同一进程里的 [TimerCore]：App 里暂停，小条立刻变；点小条暂停，App 也跟着变。
 */
class OverlayService : Service() {

    companion object {
        /** 小圆点形态下，点一下展开成药丸，看几秒再收回 */
        private const val EXPAND_MS = 3500L

        fun start(ctx: Context) {
            // Android 12+ 从后台启动前台服务会抛 ForegroundServiceStartNotAllowedException，
            // 部分国产 ROM 也会直接拦。包一层：起不来就起不来，绝不能让宿主进程跟着崩。
            runCatching {
                ctx.startForegroundService(OverlayNoti.intent(ctx, OverlayNoti.ACTION_START))
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, OverlayService::class.java))
        }

        /** 设置开关 / 授权返回后调用：该开就开，该关就关。 */
        fun sync(ctx: Context) {
            if (Prefs.overlayEnabled(ctx) && Settings.canDrawOverlays(ctx)) start(ctx) else stop(ctx)
        }

        /**
         * 把小条放回默认位置（顶部正中）。
         * 先把偏好清掉——服务没在跑时，下次启动自然回到默认位；在跑就顺手把窗口挪回去。
         */
        fun resetPos(ctx: Context) {
            Prefs.clearOverlayPos(ctx)
            if (!Prefs.overlayEnabled(ctx) || !Settings.canDrawOverlays(ctx)) return
            runCatching {
                ctx.startForegroundService(OverlayNoti.intent(ctx, OverlayNoti.ACTION_RESET_POS))
            }
        }
    }

    private lateinit var wm: WindowManager
    private lateinit var nm: NotificationManager

    private var pill: PillView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var unwatch: (() -> Unit)? = null

    /** 屏幕旋转会改变可放置区域，靠它重算边界。 */
    private var rotation: RotationWatcher? = null

    private val main = Handler(Looper.getMainLooper())
    private var expanded = false
    private var lastW = -1
    private var lastNoti = ""

    // ------------------------------------------------------------ 生命周期

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        nm = getSystemService(NotificationManager::class.java)
        runCatching { OverlayNoti.ensureChannel(nm) }
        // 进程可能是被 START_STICKY 单独拉起来的（App 没在前台），
        // 这里自己把库接上，否则这一轮的计时结束就白记了。
        // 但库坏了不能拖死服务：没有库只是不落盘，计时与悬浮条照常。
        runCatching {
            Repo.init(this)
            TimerCore.store = Repo
            TimerCore.minRecordMs = Prefs.minRecordMs(this)
            TimerCore.reloadToday()
        }
        watchRotation()
    }

    private fun watchRotation() {
        if (rotation != null) return
        rotation = RotationWatcher { main.post { reflow() } }.also { it.start(this) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 必须在 5 秒内进前台，否则 ANR / 被杀，所以第一件事就是 startForeground。
        // 进不了前台（权限被拒 / ROM 限制）就自己退场 —— 让系统在 5 秒后杀进程的话，
        // 会连累用户正在用的 App，表现就是「用着用着闪退」。
        if (!enterForeground()) {
            shutdown()
            stopSelf()
            return START_NOT_STICKY
        }

        when (intent?.action) {
            OverlayNoti.ACTION_TOGGLE -> TimerCore.toggle()
            OverlayNoti.ACTION_FINISH -> TimerCore.finish()
            OverlayNoti.ACTION_RESET_POS -> resetPos()
            OverlayNoti.ACTION_STOP -> {
                shutdown()
                return START_NOT_STICKY
            }
        }
        // 小条贴不上（无权限 / 被拦）只影响小条本身，服务与通知照常
        runCatching { attach() }
        return START_STICKY
    }

    /**
     * 进前台。
     *
     * Android 14 起 `specialUse` 类型必须与 manifest 声明一致，显式传 type 在部分 ROM 上
     * 比两参版本更稳；低版本仍走两参（三参版本是 API 29 才有的）。
     */
    private fun enterForeground(): Boolean = runCatching {
        val n = OverlayNoti.build(this)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                OverlayNoti.NOTI_ID,
                n,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(OverlayNoti.NOTI_ID, n)
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
        unwatch?.invoke()
        unwatch = null
        pill?.let { v ->
            try {
                wm.removeView(v)
            } catch (_: IllegalArgumentException) {
                // 已经被系统回收，忽略
            }
        }
        pill = null
        lp = null
    }

    // ------------------------------------------------------------ 窗口

    private fun attach() {
        if (pill != null) return
        if (!Settings.canDrawOverlays(this)) return   // 没授权：只保留通知，不崩

        val view = PillView(this)
        val params = PillGeometry.params(this, Prefs.overlayX(this), Prefs.overlayY(this))
        view.setOnTouchListener(PillDrag(this, wm, view, params, ::onTap, ::openApp))

        try {
            wm.addView(view, params)
        } catch (_: Exception) {
            return   // 权限被系统收回时 addView 会抛，安静退出
        }
        pill = view
        lp = params
        applyClamp()
        unwatch = TimerCore.observe { render() }
        main.post(ticker)
    }

    /** 收边：坐标超出屏幕时拉回来（首贴、旋转、分屏都会调用）。 */
    private fun applyClamp() {
        val v = pill ?: return
        val p = lp ?: return
        if (!PillGeometry.clamp(this, v, p)) return
        try {
            wm.updateViewLayout(v, p)
        } catch (_: IllegalArgumentException) {
            // view 已 detach，忽略
        }
    }

    /** 旋转 / 分屏后重新收边，并把新位置记住。 */
    private fun reflow() {
        val p = lp ?: return
        applyClamp()
        Prefs.setOverlayPos(this, p.x, p.y)
        lastW = -1     // 触发一次重新测量（横竖屏密度不变，但可用宽度变了）
        render()
    }

    /** 回到「灵动岛位」：水平居中、状态栏下 4dp。偏好已由 [resetPos] 的伴生方法清掉。 */
    private fun resetPos() {
        val p = lp ?: return
        PillGeometry.reset(this, p)
        applyClamp()
        try {
            wm.updateViewLayout(pill, p)
        } catch (_: IllegalArgumentException) {
            // 忽略
        }
    }

    private fun render() {
        val v = pill ?: return
        val s = TimerCore.current()
        v.dotMode = Prefs.style(this) != Prefs.STYLE_ISLAND && !expanded
        v.snap = s

        // 药丸宽度随文字变，wrap_content 需要主动通知窗口重算
        if (v.width != lastW && v.width > 0) {
            lastW = v.width
            lp?.let { p ->
                try {
                    wm.updateViewLayout(v, p)
                } catch (_: IllegalArgumentException) {
                    // view 已 detach，忽略
                }
            }
        }
        // 通知内容没变就不推（指纹由 OverlayNoti 给），省电也避免通知栏闪烁
        lastNoti = OverlayNoti.push(nm, this, s, lastNoti)
    }

    /** 500ms 一跳：推进时长 + 倒计时最后 60s 的 1 秒闪烁。 */
    private val ticker = object : Runnable {
        override fun run() {
            val s = TimerCore.current()
            pill?.let { v ->
                if (s.urgent) v.blinkOn = !v.blinkOn else if (!v.blinkOn) v.blinkOn = true
            }
            render()
            main.postDelayed(this, 500L)
        }
    }

    // ------------------------------------------------------------ 手势动作

    private fun onTap() {
        val s = TimerCore.current()
        when {
            // 待机 / 已结束：点一下就开正计时（对齐桌面「按一下就开计时」）
            !s.active -> {
                TimerCore.start()
                expandTemporarily()
            }
            // 小圆点形态：第一下先展开看时长，避免误触暂停
            Prefs.style(this) == Prefs.STYLE_DOT && !expanded -> expandTemporarily()
            else -> TimerCore.toggle()
        }
    }

    private fun expandTemporarily() {
        if (Prefs.style(this) != Prefs.STYLE_DOT) return
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
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
    }

    // ------------------------------------------------------------ 通知

}
