package com.tickbar.droid.ui

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsets

/**
 * 边到边布局的系统栏留白。
 *
 * targetSdk 35 起系统强制「内容画到状态栏 / 导航栏底下」，所以必须自己补 padding。
 *
 * ## 为什么要连 IME 一起算
 * 原实现只补了 `systemBars()`：键盘弹出时 inset 里**不含键盘高度**，于是输入框
 * 被键盘盖住——便利贴编辑页是全屏输入，这个洞会直接让人「看不见自己打的字」。
 * 这里把 `ime()` 一起取，底部取两者较大值：没键盘时用导航栏高度，有键盘时
 * 整个根布局被顶上去，输入框始终露在键盘上方。
 *
 * 副作用是底部页签会跟着上移；由 `Router` 在打开全屏编辑页时先把页签藏掉，所以看不到。
 */
object Insets {

    fun apply(activity: Activity, root: View) {
        if (Build.VERSION.SDK_INT < 30) {
            /* API 26–29 走 themes.xml 的 adjustResize，没有 WindowInsets.Type 这套 API。 */
            activity.window.setSoftInputMode(
                android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
            )
            return
        }
        runCatching {
            activity.window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
                )
                val ime = insets.getInsets(WindowInsets.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
                insets
            }
        }
    }
}
