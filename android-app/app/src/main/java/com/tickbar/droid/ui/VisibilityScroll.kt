package com.tickbar.droid.ui

import android.content.Context
import android.view.View
import android.widget.ScrollView

/**
 * 一个「自己变可见 / 不可见时回调」的 ScrollView。
 *
 * 为什么需要它：切页签现在只切 `visibility`（不再 detach/attach），
 * 于是页内那些靠 `addOnAttachStateChangeListener` 起停计时器的写法再也收不到通知 ——
 * 计时页的 250ms ticker 会一直跑，切到别的页签还在白耗电。
 *
 * 三条路都要覆盖：
 * - 首次挂载（此 visibility 本来就是 VISIBLE，不会触发 `onVisibilityChanged`）；
 * - 切页签（本 View 的 visibility 变 GONE / VISIBLE）；
 * - 整个窗口切到后台（本 View 仍 VISIBLE，只有 window visibility 变）。
 */
class VisibilityScroll(ctx: Context, private val onShown: (Boolean) -> Unit) : ScrollView(ctx) {

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (isShown) onShown(true)
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        onShown(false)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (changedView === this) onShown(visibility == View.VISIBLE)
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != View.VISIBLE) onShown(false) else if (isShown) onShown(true)
    }
}
