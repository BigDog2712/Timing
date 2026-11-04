package com.tickbar.droid.ui

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.Toast
import com.tickbar.droid.core.Crash
import com.tickbar.droid.core.Tk
import com.tickbar.droid.overlay.OverlayCtl

/**
 * 首屏顶部那条提示。三种状态，优先级从高到低：
 *
 *  1. 上次崩过 → 红条，点「查看」能看完整堆栈并复制；
 *  2. 本地库打不开 → 黄条，说明本次是临时模式（记录不会保存）；
 *  3. 没给悬浮窗权限 → 蓝条 + 「去授权」，这是常态提示。
 *
 * 前两种出现就说明有真问题，第三种只是新装机的必经步骤。
 * 用 [Bar.isPermissionHint] 区分，`MainActivity.onResume` 只对第三种做显隐，
 * 免得用户一授权，崩溃信息就被顺手藏掉了。
 */
object Notice {

    class Bar(val view: LinearLayout, val isPermissionHint: Boolean)

    fun build(a: MainActivity, crash: String?, dbOk: Boolean): Bar = when {
        crash != null -> Bar(
            fill(a, "上次闪退：${Crash.headline(crash)}", "查看", 0x3AE5484D, Tk.DANGER) {
                showCrash(a, crash)
            },
            isPermissionHint = false,
        )

        !dbOk -> Bar(
            fill(
                a,
                "本地库打不开，已切到临时模式（本次记录不保存）",
                "说明",
                0x33E8A33D,
                Tk.WARN,
            ) {
                AlertDialog.Builder(a)
                    .setTitle("本地库打不开")
                    .setMessage(
                        "App 已经跳过数据库直接跑起来了，计时和界面都能用，但这一轮的记录不会保存。\n\n" +
                            "下一步：在设置 → 同步里确认 Obsidian 目录还通着；" +
                            "若反复出现，重装一次即可（Markdown 里的数据不受影响）。",
                    )
                    .setPositiveButton("知道了", null)
                    .show()
            },
            isPermissionHint = false,
        )

        else -> Bar(
            fill(
                a,
                "要看到悬浮小条，需授予「显示在其他应用上层」",
                "去授权",
                0x2E4DA3E8,
                Tk.ACCENT,
            ) { OverlayCtl.request(a) },
            isPermissionHint = true,
        )
    }

    /** 左文案 + 右动作的一行，整条同色底。 */
    private fun fill(
        a: Context,
        msg: String,
        action: String,
        bg: Int,
        ink: Int,
        onClick: () -> Unit,
    ): LinearLayout {
        val bar = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.round(a, bg, 0)
            setPadding(Ui.px(a, 14), Ui.px(a, 10), Ui.px(a, 14), Ui.px(a, 10))
        }
        bar.addView(
            Ui.text(a, msg, 12f).apply { setPadding(0, 0, Ui.px(a, 8), 0) },
            LinearLayout.LayoutParams(0, Ui.WRAP, 1f),
        )
        bar.addView(
            Ui.text(a, action, 12f, ink, bold = true).apply {
                isClickable = true
                setOnClickListener { onClick() }
            },
        )
        return bar
    }

    private fun showCrash(a: MainActivity, stack: String) {
        // 用平台 AlertDialog：message 自带滚动容器，几 KB 的堆栈也能看全
        AlertDialog.Builder(a)
            .setTitle("上次崩溃的堆栈")
            .setMessage(stack)
            .setPositiveButton("复制") { _, _ ->
                val cm = a.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("tickbar-crash", stack))
                Toast.makeText(a, "已复制，直接发给我就行", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("知道了", null)
            .show()
    }
}
