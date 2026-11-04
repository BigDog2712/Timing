package com.timing.droid.ui

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import com.timing.droid.core.NoteStore

/**
 * 二级页路由。
 *
 * 手机端只有「一级页签 + 一个全屏编辑页」这一层，不需要 Fragment / Navigation：
 * 直接把编辑页的 View 盖到内容区上，关掉时通知外壳重新挂回原来的页签。
 *
 * ## 为什么页签要跟着藏
 * 编辑页是全屏输入，底部如果还压着五个页签，键盘弹起时页签会被顶到键盘上方，
 * 既占地方又容易被误触。打开编辑页藏、关掉就还原——这也让「返回」只有一个含义。
 *
 * ## 为什么是「盖」而不是「换」
 * 旧实现走 `host.removeAllViews()` 再挂编辑页，等于把五个页签整体 detach：
 * 返回时它们要重新 attach，整页重新 measure/layout，列表滚动位置也一起丢。
 * 现在编辑页是盖在页签上的额外一层，页签全程保持挂载，只是被 `onCover(true)` 藏起来。
 */
class Router(
    private val a: Activity,
    private val host: FrameLayout,
    private val navBar: View,
    private val onCover: (Boolean) -> Unit,
    private val onRestore: () -> Unit,
) {

    private var editor: NoteEditPage? = null

    /** 盖上去的那层 View：关页时只摘它，不碰页签。 */
    private var editorView: View? = null

    val isOpen: Boolean get() = editor != null

    /** 打开已有便利贴的编辑页。 */
    fun openNote(id: Long) {
        /* 防重入：编辑页已经开着时再开一张，旧那层的 View 会遗留在 host 里没人摘
           （restore() 只摘最新的那一个），返回后就多一层看不见的挡板。 */
        if (editor != null) return
        val page = NoteEditPage(a, id) { restore() }
        editor = page
        navBar.visibility = View.GONE
        onCover(true)
        host.addView(
            page.view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        editorView = page.view
    }

    /** 新建一张便利贴并立刻进编辑页；落库失败返回 false（调用方不切页）。 */
    fun createNote(): Boolean {
        val id = NoteStore.create()
        if (id <= 0L) return false
        openNote(id)
        return true
    }

    /**
     * 关掉二级页。返回 true 表示「这次返回键被吃掉了」。
     *
     * 真正的收尾（落盘、空白删除、恢复页签）发生在 `NoteEditPage.close()` 的回调里，
     * 这里只负责发起，避免「按了返回但页面没关」的两套状态。
     */
    fun close(): Boolean {
        val page = editor ?: return false
        editor = null
        page.close()
        return true
    }

    private fun restore() {
        editor = null
        editorView?.let { host.removeView(it) }
        editorView = null
        navBar.visibility = View.VISIBLE
        onCover(false)
        /* 回到原页签（并且可见）：外壳的 show() 会把除当前页之外的页重新藏好 */
        onRestore()
    }
}
