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
 * 悬浮条宿主。
 *
 * ## 为什么必须是一个前台服务
 *
 * - `TYPE_APPLICATION_OVERLAY` 的窗口要在应用退到后台后继续存在，只能挂在服务上；
 * - Android 8+ 的后台服务会被限制，必须 `startForeground`，否则几秒后被杀。
 *
 * ## 它与老版本的关键差别：只读
 *
 * 老版本 `OverlayService` 直接持有 `TimerCore`，点一下小条就暂停——那套状态机在
 * Tauri 版里是 Rust 的，原生层再写一遍就会出现两份计时口径。所以这里**只读**数据库，
 * 点击一律回主界面。等「Rust ↔ Kotlin 双向命令」在真机上验过之后，才谈在浮条上暂停。
 */
class PillService : Service() {

    companion object {
        fun start(ctx: Context) {
            // Android 12+ 从后台启动前台服务会抛 ForegroundServiceStartNotAllowedException，
            // 部分国产 ROM 也会直接拦。包一层：起不来就起不来，绝不能让宿主进程跟着崩。
            runCatching {
                ctx.startForegroundService(Intent(ctx, PillService::class.java))
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, PillService::class.java))
        }

        /** 设置开关 / 授权返回后调用：该开就开，该关就关。 */
        fun sync(ctx: Context) {
            if (Prefs.overlayEnabled(ctx) && Settings.canDrawOverlays(ctx)) start(ctx) else stop(ctx)
        }
    }

    private lateinit var wm: WindowManager
    private lateinit var nm: NotificationManager
    private var reader: TimerReader? = null

    private var pill: PillView? = null
    private var lp: WindowManager.LayoutParams? = null

    private val main = Handler(Looper.getMainLooper())
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
        val params = PillGeometry.params(this, Prefs.overlayX(this), Prefs.overlayY(this))
        view.setOnTouchListener(
            PillDrag(this, wm, view, params) { openApp() },
        )

        runCatching { wm.addView(view, params) }.getOrElse { return }

        pill = view
        lp = params
        applyClamp()
        main.post(ticker)
    }

    private fun applyClamp() {
        val view = pill ?: return
        val params = lp ?: return
        if (!PillGeometry.clamp(this, view, params)) return
        runCatching { wm.updateViewLayout(view, params) }
    }

    private fun render() {
        val view = pill ?: return
        val snap = reader?.read() ?: TimerReader.Snap.IDLE
        view.snap = snap
        if (snap.urgent) view.blinkOn = !view.blinkOn else if (!view.blinkOn) view.blinkOn = true

        // 药丸宽度随文字变，wrap_content 需要主动通知窗口重算
        if (view.width != lastW && view.width > 0) {
            lastW = view.width
            lp?.let { params -> runCatching { wm.updateViewLayout(view, params) } }
        }
        lastNoti = OverlayNoti.push(nm, this, snap, lastNoti)
    }

    private val ticker = object : Runnable {
        override fun run() {
            render()
            main.postDelayed(this, 1000L)
        }
    }

    private fun openApp() {
        runCatching { startActivity(OverlayNoti.openIntent(this)) }
    }
}
