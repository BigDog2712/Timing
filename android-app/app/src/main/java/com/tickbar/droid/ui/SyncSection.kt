package com.tickbar.droid.ui

import android.net.Uri
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.tickbar.droid.core.Tk
import com.tickbar.droid.core.md.MdCfg
import com.tickbar.droid.core.md.MdSync
import com.tickbar.droid.core.md.SafVault

/**
 * 设置页的「同步（Obsidian）」一节。
 *
 * 落点 = 一个 **SAF 目录**（用户在系统选择器里点选的 Obsidian vault 子目录）
 * \+ 文件名模板 + 标题行。这三项与桌面端「设置 → 同步」是同一套语义，
 * 两端填成同一个目录、同一个模板、同一个标题，就能读写同一篇日记。
 *
 * 为什么目录必须由用户选：Android 11 起不能按裸路径写共享存储，
 * 只有 SAF 授权能长期读写 vault 里的文件。选完会调 `takePersistableUriPermission`
 * 把授权变成「重启后仍有效」。
 */
class SyncSection(private val a: MainActivity) {

    private lateinit var rowEnabled: LinearLayout
    private lateinit var rowDir: LinearLayout
    private lateinit var rowFile: LinearLayout
    private lateinit var rowHeading: LinearLayout
    private lateinit var rowNotesHeading: LinearLayout
    private lateinit var status: TextView

    private fun d(v: Int) = Tk.dp(a, v)

    val view: View = build()

    private fun build(): View {
        val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        col.addView(Ui.label(a, "同步（Obsidian）"))

        val card = Ui.card(a)

        rowEnabled = Ui.settingRow(
            a,
            "同步开关",
            { if (MdCfg.enabled(a)) "开" else "关" },
        ) {
            MdCfg.setEnabled(a, !MdCfg.enabled(a))
            refresh()
            if (MdCfg.enabled(a)) syncNow()
        }
        card.addView(rowEnabled, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

        rowDir = Ui.settingRow(
            a,
            "日记目录",
            { dirLabel() },
        ) { pickDir() }
        card.addView(
            rowDir,
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) },
        )

        rowFile = Ui.settingRow(
            a,
            "文件名模板",
            { MdCfg.fileTemplate(a) },
        ) {
            Sheets.prompt(a, "文件名模板", "支持 {date} / {yyyy} / {MM} / {dd}", MdCfg.fileTemplate(a)) {
                if (it.isNotEmpty()) MdCfg.setFileTemplate(a, it)
                refresh()
            }
        }
        card.addView(
            rowFile,
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) },
        )

        rowHeading = Ui.settingRow(
            a,
            "标题行",
            { MdCfg.heading(a) },
        ) {
            Sheets.prompt(a, "标题行", "例：#### 事项计时", MdCfg.heading(a)) {
                if (it.isNotEmpty()) MdCfg.setHeading(a, it)
                refresh()
            }
        }
        card.addView(
            rowHeading,
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) },
        )

        /* 便利贴是**另一个区块**（桌面端 notes 的默认绑定标题），必须单独一指。
           两端标题填得不一样，文件里就会长出两份便利贴表格。 */
        rowNotesHeading = Ui.settingRow(
            a,
            "便利贴标题行",
            { MdCfg.notesHeading(a) },
        ) {
            Sheets.prompt(a, "便利贴标题行", "例：#### 便利贴", MdCfg.notesHeading(a)) {
                if (it.isNotEmpty()) MdCfg.setNotesHeading(a, it)
                refresh()
            }
        }
        card.addView(
            rowNotesHeading,
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(8) },
        )

        col.addView(card, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(6) })

        col.addView(
            Ui.button(a, "立即同步", primary = true) { syncNow() },
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP).apply { topMargin = d(10) },
        )

        status = Ui.text(a, "", 12f, Tk.INK_DIM).apply {
            setPadding(0, d(8), 0, 0)
        }
        col.addView(status, LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP))

        col.addView(
            Ui.text(
                a,
                "Obsidian Sync 同步的是 vault 里的文件，不是数据库。所以两端共享的是" +
                    "这篇日记里的两个区块：「" + MdCfg.heading(a) + "」（计时段，按「事项 + 开始时刻」" +
                    "逐条合并）和「" + MdCfg.notesHeading(a) + "」（便利贴表格，按桌面端发下的行号认人）。" +
                    "手机不会自己给便利贴编号，第一次写出去的那条会由桌面发号，下一轮起两边锁在同一张上。",
                11f,
                Tk.INK_DIM,
            ).apply { setPadding(0, d(10), 0, 0) },
            LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP),
        )

        return col
    }

    fun refresh() {
        if (!::rowEnabled.isInitialized) return
        Ui.refreshRowValue(rowEnabled, if (MdCfg.enabled(a)) "开" else "关")
        Ui.refreshRowValue(rowDir, dirLabel())
        Ui.refreshRowValue(rowFile, MdCfg.fileTemplate(a))
        Ui.refreshRowValue(rowHeading, MdCfg.heading(a))
        Ui.refreshRowValue(rowNotesHeading, MdCfg.notesHeading(a))

        val last = MdCfg.lastStatus(a)
        status.text = when {
            !MdCfg.configured(a) -> "还没选目录：点「日记目录」选 Obsidian vault 里的存放位置"
            last.isEmpty() -> "还没同步过"
            else -> last
        }
        status.setTextColor(if (MdCfg.configured(a)) Tk.INK_DIM else Tk.DANGER)
    }

    private fun pickDir() {
        a.pickVaultDir { uri: Uri? ->
            if (uri == null) {
                refresh()
                return@pickVaultDir
            }
            val persisted = SafVault.persist(a, uri)
            MdCfg.setTreeUri(a, uri.toString())
            MdCfg.setEnabled(a, true)
            refresh()
            if (!persisted) {
                Toast.makeText(a, "授权未能长期化，重启 App 后可能需要重选", Toast.LENGTH_LONG).show()
            }
            syncNow()
        }
    }

    private fun syncNow() {
        if (!MdCfg.configured(a)) {
            refresh()
            return
        }
        status.text = "同步中…"
        /* 撞上正在跑的那轮时 requestSync 会把回调排队、一轮结束后回填；但万一那轮卡在
           SAF IO 上久久不返回，按钮就会永久停在「同步中…」。这里再兜一层：1 秒后先按
           已落库的状态还原文案，回调真回来了就再以它为准（removeCallbacks 掉兜底）。 */
        val fallback = Runnable { refresh() }
        status.postDelayed(fallback, 1_000L)
        a.requestSync { report ->
            status.removeCallbacks(fallback)
            refresh()
            if (report.action == MdSync.Action.ERROR) {
                Toast.makeText(a, report.message, Toast.LENGTH_LONG).show()
            }
        }
    }

    /** 目录显示成人认的名字：`primary:Documents/Diary` → `Diary`。 */
    private fun dirLabel(): String {
        val raw = MdCfg.treeUri(a)
        if (raw.isEmpty()) return "未选择"
        if (!SafVault.available(a, raw)) return "授权失效，请重选"
        val segment = runCatching { Uri.parse(raw).lastPathSegment }.getOrNull() ?: return "已选择"
        val decoded = Uri.decode(segment)
        return decoded.substringAfterLast('/').ifEmpty { decoded }
    }
}
