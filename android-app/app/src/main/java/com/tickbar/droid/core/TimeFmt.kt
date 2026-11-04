package com.tickbar.droid.core

/**
 * 时间显示口径，与桌面端 `src/lib/format.ts` 对齐：
 *  - 不足 1 小时 -> `MM:SS`
 *  - 满 1 小时   -> `HH:MM:SS`
 *  - 倒计时向上取整（剩 0.4s 显示 00:01，而不是提前显示 00:00 造成「已经结束了吗」的错觉）
 */
object TimeFmt {

    fun clock(ms: Long, ceil: Boolean = false): String {
        val total = if (ceil) (ms + 999L) / 1000L else ms / 1000L
        val s = (total % 60L).toInt()
        val m = (total / 60L % 60L).toInt()
        val h = total / 3600L
        return if (h > 0) "%02d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
    }

    /** 汇总口径：`1h 23m` / `23m` / `45s` */
    fun human(ms: Long): String {
        val total = ms / 1000L
        val h = total / 3600L
        val m = total / 60L % 60L
        val s = total % 60L
        return when {
            h > 0 && m > 0 -> "${h}h ${m}m"
            h > 0 -> "${h}h"
            m > 0 -> "${m}m"
            else -> "${s}s"
        }
    }

    fun clockOfDay(at: Long): String {
        val c = java.util.Calendar.getInstance().apply { timeInMillis = at }
        return "%02d:%02d".format(c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE))
    }
}
