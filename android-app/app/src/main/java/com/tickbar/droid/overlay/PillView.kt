package com.tickbar.droid.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import com.tickbar.droid.core.TimeFmt
import com.tickbar.droid.core.TimerCore
import com.tickbar.droid.core.Tk
import kotlin.math.cos
import kotlin.math.sin

/**
 * 小条本体（自绘，不走 XML）。
 *
 * 两种形态共用一套绘制逻辑：
 *  - DOT  28dp 小圆点：待机时常驻，点一下临时展开成药丸
 *  - BAR  高 32dp 药丸：圆角方形状态环 + MM:SS + 事项名（尺寸/配色对齐桌面 PillBar）
 *
 * 手势不在这里处理 —— 拖动 / 单击 / 长按都由 [OverlayService] 接管，
 * 因为只有它能改 WindowManager 的坐标。这里只负责「长什么样」。
 */
class PillView(context: Context) : View(context) {

    var snap: TimerCore.Snapshot = TimerCore.Snapshot()
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
            invalidate()
        }

    /** true = 小圆点；false = 药丸。 */
    var dotMode = true
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
            invalidate()
        }

    /** 倒计时最后 60s 的 1 秒闪烁（低于 WCAG 2.3.1 光敏阈值）。 */
    var blinkOn = true
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
        fontFeatureSettings = "tnum"   // 等宽数字，秒变化时字宽不跳
        color = Tk.PILL_INK
    }
    private val namePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        color = Tk.PILL_INK_DIM
    }

    private val ringPath = Path()
    private val ringSeg = Path()
    private val ringRect = RectF()

    /** 小圆点的玻璃球面。尺寸变化时重建 —— 每帧 new 一个 Shader 会拖住 overlay 的绘制。 */
    private var glass: RadialGradient? = null

    private fun d(v: Float): Float = v * resources.displayMetrics.density

    private val padH = d(9f)
    private val ringSize = d(16f)
    private val ringRadius = d(5f)
    private val gapRing = d(7f)
    private val gapName = d(6f)
    private val barH = d(32f)
    private val nameMax = d(92f)

    // 小圆点内部的比例：轨道贴近外缘，时针只走里圈，两者中间留一圈空隙，否则看着像表盘裂了
    private val dotRim = d(1.1f)
    private val dotTrack = d(9.2f)
    private val dotNeedleIn = d(1.6f)
    private val dotNeedleOut = d(6.4f)
    private val dotPivot = d(1.5f)

    // ------------------------------------------------------------ 测量

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val r = minOf(w, h) / 2f
        if (r <= 0f) return
        // 中心全透 → 中段几乎透明 → 边缘 14% 白：看起来是一层薄玻璃，不是一块底
        glass = RadialGradient(
            w / 2f, h / 2f, r,
            intArrayOf(0x00FFFFFF, 0x05FFFFFF, Tk.PILL_DOT_GLASS),
            floatArrayOf(0f, 0.58f, 1f),
            Shader.TileMode.CLAMP,
        )
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (dotMode) {
            val s = d(28f).toInt()
            setMeasuredDimension(s, s)
            return
        }
        timePaint.textSize = Tk.sp(context, 15f)
        namePaint.textSize = Tk.sp(context, 12f)

        val timeW = timePaint.measureText(timeText())
        val nameW = if (snap.item.isEmpty()) 0f else namePaint.measureText(ellipsized())
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
        if (dotMode) drawDot(canvas, w, h) else drawBar(canvas, w, h)
    }

    /**
     * 小圆点 = 一颗玻璃表盘。
     *
     * 层序从外到内：墨色外圈 → 玻璃球面 → 内缘高光 → 表盘轨道 → 时针 + 进度弧 → 轴心。
     *
     * 之所以外面还留一条墨圈：这个圆点会浮在别人的界面之上，可能压在纯白淘宝上，
     * 也可能压在黑色相机取景框上。只有白环会在白底上隐形，只有黑环会在黑底上隐形，
     * 两条叠着才在哪都能认出来 —— 代价是 0.7dp，近看会有一点点「描边感」。
     */
    private fun drawDot(canvas: Canvas, w: Float, h: Float) {
        val c = w / 2f
        val edge = minOf(w, h) / 2f - d(0.35f)

        stroke.strokeWidth = d(0.7f)
        stroke.color = Tk.PILL_DOT_EDGE
        canvas.drawCircle(c, c, edge, stroke)

        fill.shader = glass
        canvas.drawCircle(c, c, edge - d(0.35f), fill)
        fill.shader = null

        stroke.strokeWidth = d(0.9f)
        stroke.color = Tk.PILL_DOT_RIM
        canvas.drawCircle(c, c, edge - dotRim, stroke)

        // 轨道两层叠着画：墨色当衬底、白线当主轨。
        // 深色壁纸上墨色几乎不可见 → 看到白环；浅色 App 上白色不可见 → 看到灰环。
        stroke.strokeWidth = d(3.4f)
        stroke.color = Tk.PILL_DOT_TRACK_INK
        canvas.drawCircle(c, c, dotTrack, stroke)

        stroke.strokeWidth = d(1.6f)
        stroke.color = Tk.PILL_DOT_TRACK
        canvas.drawCircle(c, c, dotTrack, stroke)

        val arc = TimerCore.arcFraction(snap)
        val needle = TimerCore.needleFraction(snap)

        // 时针（分针语义）：正计时 60 分钟一圈，倒计时指在「剩余」的位置
        if (needle > 0f) {
            val rad = Math.toRadians(-90.0 + 360.0 * needle)
            val dx = cos(rad).toFloat()
            val dy = sin(rad).toFloat()

            stroke.strokeWidth = d(1.5f)
            stroke.color = ringColor()
            canvas.drawLine(
                c + dx * dotNeedleIn, c + dy * dotNeedleIn,
                c + dx * dotNeedleOut, c + dy * dotNeedleOut,
                stroke,
            )
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

    private fun drawBar(canvas: Canvas, w: Float, h: Float) {
        val radius = h / 2f

        fill.color = Tk.PILL_BG   // 92% 不透明，比桌面 94% 略透一点，手机壁纸更花
        canvas.drawRoundRect(0f, 0f, w, h, radius, radius, fill)

        stroke.strokeWidth = d(1f)
        stroke.color = Tk.PILL_LINE_2
        canvas.drawRoundRect(d(0.5f), d(0.5f), w - d(0.5f), h - d(0.5f), radius, radius, stroke)

        // 状态环：小米式圆角方形，进度用 PathMeasure 沿轮廓裁一段（比圆弧更像桌面那颗环）
        val left = padH
        val top = (h - ringSize) / 2f
        ringRect.set(left, top, left + ringSize, top + ringSize)
        ringPath.reset()
        ringPath.addRoundRect(ringRect, ringRadius, ringRadius, Path.Direction.CW)

        stroke.strokeWidth = d(2f)
        stroke.color = Tk.PILL_TRACK
        canvas.drawPath(ringPath, stroke)

        val frac = fraction()
        if (frac > 0f) {
            val pm = PathMeasure(ringPath, false)
            ringSeg.reset()
            pm.getSegment(0f, pm.length * frac, ringSeg, true)
            stroke.color = ringColor()
            canvas.drawPath(ringSeg, stroke)
        }

        // 文字
        timePaint.textSize = Tk.sp(context, 15f)
        timePaint.color = Tk.PILL_INK
        val baseY = h / 2f - (timePaint.descent() + timePaint.ascent()) / 2f
        var x = left + ringSize + gapRing
        canvas.drawText(timeText(), x, baseY, timePaint)
        x += timePaint.measureText(timeText())

        if (snap.item.isNotEmpty() && w > x + gapName + d(12f)) {
            namePaint.textSize = Tk.sp(context, 12f)
            val baseY2 = h / 2f - (namePaint.descent() + namePaint.ascent()) / 2f
            canvas.drawText(ellipsized(), x + gapName, baseY2, namePaint)
        }
    }

    // ------------------------------------------------------------ 计算

    private fun timeText(): String =
        TimeFmt.clock(snap.display, ceil = snap.mode == TimerCore.Mode.COUNTDOWN)

    private fun ellipsized(): String {
        namePaint.textSize = Tk.sp(context, 12f)
        return TextUtils.ellipsize(snap.item, namePaint, nameMax, TextUtils.TruncateAt.END).toString()
    }

    /** 环的进度：倒计时按剩余比例回落，正计时按 60 秒一圈循环。 */
    private fun fraction(): Float = TimerCore.arcFraction(snap)

    private fun ringColor(): Int {
        val base = when {
            snap.phase == TimerCore.Phase.DONE -> Tk.PILL_OK
            snap.urgent -> Tk.PILL_DANGER
            else -> Tk.PILL_ACCENT
        }
        // 闪烁：不换色，只压透明度，避免整条颜色来回跳
        return if (snap.urgent && !blinkOn) (base and 0x00FFFFFF) or 0x55000000 else base
    }
}
