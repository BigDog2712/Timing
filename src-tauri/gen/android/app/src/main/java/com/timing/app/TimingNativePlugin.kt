package com.timing.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.timing.app.native.Prefs
import com.timing.app.native.SafVault
import com.timing.app.overlay.PillService
import java.io.File

/** 镜像目录名；Rust 侧总是把绝对路径显式传进来，这里只是没传时的兜底。 */
private const val MIRROR_DIR = "md-mirror"

private const val UNAUTHORIZED =
    "同步目录未授权：到「设置 → 同步」里选一个 Obsidian 目录（目录会被记住，重启仍然有效）"

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
 *
 * ## 参数为什么手工取
 *
 * 原先用 `invoke.parseArgs(SomeArgs::class.java)`，那条路走 Jackson 反射。发布包开了
 * R8，反射路径一旦被优化掉，异常会被 Tauri 折成一句 `reject`，Rust 再折成 `IO_ERROR`，
 * 用户在设置页只看到「系统调用失败，请重试」——**原因全部丢失**。这里改从 `Invoke.getArgs()`
 * 的 `org.json` 里按 key 取值：不依赖反射、不依赖 `@InvokeArg` 的 keep 规则，也不会因为
 * 多/少一个字段整条命令失败。
 *
 * ## 失败为什么不全 reject
 *
 * 一轮同步里「某个文件读不到」不该让整个「立即同步」弹红字。能继续的就继续，把原因
 * 攒进 `errors` 交回 Rust——它会把它们并进同步报告，用户能看见到底卡在哪一步。
 */
@TauriPlugin
class TimingNativePlugin(private val activity: Activity) : Plugin(activity) {

    /** `mirrorIn` 时的原文，`mirrorOut` 靠它判断「Rust 到底改没改」。 */
    private val original = HashMap<String, String>()

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

    /**
     * vault → 沙箱镜像。清空重建，避免残留昨天的内容。
     *
     * **要么整轮成功，要么一个字节都不动。** 这里对「读不到」的容错不能像 `mirrorOut`
     * 那样各文件独立：Rust 拿不到某个文件时会判定「vault 里还没有今天的日记」，
     * 于是按 SQL 现场渲染一段区块再写回去——如果那次读失败只是因为授权打嗝，
     * 这一步就把用户手写的日记覆盖了。丢数据比同步失败严重得多，所以一律中止。
     */
    @Command
    fun mirrorIn(invoke: Invoke) {
        val args = invoke.getArgs()
        val vault = vault() ?: return invoke.reject(UNAUTHORIZED)

        val root = mirrorDir(args.optString("root"))
        runCatching { root.deleteRecursively() }
        if (!root.isDirectory && !root.mkdirs()) {
            return invoke.reject("沙箱里建不了镜像目录：${root.path}")
        }
        original.clear()

        val rels = pathsOf(args)
        val done = ArrayList<String>()
        for (rel in rels) {
            val found = try {
                vault.findFile(rel)
            } catch (err: Exception) {
                return invoke.reject(
                    "打不开 vault 目录（找 $rel 时）：${err.message ?: err.javaClass.simpleName}",
                )
            }
            /* 没找到 = vault 里确实没有这个文件，是「今天第一次写日记」的正常路径。 */
            val node = found ?: continue

            val text = vault.readText(node)
                ?: return invoke.reject("vault/$rel 能看见但读不出来，为避免覆盖已中止本轮同步")
            val target = File(root, rel)
            target.parentFile?.mkdirs()
            if (runCatching { target.writeText(text) }.isFailure) {
                return invoke.reject("写不进镜像目录 $rel，已中止本轮同步")
            }
            original[rel] = text
            done.add(rel)
        }

        /* 数组必须包成 JSArray（= org.json.JSONArray）。
           直接塞 ArrayList 时，Tauri 把结果序列化成 JSON 的那一步认不出这个类型，
           会退化成 `String.valueOf(list)`，Rust 收到的是 `"files": "[]"`，
           报 `invalid type: string "[]", expected a sequence` —— 0.11.9 真机上
           「立即同步」失败就是这个原因。 */
        val res = JSObject()
        res.put("files", JSArray(done))
        res.put("errors", JSArray())
        /* 真机排查第一现场：请求了几个路径、在 vault 里实际找到几个。两者不等就是
           「路径对不上」——文件在子目录、或日记不叫 `2026-11-06.md`，都长这样。 */
        android.util.Log.i("Timing", "mirrorIn: 请求=$rels 取到=$done")
        invoke.resolve(res)
    }

    /** 镜像 → vault。内容没变的文件不碰，免得把 mtime 推后、惊动同步盘与 Obsidian。 */
    @Command
    fun mirrorOut(invoke: Invoke) {
        val args = invoke.getArgs()
        val vault = vault() ?: return invoke.reject(UNAUTHORIZED)

        val root = mirrorDir(args.optString("root"))
        val errors = ArrayList<String>()
        var written = 0
        for (rel in pathsOf(args)) {
            val file = File(root, rel)
            if (!file.isFile) continue
            val now = runCatching { file.readText() }.getOrNull()
            if (now == null) {
                errors.add("读不到镜像文件 $rel")
                continue
            }
            if (original[rel] == now) continue
            /* vault 里还没有今天的日记时由这里创建——Rust 只认路径，建文件得走 SAF。 */
            val node = vault.findFile(rel) ?: guarded(errors, "在 vault 里新建 $rel") {
                vault.ensureFile(rel)
            }
            if (node == null) {
                errors.add("vault 里建不出 $rel（目录被占用或没有写权限）")
                continue
            }
            if (vault.writeText(node, now)) written++ else errors.add("写不进 vault/$rel")
        }
        original.clear()

        val res = JSObject()
        res.put("written", written)
        /* 同上：ArrayList 会让 Rust 收到字符串而不是数组。 */
        res.put("errors", JSArray(errors))
        invoke.resolve(res)
    }

    /** 用系统里装着的那款编辑器打开今日文件（通常是 Obsidian）。 */
    @Command
    fun safOpen(invoke: Invoke) {
        val args = invoke.getArgs()
        val rel = args.optString("rel")
        val vault = vault() ?: return invoke.reject(UNAUTHORIZED)
        val node = vault.findFile(rel)
            ?: return invoke.reject("vault 里还没有这个文件，先同步一次")

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(vault.uriOf(node.docId), "text/markdown")
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        runCatching { activity.startActivity(Intent.createChooser(intent, "打开日记")) }
            .getOrElse { return invoke.reject("没有能打开 Markdown 的应用") }
        invoke.resolve()
    }

    // ------------------------------------------------------------ 悬浮条

    @Command
    fun overlaySet(invoke: Invoke) {
        val args = invoke.getArgs()
        val enabled = args.optBoolean("enabled", false)
        val style = args.optString("style")
        Prefs.setOverlayEnabled(activity, enabled)
        /* 形态与开关是同一条命令：形态只是「长什么样」，不值得为它单开一条 IPC
           （命令数有静态契约门禁，多一条就要同步改五处）。 */
        val styleChanged = style == "dot" || style == "bar"
        if (style == "dot") Prefs.setOverlayStyle(activity, Prefs.STYLE_DOT)
        if (style == "bar") Prefs.setOverlayStyle(activity, Prefs.STYLE_BAR)

        if (enabled && !Settings.canDrawOverlays(activity)) {
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
            // 服务本来就在跑：切形态要立刻重排，不能等下一次 500ms tick
            if (styleChanged) PillService.refresh(activity)
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

    /** Rust 传进来的绝对路径优先；只有老版本不带这个参数时才退回 `dataDir`。 */
    private fun mirrorDir(root: String): File =
        if (root.isBlank()) File(activity.dataDir, MIRROR_DIR) else File(root)

    private fun pathsOf(args: JSObject): List<String> {
        val arr = args.optJSONArray("paths") ?: return emptyList()
        val out = ArrayList<String>(arr.length())
        for (index in 0 until arr.length()) {
            val rel = arr.optString(index, "")
            if (rel.isNotEmpty() && !out.contains(rel)) out.add(rel)
        }
        return out
    }

    /** 单步操作的安全网：异常被记进 `errors` 并返回 null，调用方 `continue`。 */
    private fun <T> guarded(errors: MutableList<String>, what: String, body: () -> T?): T? =
        runCatching(body).getOrElse {
            errors.add("$what 失败：${it.message ?: it.javaClass.simpleName}")
            null
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
        res.put(
            "style",
            if (Prefs.overlayStyle(activity) == Prefs.STYLE_BAR) "bar" else "dot",
        )
        invoke.resolve(res)
    }
}
