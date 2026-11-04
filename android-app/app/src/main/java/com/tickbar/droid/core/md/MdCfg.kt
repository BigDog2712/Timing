package com.tickbar.droid.core.md

import android.content.Context
import java.time.LocalDate

/**
 * Markdown 同步的落点配置。
 *
 * 与桌面端 `services/md_sync/config.rs` 是**同一套语义**：根目录 + 文件模板 + 标题行。
 * 差别只在「根目录」的表示：
 * - 桌面端是一串绝对路径（支持 `%USERPROFILE%` / `~`）；
 * - 安卓端是一个 **SAF 目录 URI**（`content://...tree/...`），由用户在系统选择器里指定。
 *
 * 为什么安卓端不能像桌面那样填路径：Android 11 起分区存储禁止应用直接按路径读写
 * 共享存储（`/storage/emulated/0/...` 会 `EACCES`）。Obsidian 自己的 vault 也在那里，
 * 所以唯一合法的写入方式就是 SAF —— 用户授权一次，之后靠持久化 URI 权限长期读写。
 */
object MdCfg {

    const val KIND_TIMERS = "timers"

    /** 便利贴区块（与桌面 `MdSyncKind::Notes` 的字符串值一致，基线按 kind 分开存）。 */
    const val KIND_NOTES = "notes"

    private const val SP = "tickbar_md"

    private fun sp(c: Context) =
        c.applicationContext.getSharedPreferences(SP, Context.MODE_PRIVATE)

    // ------------------------------------------------------------ 开关与落点

    /** 同步总开关。默认关：没选目录之前开着只会每轮报错。 */
    fun enabled(c: Context): Boolean = sp(c).getBoolean("enabled", false)

    fun setEnabled(c: Context, v: Boolean) = sp(c).edit().putBoolean("enabled", v).apply()

    /** 用户选中的目录（SAF tree uri）。空串 = 还没选。 */
    fun treeUri(c: Context): String = sp(c).getString("tree_uri", "") ?: ""

    fun setTreeUri(c: Context, v: String) = sp(c).edit().putString("tree_uri", v).apply()

    /** 文件模板，相对 [treeUri]。默认每天一个文件，与桌面出厂默认值一致。 */
    fun fileTemplate(c: Context): String = sp(c).getString("file", "{date}.md") ?: "{date}.md"

    fun setFileTemplate(c: Context, v: String) = sp(c).edit().putString("file", v).apply()

    /** 标题行。必须与桌面端「设置 → 同步」里填的完全一致，否则两端各写一块。 */
    fun heading(c: Context): String =
        sp(c).getString("heading", "#### 事项计时") ?: "#### 事项计时"

    fun setHeading(c: Context, v: String) = sp(c).edit().putString("heading", v).apply()

    /**
     * 便利贴区块的标题行。
     *
     * 默认 `#### 便利贴` 取自桌面端 `services/md_sync/config.rs` 里 notes 的默认绑定。
     * 两边必须是**同一个标题**，否则会各写一块：文件里两份便利贴表格，谁看谁都是
     * 「对面新加的一堆行」，同步会当场打架。
     */
    fun notesHeading(c: Context): String =
        sp(c).getString("notes_heading", "#### 便利贴") ?: "#### 便利贴"

    fun setNotesHeading(c: Context, v: String) = sp(c).edit().putString("notes_heading", v).apply()

    fun configured(c: Context): Boolean = treeUri(c).isNotEmpty() && heading(c).trim().isNotEmpty()

    // ------------------------------------------------------------ 基线

    /**
     * 上一次「本机写出的区块内容」，冲突判定的三分基准点之一。
     *
     * 没有它就无法区分「文件变了是本机写的」还是「别人（桌面端）写的」，
     * 会把对面刚同步过来的内容又覆盖回去。
     */
    fun baseline(c: Context, kind: String, date: LocalDate): String? =
        sp(c).getString("baseline:$kind:$date", null)

    fun setBaseline(c: Context, kind: String, date: LocalDate, text: String) =
        sp(c).edit().putString("baseline:$kind:$date", text).apply()

    /** 清掉过久的基线，避免 SP 无限长（保留最近 30 天足够判定）。 */
    fun pruneBaseline(c: Context, keepFrom: LocalDate) {
        val editor = sp(c).edit()
        for ((key, _) in sp(c).all) {
            if (!key.startsWith("baseline:")) continue
            val date = key.substringAfterLast(':')
            val parsed = runCatching { LocalDate.parse(date) }.getOrNull() ?: continue
            if (parsed.isBefore(keepFrom)) editor.remove(key)
        }
        editor.apply()
    }

    // ------------------------------------------------------------ 状态

    /** 上一次同步结果（设置页直接显示这句话，不做二次加工）。 */
    fun lastStatus(c: Context): String = sp(c).getString("last_status", "") ?: ""

    fun setLastStatus(c: Context, v: String) = sp(c).edit().putString("last_status", v).apply()

    // ------------------------------------------------------------ 路径

    /** 展开模板里的日期令牌（`{date}` / `{yyyy}` / `{MM}` / `{dd}`），与桌面端同名同义。 */
    fun expand(template: String, date: LocalDate): String = template
        .replace("{date}", date.toString())
        .replace("{yyyy}", String.format("%04d", date.year))
        .replace("{MM}", String.format("%02d", date.monthValue))
        .replace("{dd}", String.format("%02d", date.dayOfMonth))
}
