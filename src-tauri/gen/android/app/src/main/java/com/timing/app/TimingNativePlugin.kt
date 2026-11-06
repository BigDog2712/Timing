package com.timing.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.timing.app.native.Prefs
import com.timing.app.native.SafVault
import com.timing.app.overlay.PillService
import java.io.File

/** 与 Rust 侧 `commands/md_sync_cmd_mobile.rs` 的 `MIRROR_DIR` 必须一致。 */
private const val MIRROR_DIR = "md-mirror"

private const val UNAUTHORIZED =
    "同步目录未授权：到「设置 → 同步」里选一个 Obsidian 目录（目录会被记住，重启仍然有效）"

@InvokeArg
class MirrorArgs {
    var paths: List<String> = emptyList()
}

@InvokeArg
class OpenArgs {
    lateinit var rel: String
}

@InvokeArg
class OverlayArgs {
    var enabled: Boolean = false
}

/**
 * 原生能力桥（Rust ⇄ Kotlin）。
 *
 * 两类能力：
 * 1. **SAF 目录**：选目录、把当天文件镜像进沙箱、把改动写回。合并规则在 Rust，这里只搬字节。
 * 2. **悬浮条**：前台服务 + OVERLAY 窗口，只读数据库显示，点击回主界面。
 *
 * 与 Rust 的对应关系：Rust 侧 `infra/native_bridge.rs` 用 `run_mobile_plugin_async`
 * 调这里的 `@Command`；类名在 `lib.rs` 的 `register_android_plugin("com.timing.app",
 * "TimingNativePlugin")` 里登记，两边改名必须同时改。
 */
@TauriPlugin
class TimingNativePlugin(private val activity: Activity) : Plugin(activity) {

    /** `mirrorIn` 时的原文，`mirrorOut` 靠它判断「Rust 到底改没改」。 */
    private val original = HashMap<String, String>()

    private val mirrorRoot: File get() = File(activity.dataDir, MIRROR_DIR)

    // ------------------------------------------------------------ SAF

    @Command
    fun safStatus(invoke: Invoke) {
        resolveSaf(invoke)
    }

    @Command
    fun safPickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        runCatching { startActivityForResult(invoke, intent, "onFolderPicked") }
            .getOrElse { invoke.reject("打不开系统目录选择器：${it.message}") }
    }

    @ActivityCallback
    fun onFolderPicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            /* 取消不是错误：如实回「未授权」。报错会让设置页弹一句无意义的红字。 */
            resolveSaf(invoke)
            return
        }
        if (!SafVault.persist(activity, uri)) {
            invoke.reject("系统没有授予长期访问权限，换一个目录再试")
            return
        }
        Prefs.setTreeUri(activity, uri.toString())
        resolveSaf(invoke)
    }

    /** vault → 沙箱镜像。只复制存在的文件；清空重建，避免残留昨天的内容。 */
    @Command
    fun mirrorIn(invoke: Invoke) {
        val args = invoke.parseArgs(MirrorArgs::class.java)
        val vault = vault() ?: return invoke.reject(UNAUTHORIZED)

        val root = mirrorRoot
        root.deleteRecursively()
        if (!root.isDirectory && !root.mkdirs()) {
            return invoke.reject("沙箱里建不了镜像目录：${root.path}")
        }
        original.clear()

        val done = ArrayList<String>()
        for (rel in args.paths) {
            val node = vault.findFile(rel) ?: continue
            val text = vault.readText(node) ?: continue
            val target = File(root, rel)
            target.parentFile?.mkdirs()
            if (runCatching { target.writeText(text) }.isFailure) continue
            original[rel] = text
            done.add(rel)
        }

        val res = JSObject()
        res.put("files", done)
        invoke.resolve(res)
    }

    /** 镜像 → vault。内容没变的文件不碰，免得把 mtime 推后、惊动同步盘与 Obsidian。 */
    @Command
    fun mirrorOut(invoke: Invoke) {
        val args = invoke.parseArgs(MirrorArgs::class.java)
        val vault = vault() ?: return invoke.reject(UNAUTHORIZED)

        var written = 0
        for (rel in args.paths) {
            val file = File(mirrorRoot, rel)
            if (!file.isFile) continue
            val now = runCatching { file.readText() }.getOrNull() ?: continue
            if (original[rel] == now) continue
            /* vault 里还没有今天的日记时由这里创建——Rust 只认路径，建文件得走 SAF。 */
            val node = vault.findFile(rel) ?: vault.ensureFile(rel) ?: continue
            if (vault.writeText(node, now)) written++
        }
        original.clear()

        val res = JSObject()
        res.put("written", written)
        invoke.resolve(res)
    }

    /** 用系统里装着的那款编辑器打开今日文件（通常是 Obsidian）。 */
    @Command
    fun safOpen(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        val vault = vault() ?: return invoke.reject(UNAUTHORIZED)
        val node = vault.findFile(args.rel)
            ?: return invoke.reject("vault 里还没有这个文件，先同步一次")

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(vault.uriOf(node.docId), "text/markdown")
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        runCatching { activity.startActivity(Intent.createChooser(intent, "打开日记")) }
            .getOrElse { return invoke.reject("没有能打开 Markdown 的应用") }
        invoke.resolve()
    }

    // ------------------------------------------------------------ 悬浮条

    @Command
    fun overlaySet(invoke: Invoke) {
        val args = invoke.parseArgs(OverlayArgs::class.java)
        Prefs.setOverlayEnabled(activity, args.enabled)

        if (args.enabled && !Settings.canDrawOverlays(activity)) {
            /* 拉起系统授权页；用户回来后 `onResume` 会真正把服务起来。
               这里不同步返回「已开启」——没权限时那就是假话。 */
            runCatching {
                activity.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${activity.packageName}"),
                    ),
                )
            }
        } else {
            PillService.sync(activity)
        }
        resolveOverlay(invoke)
    }

    @Command
    fun overlayStatus(invoke: Invoke) {
        resolveOverlay(invoke)
    }

    /** 从系统授权页返回时补一次：开关已存 true，权限也给了，就该把服务起来。 */
    override fun onResume(activity: AppCompatActivity) {
        super.onResume(activity)
        runCatching { PillService.sync(activity) }
    }

    // ------------------------------------------------------------ 内部

    private fun vault(): SafVault? {
        val uri = Prefs.treeUri(activity)
        if (!SafVault.available(activity, uri)) return null
        return SafVault.open(activity, uri)
    }

    private fun resolveSaf(invoke: Invoke) {
        val uri = Prefs.treeUri(activity)
        val granted = SafVault.available(activity, uri)
        val res = JSObject()
        res.put("granted", granted)
        res.put("label", if (granted) SafVault.open(activity, uri)?.describe() ?: "" else "")
        invoke.resolve(res)
    }

    private fun resolveOverlay(invoke: Invoke) {
        val res = JSObject()
        res.put("permitted", Settings.canDrawOverlays(activity))
        res.put("enabled", Prefs.overlayEnabled(activity))
        invoke.resolve(res)
    }
}
