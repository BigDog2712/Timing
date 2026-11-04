package com.timing.droid.ui

import android.app.Activity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import com.timing.droid.core.Prefs
import com.timing.droid.core.TimerCore
import com.timing.droid.core.Tk
import com.timing.droid.overlay.OverlayCtl
import com.timing.droid.overlay.OverlayService

/**
 * 二级页「设置」。悬浮形态 / 记录口径 / 外观 / 同步 四段。
 * 桌面那套「插件 / 快捷键」不在手机上——没有第二块屏幕，也没有键盘。
 */
class SettingsPage(private val a: MainActivity) : Page {

    private lateinit var rowOverlay: LinearLayout
    private lateinit var rowStyle: LinearLayout
    private lateinit var rowPos: LinearLayout
    private lateinit var rowMin: LinearLayout
    private lateinit var rowPerm: LinearLayout
    private lateinit var rowTheme: LinearLayout

    private val sync = SyncSection(a)

    private fun d(v: Int) = Tk.dp(a, v)

    override val view: View = build()

    private fun build(): View {
        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d(18), d(10), d(18), d(24))
        }
        col.addView(Ui.text(a, "设置", 22f, Tk.INK, bold = true))

        // ---- 外观
        col.addView(Ui.label(a, "外观"))
        rowTheme = Ui.settingRow(
            a,
            "主题",
            { if (Tk.dark) "深色" else "浅色" },
        ) {
            val next = if (Tk.dark) Tk.LIGHT else Tk.DARK
            Prefs.setTheme(a, next)
            Tk.mode = next
            // 深浅色是进程级令牌，改完必须重建界面才彻底（列表里的 drawable 已经按旧色生成了）
            a.recreate()
        }
        col.addView(rowTheme, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(6) })

        // ---- 悬浮
        col.addView(Ui.label(a, "悬浮层"))
        rowOverlay = Ui.settingRow(
            a,
            "常驻悬浮窗",
            { if (Prefs.overlayEnabled(a)) "开" else "关" },
        ) {
            Prefs.setOverlayEnabled(a, !Prefs.overlayEnabled(a))
            OverlayService.sync(a)
            refresh()
        }
        col.addView(rowOverlay, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(6) })

        rowStyle = Ui.settingRow(
            a,
            "悬浮形态",
            { if (Prefs.style(a) == Prefs.STYLE_DOT) "小圆点" else "顶部胶囊" },
        ) {
            Prefs.setStyle(
                a,
                if (Prefs.style(a) == Prefs.STYLE_DOT) Prefs.STYLE_ISLAND else Prefs.STYLE_DOT,
            )
            OverlayService.sync(a)
            refresh()
        }
        col.addView(rowStyle, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) })

        rowPos = Ui.settingRow(
            a,
            "复位小条位置",
            { if (Prefs.overlayX(a) == Prefs.POS_UNSET) "默认" else "已自定义" },
        ) {
            OverlayService.resetPos(a)
            refresh()
        }
        col.addView(rowPos, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) })

        rowPerm = Ui.settingRow(
            a,
            "悬浮窗权限",
            { if (OverlayCtl.canDraw(a)) "已授权" else "去授权" },
        ) {
            if (!OverlayCtl.canDraw(a)) OverlayCtl.request(a)
        }
        col.addView(rowPerm, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) })

        // ---- 记录
        col.addView(Ui.label(a, "记录"))
        rowMin = Ui.settingRow(
            a,
            "最短记录时长",
            { "${Prefs.minRecordMs(a) / 1000} 秒" },
        ) {
            val next = when (Prefs.minRecordMs(a)) {
                5_000L -> 30_000L
                30_000L -> 60_000L
                else -> 5_000L
            }
            Prefs.setMinRecordMs(a, next)
            TimerCore.minRecordMs = next
            refresh()
        }
        col.addView(rowMin, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(6) })

        // ---- 同步
        col.addView(
            sync.view,
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(18) },
        )

        // ---- 关于
        col.addView(Ui.label(a, "关于"))
        val about = Ui.card(a)
        about.addView(Ui.text(a, "Timing 安卓 0.3.1", 15f, Tk.INK, bold = true))
        about.addView(
            Ui.text(
                a,
                "计时与待办存在本机 SQLite（表结构与桌面同构），它在 App 私有目录里，" +
                    "不参与 Obsidian 同步，只当离线副本与被覆盖时的救援来源。",
                12f,
                Tk.INK_DIM,
            ).apply { setPadding(0, d(6), 0, 0) },
        )
        about.addView(
            Ui.text(
                a,
                "两端真正共享的是 vault 里那篇日记的「事项计时」区块：按「事项 + 开始时刻」" +
                    "逐条三方合并，两边各自新记的都不会被覆盖。",
                12f,
                Tk.INK_DIM,
            ).apply { setPadding(0, d(4), 0, 0) },
        )
        col.addView(about, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(6) })

        return ScrollView(a).apply {
            addView(
                col,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
    }

    override fun onShow() = refresh()

    private fun refresh() {
        Ui.refreshRowValue(rowOverlay, if (Prefs.overlayEnabled(a)) "开" else "关")
        Ui.refreshRowValue(rowStyle, if (Prefs.style(a) == Prefs.STYLE_DOT) "小圆点" else "顶部胶囊")
        Ui.refreshRowValue(rowPos, if (Prefs.overlayX(a) == Prefs.POS_UNSET) "默认" else "已自定义")
        Ui.refreshRowValue(rowPerm, if (OverlayCtl.canDraw(a)) "已授权" else "去授权")
        Ui.refreshRowValue(rowMin, "${Prefs.minRecordMs(a) / 1000} 秒")
        Ui.refreshRowValue(rowTheme, if (Tk.dark) "深色" else "浅色")
        sync.refresh()
    }
}
