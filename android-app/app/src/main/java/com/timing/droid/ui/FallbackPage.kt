package com.timing.droid.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import com.timing.droid.core.Tk

/**
 * 页面构造失败时的占位。
 *
 * 为什么要它：四个页签是在 `MainActivity.onCreate` 里一次性构造的，
 * 任何一页抛异常，整个 App 都起不来——表现就是「打开即闪退」，
 * 而用户完全不知道是哪一页的问题。用占位页兜住，其余三页照常可用，
 * 同时把异常类型和消息显示出来，一眼能定位。
 */
class FallbackPage(c: Context, name: String, error: Throwable) : Page {

    override val view: View = ScrollView(c).apply {
        addView(
            LinearLayout(c).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(Tk.dp(c, 22), Tk.dp(c, 56), Tk.dp(c, 22), Tk.dp(c, 20))

                addView(Ui.text(c, "「$name」页加载失败", 18f, Tk.INK, bold = true))
                addView(
                    Ui.text(
                        c,
                        "${error.javaClass.simpleName}：${error.message ?: "（无消息）"}",
                        13f,
                        Tk.DANGER,
                    ).apply { setPadding(0, Tk.dp(c, 10), 0, 0) },
                )
                addView(
                    Ui.text(c, "其余页签仍可使用。把这句话发给我就能定位。", 12f, Tk.INK_DIM)
                        .apply { setPadding(0, Tk.dp(c, 10), 0, 0) },
                )
            },
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
            ),
        )
    }

    override fun onShow() = Unit
}
