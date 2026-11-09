package com.timing.app.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import kotlin.math.ceil

/**
 * 小条本体（自绘，不走 XML）。
 *
 * 两种形态共用一套绘制与测量逻辑，**逐处对齐老工程 `android-app` 的 `overlay/PillView`**
 * （2026-11 归档的 0.3.6 原生版，路径 `D:\101-Workshop\261102-Timing`）。
 * **[V0.11.33] 有意偏离 0.3.6 归档基线（主人口径）：小圆点竖条指针 + 去玻璃层，不回改**——
 * 30-PRD §七（需求 3）：指针改为有宽度的竖条、删去外面半透明圆框。
 *
 * - `dotMode = true`  28dp 小圆点：素面表盘（墨圈 + 双轨 + 竖条指针 + 轴心）。
 *   待机时常驻，点一下临时展开成条；
 * - `dotMode = false` 高 32dp 药丸：圆角方形状态环 + 等宽时间 + 事项名。
 *
 * 为什么要两种：待机时谁也不希望屏幕上多一条黑杠，一颗 28dp 的球足够表达「它还在」；
 * 而计时中要看的是一眼能读的秒数，圆点里那点弧度读不出「已经 47 分钟」。
 *
 * 手势不在这里处理 —— 拖动 / 单击 / 长按都由 [PillService] 接管，
 * 因为只有它能改 WindowManager 的坐标。这里只负责「长什么样」。
 */
internal class PillView(context: Context) : View(context) {

    var snap: TimerReader.Snap = TimerReader.Snap.IDLE
        set(value) {
            if (field == value) return
            /* 只有药丸的宽度依赖文字，才需要重新测量；
               小圆点尺寸恒定，每 500ms 重排一次 overlay 窗口只会换来一顿一顿的观感。 */
            val relayout = !dotMode && (
                field.displaySec != value.displaySec ||
                    field.item != value.item ||
                    field.active != value.active ||
                    field.countdown != value.countdown
                )
            field = value
            if (relayout) requestLayout()
            invalidate()
        }

    /** true = 小圆点；false = 药丸。 */
    var dotMode: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
            invalidate()
        }

    /** 倒计时最后 60s 的 1 秒闪烁（低于 WCAG 2.3.1 光敏阈值）。 */
    var blinkOn: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    /**
     * 「刚刚结束」的那 3 秒。
     *
     * 老版本有 `Phase.DONE`，环能亮成绿色再退场；现在状态机结束后直接回 idle，
     * 不补一个视觉落点的话，用户看到的是「环忽然变灰、什么都没有」——分不清是结束还是坏了。
     * 由 [PillService] 观察 `active` 的下降沿给出，**不碰状态机**。
     */
    var done: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val timePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        // 等宽数字：秒数变化时字宽不跳
        fontFeatureSettings = "tnum"
        color = Tk.PILL_INK
    }
    private val namePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        color = Tk.PILL_INK_DIM
    }

    private val ringPath = Path()
    private val ringSeg = Path()
    private val ringRect = RectF()

    private fun d(v: Float): Float = v * resources.displayMetrics.density

    // ---- 药丸
    private val padH = d(9f)
    private val ringSize = d(16f)
    private val ringRadius = d(5f)
    private val gapRing = d(7f)
    private val gapName = d(6f)
    private val barH = d(32f)
    private val nameMax = d(92f)

    // ---- 小圆点内部比例：轨道贴近外缘，竖条指针只走里圈，两者中间留一圈空隙，
    //      否则看着像表盘裂了。轨道 / 内外径数值与老版本逐项一致；
    //      [V0.11.33] 指针由 1.5dp 细线改为 2.5dp 宽竖条（PM 建议值），长度/角度语义不变。
    private val dotSize = d(28f)
    private val dotTrack = d(9.2f)
    private val dotNeedleIn = d(1.6f)
    private val dotNeedleOut = d(6.4f)
    private val dotNeedleWidth = d(2.5f)
    private val dotPivot = d(1.5f)

    // ------------------------------------------------------------ 测量

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (dotMode) {
            val s = dotSize.toInt()
            setMeasuredDimension(s, s)
            return
        }
        timePaint.textSize = Tk.sp(context, 15f)
        namePaint.textSize = Tk.sp(context, 12f)

        val timeW = timePaint.measureText(timeText(snap.displaySec))
        val nameW =
            if (snap.active && snap.item.isNotEmpty()) namePaint.measureText(ellipsized()) else 0f
        val content = padH * 2 + ringSize + gapRing + timeW +
            (if (nameW > 0f) gapName + nameW else 0f)

        setMeasuredDimension(
            content.toInt().coerceIn(d(64f).toInt(), d(240f).toInt()),
            barH.toInt(),
        )
    }

    // ------------------------------------------------------------ 绘制

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        /* 逐帧现算的连续秒：弧、分针、文字全部由它派生。
           只跟着 500ms 一次的读库结果走会变成 6°/秒 的台阶，看着像卡顿。 */
        val nowSec = snap.displayAt(System.currentTimeMillis())
        if (dotMode) drawDot(canvas, w, h, nowSec) else drawBar(canvas, w, h, nowSec)
    }

    /**
     * 小圆点 = 一枚素面表盘。
     *
     * 层序从外到内：墨色外圈 → 表盘轨道（墨白双轨）→ 竖条指针 + 进度弧 → 轴心。
     * **[V0.11.33] 去掉了 0.3.6 的玻璃球面与内缘高光两层**（主人口径：删去外面半透明
     * 圆框），保留的各层与老版本逐项一致。
     *
     * 之所以外面还留一条墨圈：这个圆点会浮在别人的界面之上，可能压在纯白淘宝上，
     * 也可能压在黑色相机取景框上。只有白环会在白底上隐形，只有黑环会在黑底上隐形，
     * 两条叠着才在哪都能认出来 —— 代价是 0.7dp，近看会有一点点「描边感」。
     */
    private fun drawDot(canvas: Canvas, w: Float, h: Float, nowSec: Double) {
        val c = w / 2f
        val edge = minOf(w, h) / 2f - d(0.35f)

        stroke.strokeWidth = d(0.7f)
        stroke.color = Tk.PILL_DOT_EDGE
        canvas.drawCircle(c, c, edge, stroke)

        // 轨道两层叠着画：墨色当衬底、白线当主轨。
        // 深色壁纸上墨色几乎不可见 → 看到白环；浅色 App 上白色不可见 → 看到灰环。
        stroke.strokeWidth = d(3.4f)
        stroke.color = Tk.PILL_DOT_TRACK_INK
        canvas.drawCircle(c, c, dotTrack, stroke)

        stroke.strokeWidth = d(1.6f)
        stroke.color = Tk.PILL_DOT_TRACK
        canvas.drawCircle(c, c, dotTrack, stroke)

        /* 刚结束那 3 秒画满一圈绿环：状态机回到 idle 之后弧本来就是 0，不留这一圈的话
           「结束」和「待机」在视觉上没有区别，绿色也就永远没机会出现。 */
        val arc = if (done) 1f else arcFraction(nowSec)
        val needle = needleFraction(nowSec)

        // 竖条指针（分针语义）：正计时 60 分钟一圈，倒计时指在「剩余」的位置。
        // [V0.11.33] 由 1.5dp drawLine 改为 2.5dp 宽的圆角竖条（主人口径：内部指针改为
        // 有宽度的竖条即可）。径向长度沿用 dotNeedleIn → dotNeedleOut，角度语义不变；
        // 用 save/rotate 免去三角函数算四角。
        if (needle > 0f) {
            canvas.save()
            canvas.rotate(-90f + 360f * needle, c, c)
            fill.color = ringColor()
            canvas.drawRoundRect(
                c - dotNeedleWidth / 2f, c - dotNeedleOut,
                c + dotNeedleWidth / 2f, c - dotNeedleIn,
                dotNeedleWidth / 2f, dotNeedleWidth / 2f, fill,
            )
            canvas.restore()
        }

        // 进度弧：正计时 60 秒一圈循环（动感），倒计时按剩余比例回落
        if (arc > 0f) {
            stroke.strokeWidth = d(2f)
            stroke.color = ringColor()
            canvas.drawArc(
                c - dotTrack, c - dotTrack, c + dotTrack, c + dotTrack,
                -90f, 360f * arc, false, stroke,
            )
        }

        // 轴心常驻：待机时整颗点只剩它，是个「还活着」的暗示，不是空环
        fill.color = Tk.PILL_DOT_PIVOT
        canvas.drawCircle(c, c, dotPivot, fill)
    }

    /**
     * 透明底药丸：**不画底板**，只留内容（用户口径：「默认透明背景、不透明文字」）。
     *
     * 去掉深色底板之后，浅色界面上原本靠底板衬托的白字 / 白轨会消失，所以补两条托底：
     * 1. 文字带一层墨色阴影（阴影层对文字有效，minSdk 24 的硬件画布就支持）；
     * 2. 状态环先描一层墨线再压白线——和小圆点「墨白双轨」同一套思路。
     */
    private fun drawBar(canvas: Canvas, w: Float, h: Float, nowSec: Double) {
        /* 状态环：圆角方形，进度沿轮廓裁一段（比圆弧更像桌面那颗环）。 */
        val left = padH
        val top = (h - ringSize) / 2f
        ringRect.set(left, top, left + ringSize, top + ringSize)
        ringPath.reset()
        ringPath.addRoundRect(ringRect, ringRadius, ringRadius, Path.Direction.CW)

        stroke.strokeWidth = d(3.2f)
        stroke.color = Tk.PILL_TRACK_INK
        canvas.drawPath(ringPath, stroke)

        stroke.strokeWidth = d(2f)
        stroke.color = Tk.PILL_TRACK
        canvas.drawPath(ringPath, stroke)

        val frac = if (done) 1f else arcFraction(nowSec)
        if (frac > 0f) {
            val pm = PathMeasure(ringPath, false)
            ringSeg.reset()
            pm.getSegment(0f, pm.length * frac, ringSeg, true)
            stroke.color = ringColor()
            canvas.drawPath(ringSeg, stroke)
        }

        // 文字：白字 + 墨晕托底
        timePaint.textSize = Tk.sp(context, 15f)
        timePaint.color = if (snap.active) Tk.PILL_INK else Tk.PILL_INK_DIM
        timePaint.setShadowLayer(d(2.5f), 0f, d(0.5f), Tk.PILL_SHADOW)
        val baseY = h / 2f - (timePaint.descent() + timePaint.ascent()) / 2f
        val shown = timeTextOf(nowSec)
        var x = left + ringSize + gapRing
        canvas.drawText(shown, x, baseY, timePaint)
        x += timePaint.measureText(shown)

        if (snap.item.isNotEmpty() && w > x + gapName + d(12f)) {
            namePaint.textSize = Tk.sp(context, 12f)
            namePaint.setShadowLayer(d(2.5f), 0f, d(0.5f), Tk.PILL_SHADOW)
            val baseY2 = h / 2f - (namePaint.descent() + namePaint.ascent()) / 2f
            canvas.drawText(ellipsized(), x + gapName, baseY2, namePaint)
        }
    }

    // ------------------------------------------------------------ 计算

    /** 时间文本：不足 1 小时 `MM:SS`，满 1 小时 `HH:MM:SS`（小时也补两位，与老版本/桌面同口径）。 */
    private fun timeText(total: Long): String {
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%02d:%02d:%02d", h, m, s)
        else String.format("%02d:%02d", m, s)
    }

    /**
     * 绘制用的时间文本 —— **倒计时向上取整**。
     *
     * 这一条是从老版本 `TimeFmt.clock(ceil = true)` 抄回来的，理由是它写在那边注释里：
     * 剩 0.4 秒时该显示 `00:01`，而不是提前整整一秒挂着 `00:00` 让用户以为「是不是已经结束了、
     * 怎么没停」。正计时反过来要向下取整（走满 1 秒才进位），所以两条分支不能合并。
     */
    private fun timeTextOf(nowSec: Double): String =
        timeText(if (snap.countdown) ceil(nowSec).toLong() else nowSec.toLong())

    private fun ellipsized(): String {
        namePaint.textSize = Tk.sp(context, 12f)
        return TextUtils.ellipsize(snap.item, namePaint, nameMax, TextUtils.TruncateAt.END).toString()
    }

    /** 环的进度：倒计时按剩余比例回落，正计时按 60 秒一圈循环。入参是带小数的秒。 */
    private fun arcFraction(nowSec: Double): Float = when {
        !snap.active -> 0f
        snap.countdown && snap.targetSec > 0L -> (nowSec / snap.targetSec).coerceIn(0.0, 1.0).toFloat()
        else -> ((nowSec % 60.0) / 60.0).toFloat()
    }

    /**
     * 分针的比例 —— **分针语义**：正计时一小时转一圈，倒计时跟弧同比例。
     *
     * 老版本按整分钟跳（每分钟 6°），看着像秒针掉了一帧；这里用带小数的秒连续推进，
     * 一小时走一圈的转速没变，但眼睛看到的是一条匀速扫过的针。
     */
    private fun needleFraction(nowSec: Double): Float = when {
        !snap.active -> 0f
        snap.countdown && snap.targetSec > 0L -> (nowSec / snap.targetSec).coerceIn(0.0, 1.0).toFloat()
        else -> ((nowSec % 3600.0) / 3600.0).toFloat()
    }

    private fun ringColor(): Int {
        /* 与老版本 `PillView.ringColor` 同一套优先级：结束绿 > 最后一分钟红 > 计时蓝。
           **暂停不换色**——老版本暂停时仍然是蓝的，变灰会让「暂停」和「没在计时」长得一样。 */
        val base = when {
            done -> Tk.PILL_OK
            snap.urgent -> Tk.PILL_DANGER
            else -> Tk.PILL_ACCENT
        }
        // 闪烁不换色，只压透明度，避免整条颜色来回跳
        return if (snap.urgent && !blinkOn) (base and 0x00FFFFFF) or 0x55000000 else base
    }
}
