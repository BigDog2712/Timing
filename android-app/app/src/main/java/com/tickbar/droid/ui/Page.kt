package com.tickbar.droid.ui

import android.view.View

/**
 * 一个一级页签。骨架里页面用「手写 View + 需要时重建子 View」实现，
 * 不引 RecyclerView / Fragment —— 数据量是几十条，没必要。
 */
interface Page {
    val view: View

    /** 每次切到该页签、以及 Activity 回前台时调用，用于重算数字。 */
    fun onShow()
}
