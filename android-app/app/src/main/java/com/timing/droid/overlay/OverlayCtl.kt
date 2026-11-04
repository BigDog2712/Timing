package com.timing.droid.overlay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings

/** 悬浮层权限的一处收口：查询、跳系统设置、申请通知权限。 */
object OverlayCtl {

    fun canDraw(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    /** 跳到「显示在其他应用上层」的系统开关页，直接落到本应用。 */
    fun request(activity: Activity) {
        activity.startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${activity.packageName}"),
            )
        )
    }

    /** Android 13+ 通知是运行时权限；不给也能用，只是没有常驻通知。 */
    fun requestNotifications(activity: Activity) {
        if (Build.VERSION.SDK_INT < 33) return
        val ok = activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!ok) activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9001)
    }
}
