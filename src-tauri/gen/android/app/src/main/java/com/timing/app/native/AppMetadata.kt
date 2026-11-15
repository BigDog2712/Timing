package com.timing.app.native

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * 应用的显示名与图标（Android `PackageManager`）。
 *
 * ## 为什么名字必须现查，不许从包名推
 * 从包名取最后一段首字母大写（`com.tencent.mm` → `Mm`）看着像人名，实际上**全是错的**：
 * 微信显示成 `Mm`、哔哩哔哩显示成 `Bili`、桌面启动器显示成 `Home`/`Nova`。
 * 真名只有系统知道，`getApplicationLabel` 才是那一个真源。
 *
 * ## 为什么不落库（迁移 0008 已经定了这条）
 * 显示名会变（改名、换图标），存进 `app_usage` 就是一份会过期的副本。
 * `0008_v01300.sql` 的注释写得很明确：表里只存事实（包名 + 秒 + 首末），
 * 名字与分类**读取时现查**。所以这里也不做任何持久化，只有进程内缓存。
 *
 * ## 图标为什么是 data URI 而不是文件路径
 * 桥只能传 JSON。写文件再让 WebView 读要开 asset 协议 + 配作用域，配错的表现是
 * 一片空白图标，且只有真机才看得出。data URI 在同一个 `rows` 里回来，
 * 没有路径、没有作用域、没有第二份状态。尺寸压到 64px 是为了不让 7 天 × N 个应用的
 * 回值把桥压垮（原始 PNG 一张能有几十 KB）。
 *
 * ## 已知边界
 * - 卸载后才出现的包名（历史记录里有、机器上已没有）`getApplicationInfo` 抛
 *   `NameNotFoundException` —— 这里**跳过**，前端回落到包名短名，不编一个名字。
 * - 应用升级换了图标后，本进程内仍显示旧图（缓存按包名）。重启 App 即刷新。
 */
object AppMetadata {

    /** 图标边长（px）。界面显示 28dp，3x 屏需要 ~84px；64px 是体积与清晰度的折中。 */
    private const val ICON_PX = 64

    /** WebP 质量。图标是大色块，85 已经看不出差别，再高只是让 base64 变长。 */
    private const val ICON_QUALITY = 85

    /**
     * 进程内缓存。**必须是 `ConcurrentHashMap`**：Tauri 的插件命令跑在线程池上，
     * 统计页一次挂载会连发 7 个 `usageDay`，普通 HashMap 在这里会被并发写坏
     * （表现是偶发 `ConcurrentModificationException` 或某个图标永远加载不出来）。
     */
    private val cache = ConcurrentHashMap<String, Entry>()

    /** 一条元数据。`label` / `icon` 都可能为空串 —— 空就是「不知道」，不是「没有」。 */
    private class Entry(val label: String, val icon: String)

    /**
     * 为一批包名解析显示名与图标，回 `[{packageName, label, icon}]`。
     *
     * 查不到的包（已卸载）**不出现在结果里**，而不是出一条空记录：
     * 前端拿不到就会回落到包名，逻辑只有一条路。
     */
    fun describe(context: Context, packages: Collection<String>): JSONArray {
        val out = JSONArray()
        val manager = context.packageManager
        for (pkg in packages) {
            if (pkg.isEmpty()) continue
            val entry = cache[pkg] ?: resolve(manager, pkg)?.also { cache[pkg] = it } ?: continue
            val row = JSONObject()
            row.put("packageName", pkg)
            row.put("label", entry.label)
            row.put("icon", entry.icon)
            out.put(row)
        }
        return out
    }

    private fun resolve(manager: PackageManager, pkg: String): Entry? {
        val info = runCatching { manager.getApplicationInfo(pkg, 0) }.getOrNull() ?: return null
        /* 取不到名字就留空串，**不要**退回 pkg —— 前端已经有一条回落规则，
           两处各自回落会得到两种名字（列表一个、洞察句一个）。 */
        val label = runCatching { manager.getApplicationLabel(info).toString() }.getOrNull().orEmpty()
        val icon = runCatching { encode(manager.getApplicationIcon(info)) }.getOrNull().orEmpty()
        return Entry(label, icon)
    }

    /** Drawable → 64px WebP data URI。失败回空串（前端画首字瓦片，不画破图）。 */
    private fun encode(drawable: Drawable): String {
        val bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        /* 自适应图标（API 26+）的可见内容只占中间 72/108，直接按 64 画会四周留一圈透明，
           在列表里看起来比别的图标小一圈。把绘制区放大 1.5 倍再居中裁掉外围，
           中间的可见部分正好铺满 —— 与启动器里的观感一致。 */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && drawable is AdaptiveIconDrawable) {
            val over = (ICON_PX * 0.25f).toInt()
            drawable.setBounds(-over, -over, ICON_PX + over, ICON_PX + over)
        } else {
            drawable.setBounds(0, 0, ICON_PX, ICON_PX)
        }
        drawable.draw(canvas)

        val bytes = ByteArrayOutputStream()
        @Suppress("DEPRECATION")
        val format =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Bitmap.CompressFormat.WEBP_LOSSY
            } else {
                Bitmap.CompressFormat.WEBP
            }
        if (!bitmap.compress(format, ICON_QUALITY, bytes)) return ""
        val base64 = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        return "data:image/webp;base64,$base64"
    }
}
