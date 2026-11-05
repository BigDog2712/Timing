package com.tickbar.droid.core

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * 未捕获异常的落盘 + 上次崩溃回读。
 *
 * 为什么要它：本工程是零依赖手写 UI，启动路径上任何一处抛出，用户看到的都只是
 * 「闪退」两个字，没有任何线索。把堆栈留在私有目录，下次启动时由首屏顶部的
 * 提示条显示出来，截个图就能定位——这是没有 adb 时唯一可行的诊断通道。
 *
 * 两个落点是有意的：
 * - `filesDir`：一定能写，App 自己下次读；
 * - `getExternalFilesDir`：万一用户能拿到（部分 ROM 的文件管理器仍可访问），
 *   直接发出来更方便。写不进去就算了，不阻断。
 */
object Crash {

    private const val NAME = "crash-last.txt"

    /** 堆栈通常几 KB，截到 8KB 足够看清异常类型和第一个业务栈帧。 */
    private const val MAX = 8_000

    /** 进程内的最后一次崩溃（Activity 重建时不用再读盘）。 */
    @Volatile
    private var lastSaved = ""

    /** 在 Application.onCreate 里装一次。 */
    fun install(ctx: Context) {
        val app = ctx.applicationContext
        val prior = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            // 兜底本身绝不能再抛，否则会盖掉原始堆栈
            runCatching { save(app, t, e) }
            // 原处理器负责弹系统「应用已停止」并杀掉进程，必须转交
            prior?.uncaughtException(t, e)
        }
    }

    private fun save(ctx: Context, t: Thread, e: Throwable) {
        val sw = StringWriter()
        val pw = PrintWriter(sw)
        e.printStackTrace(pw)
        pw.flush()
        val text = "线程：${t.name}\n$sw".take(MAX)
        lastSaved = text
        runCatching { File(ctx.filesDir, NAME).writeText(text) }
        runCatching {
            val dir = ctx.getExternalFilesDir(null) ?: return@runCatching
            File(dir, NAME).writeText(text)
        }
    }

    /**
     * 取上一次崩溃并**清掉**，避免每次启动都弹。
     * 返回 null 表示这一次启动之前没崩过。
     */
    fun take(ctx: Context): String? {
        val cached = lastSaved
        lastSaved = ""

        val priv = File(ctx.filesDir, NAME)
        val text = when {
            cached.isNotEmpty() -> cached
            priv.exists() -> runCatching { priv.readText() }.getOrNull()
            else -> null
        }
        runCatching { if (priv.exists()) priv.delete() }
        runCatching { ctx.getExternalFilesDir(null)?.let { File(it, NAME).delete() } }
        return text?.takeIf { it.isNotBlank() }
    }

    /** 堆栈里最有信息量的一行：异常类名 + 消息。用来做提示条文案。 */
    fun headline(stack: String): String {
        val line = stack.lineSequence()
            .map { it.trim() }
            .firstOrNull { it.contains("Exception") || it.contains("Error") }
            ?: stack.lineSequence().firstOrNull { it.isNotBlank() }?.trim()
            ?: "未知错误"
        return if (line.length > 110) line.take(110) + "…" else line
    }
}
