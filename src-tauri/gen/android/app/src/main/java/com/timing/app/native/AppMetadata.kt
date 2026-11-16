package com.timing.app.native

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
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
 * - 自适应图标（Android 8 起绝大多数第三方应用）按 108 视口整幅画再裁中间 72。
 *   **不许用负坐标放大**：那条路在部分 ROM 上画出来是全透明的，而全透明的图压出来
 *   也是合法 WebP，前端会显示成一块灰底空白（0.12.6 真机现象）。
 * - 全透明 / 压不出来 / 解不开的图标一律回空串：让前端画首字瓦片，**不画一张空图**。
 * - 应用升级换了图标后，本进程内仍显示旧图（缓存按包名）。重启 App 即刷新。
 */
object AppMetadata {

    /** 图标边长（px）。界面显示 22dp，3x 屏需要 ~66px；64px 是体积与清晰度的折中。 */
    private const val ICON_PX = 64

    /** 自适应图标的完整视口（px）。规范固定 108dp：可见区 72dp、四周各 18dp 出血。 */
    private const val ADAPTIVE_PX = 108

    /** 自适应图标里真正会被启动器显示出来的那一块（px）。 */
    private const val VISIBLE_PX = 72

    /** 图标字节数下限。低于它的 WebP 基本是一张空白图的头部，发给前端只会白等一次解码。 */
    private const val MIN_ICON_BYTES = 64

    /** WebP 质量。图标是大色块，85 已经看不出差别，再高只是让 base64 变长。 */
    private const val ICON_QUALITY = 85

    /** 裁中间那块 72 再缩到 64 时的采样方式：不滤波会出锯齿。 */
    private val SCALE_PAINT = Paint(Paint.FILTER_BITMAP_FLAG)

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
        val label = runCatching { manager.getApplicationLabel(info) }.getOrNull()?.toString().orEmpty()
        return Entry(label, render(manager, info, pkg))
    }

    /**
     * 取图标 → 64px WebP data URI。**任何一步不成立都回空串**（前端画首字瓦片）。
     *
     * 三道闸，对应真机上出现过的三种「图标空白」：
     *
     * ① **自适应图标不许用负坐标放大**（0.12.6 真机：第三方应用清一色灰底空白，
     *    而系统桌面 / 息屏编辑 / 本应用这三个**经典 PNG 图标**正常）。原来的写法是
     *    `setBounds(-16, -16, 80, 80)` 放大 1.5 倍再裁，这条路在部分 ROM 的
     *    `AdaptiveIconDrawable` 实现上画不出东西 —— 而现在第三方应用几乎全是自适应图标，
     *    于是「几乎全空、只剩几个系统件有图」。改成先按 108 视口整幅画、再裁中间 72
     *    （可见区本来就是 72/108），全程只有非负坐标。
     * ② **画完必须验「有没有像素」**：全透明的图压出来也是合法 WebP，前端 `<img>` 会
     *    老老实实显示成一块灰底空白 —— 这比没有图标更糟，因为它看着像加载失败。
     *    全透明就当没有，交给首字瓦片。
     * ③ **压完必须能解码**：`compress` 回 true 不代表这段字节是一张能显示的图。
     */
    private fun render(manager: PackageManager, info: ApplicationInfo, pkg: String): String {
        /* 两条来源都试：`info` 里的图标引用在个别 ROM 上为空，按包名再取一次通常还在 */
        val drawables = ArrayList<Drawable>(2)
        runCatching { manager.getApplicationIcon(info) }.getOrNull()?.let { drawables.add(it) }
        runCatching { manager.getApplicationIcon(pkg) }.getOrNull()?.let { drawables.add(it) }
        for (drawable in drawables) {
            val bitmap = runCatching { draw(drawable) }.getOrNull() ?: continue
            if (isBlank(bitmap)) continue
            val uri = encode(bitmap)
            if (uri.isNotEmpty()) return uri
        }
        return ""
    }

    /** 按图标类型选画法。返回的位图一定是 [ICON_PX] 见方。 */
    private fun draw(source: Drawable): Bitmap {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && source is AdaptiveIconDrawable) {
            /* 108 视口整幅画：可见内容只占中间 72，先裁中间再缩到 64，
               效果与启动器里一致，且不依赖负坐标（见 `render` 的 ①）。 */
            val full = Bitmap.createBitmap(ADAPTIVE_PX, ADAPTIVE_PX, Bitmap.Config.ARGB_8888)
            source.setBounds(0, 0, ADAPTIVE_PX, ADAPTIVE_PX)
            source.draw(Canvas(full))
            val inset = (ADAPTIVE_PX - VISIBLE_PX) / 2
            val visible = Bitmap.createBitmap(full, inset, inset, VISIBLE_PX, VISIBLE_PX)
            val out = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
            Canvas(out).drawBitmap(visible, null, Rect(0, 0, ICON_PX, ICON_PX), SCALE_PAINT)
            return out
        }
        val out = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
        source.setBounds(0, 0, ICON_PX, ICON_PX)
        source.draw(Canvas(out))
        return out
    }

    /**
     * 整张图是不是全透明（隔点采样，64×64 只需 1024 次读像素）。
     *
     * 阈值取 8 而不是 0：有些 ROM 的图标带一层 alpha≈1 的噪声底，那和全透明一样看不见。
     */
    private fun isBlank(bitmap: Bitmap): Boolean {
        var y = 0
        while (y < bitmap.height) {
            var x = 0
            while (x < bitmap.width) {
                if (Color.alpha(bitmap.getPixel(x, y)) > 8) return false
                x += 2
            }
            y += 2
        }
        return true
    }

    /** 位图 → `data:image/webp;base64,…`。压不出来 / 太小 / 解不开都回空串。 */
    private fun encode(bitmap: Bitmap): String {
        val bytes = ByteArrayOutputStream()
        @Suppress("DEPRECATION")
        val format =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Bitmap.CompressFormat.WEBP_LOSSY
            } else {
                Bitmap.CompressFormat.WEBP
            }
        if (!bitmap.compress(format, ICON_QUALITY, bytes)) return ""
        val data = bytes.toByteArray()
        /* 空白图压出来只有几十字节的头部；配合 `isBlank` 双保险（见 `render` 的 ②） */
        if (data.size < MIN_ICON_BYTES) return ""
        if (BitmapFactory.decodeByteArray(data, 0, data.size) == null) return ""
        val base64 = Base64.encodeToString(data, Base64.NO_WRAP)
        return "data:image/webp;base64,$base64"
    }
}
