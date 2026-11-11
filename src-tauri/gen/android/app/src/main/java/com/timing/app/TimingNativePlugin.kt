package com.timing.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.webkit.WebView
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
import com.timing.app.native.UsageStats
import com.timing.app.native.SecretStore
import com.timing.app.overlay.PillService
import java.io.File
import org.json.JSONObject

/** 镜像目录名；Rust 侧总是把绝对路径显式传进来，这里只是没传时的兜底。 */
private const val MIRROR_DIR = "md-mirror"

private const val UNAUTHORIZED =
    "同步目录未授权：到「设置 → 同步」里选一个 Obsidian 目录（目录会被记住，重启仍然有效）"

/**
 * 原生能力桥（Rust ⇄ Kotlin）。
 *
 * 三类能力：
 * 1. **SAF 目录**：选目录、把当天文件镜像进沙箱、把改动写回。合并规则在 Rust，这里只搬字节。
 * 2. **悬浮条**：前台服务 + OVERLAY 窗口。显示只读数据库；短按把「开始 / 暂停 / 继续」
 *    交给前端走同一套状态机（[V0.11.22]），长按回主界面。
 * 3. **备份导出**（[V0.11.23]）：系统「保存到…」→ 用户挑位置 → 把 Rust 指定的那份备份
 *    写进去。路径与名字都由 Rust 算，这里只搬字节。
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

    /**
     * 悬浮条那一按的投递口（[V0.11.22]；[V0.11.32] 换成 `evaluateJavascript`）。
     *
     * ## 为什么不用 `Plugin.trigger` + `addPluginListener` 了
     *
     * 那条路要两端都「注册成功」：前端 `addPluginListener` 内部发
     * `plugin:timing-native|registerListener`，而这个命令是 Tauri 自己实现的，走
     * `invoke.parseArgs(RegisterListenerArgs::class.java)` —— 也就是 **Jackson 反射**。
     * 本仓为了躲 R8 的反射问题，早把自己的 `parseArgs` 全换成了 `getArgs()`，却在这条链上
     * 留了别人的反射。注册一旦失败，前端 `.catch()` 把它吞掉、`hasListener` 永远为 false，
     * 表现就是主人报的「点按只有圆点展开、计时一动不动」，而且两端都不报错。
     *
     * 现在只做一件事：把那段 JS 丢给 WebView 执行。没有注册、没有反射、没有中间态。
     * 名字与前端 `PILL_ENTRY` 必须逐字一致（判据在 `usePillAction.source.test.ts`）。
     */
    override fun load(webView: WebView) {
        PillService.bridge = { js ->
            /* Service 在后台线程按的，`evaluateJavascript` 必须在 UI 线程；
               WebView 已被销毁时 post 仍会走，里面的 runCatching 吃掉异常——
               这一按不会因此崩掉 App，返回值也不代表"执行成功"（成败由 Service 核对）。 */
            runCatching {
                webView.post { runCatching { webView.evaluateJavascript(js, null) } }
            }
            Unit
        }
    }

    override fun onDestroy() {
        PillService.bridge = null
    }

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

    // ------------------------------------------------------------ 备份导出（[V0.11.23]）

    /**
     * 上一次导出要写出去的那个文件。
     *
     * 为什么不在回调里再读一遍 `invoke.getArgs()`：`@ActivityCallback` 拿到的是同一个
     * `Invoke`，但参数能不能再读没有任何保证（resolve/reject 之后它就被释放了）。
     * 落一个字段，回调只认它；每次点导出无条件覆盖，所以「上一次取消的路径」不会串过来。
     */
    private var pendingExport: String? = null

    /**
     * 导出一份备份：系统「保存到…」→ 用户挑位置 → 把那几个字节写进去。
     *
     * `path` 由 Rust 算好（`services::md_backup_export::source`：名字校验 + 路径闸 + 建议名），
     * 这里**只搬字节**。为什么不让字节过桥：Rust 与 Kotlin 在同一个进程、同一个私有目录，
     * 让 Kotlin 直接读那个文件比 base64 过一遍 JSON 省事，也不会把一份 md 撑成两倍大。
     *
     * 名字也没在这里改：Kotlin 拿到的 `name` 已经是去掉落点前缀的导出名，只用作
     * `EXTRA_TITLE`（扩展名随它走，所以存下来仍是 `.md`）。
     */
    @Command
    fun exportBackup(invoke: Invoke) {
        val args = invoke.getArgs()
        val name = args.optString("name")
        val path = args.optString("path")
        if (name.isEmpty() || path.isEmpty()) return invoke.reject("导出缺少文件名")
        if (!File(path).isFile) {
            return invoke.reject("这份备份已经不在了（备份只保留最近 30 份）")
        }

        pendingExport = path
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            /* `text/markdown` 是准的那个。个别文件管理器按 MIME 过滤、看不到目标目录时，
               退路是把这一行改成 `text/plain`——扩展名由 EXTRA_TITLE 带，不受影响。 */
            type = "text/markdown"
            putExtra(Intent.EXTRA_TITLE, name)
        }
        runCatching { startActivityForResult(invoke, intent, "onExportPicked") }
            .getOrElse {
                pendingExport = null
                invoke.reject("打不开系统保存对话框：${it.message ?: it.javaClass.simpleName}")
            }
    }

    /**
     * 保存对话框的回执。
     *
     * **取消不 reject**：与 `onFolderPicked` 同口径——按返回是正常操作，报错只会让界面弹
     * 一句无意义的红字。写失败则相反：必须带原文 reject、并留一条 logcat，否则
     * 「写不进去」和「用户取消」在界面上长得一模一样（v0.11.22 在 `TimerReader` 上刚踩过）。
     */
    @ActivityCallback
    fun onExportPicked(invoke: Invoke, result: ActivityResult) {
        val path = pendingExport
        pendingExport = null
        val uri = result.data?.data
        val res = JSObject()
        if (result.resultCode != Activity.RESULT_OK || uri == null || path == null) {
            res.put("saved", false)
            return invoke.resolve(res)
        }
        try {
            val bytes = File(path).readBytes()
            activity.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: return invoke.reject("系统没有给出可写的目标位置")
            res.put("saved", true)
            invoke.resolve(res)
        } catch (err: Exception) {
            android.util.Log.w("TimingExport", "导出失败 uri=$uri: ${err.message}", err)
            invoke.reject("写入失败：${err.message ?: err.javaClass.simpleName}")
        }
    }

    // ------------------------------------------------------------ 应用使用统计

    /**
     * 特殊权限状态（`PACKAGE_USAGE_STATS`）。
     *
     * 与悬浮条同一条纪律：**偏好与系统状态分开报**。这里有 `granted` 一项就够，
     * 因为「用户想不想要统计」是宿主 settings 的事，不是安卓权限的事。
     */
    @Command
    fun usagePermission(invoke: Invoke) {
        val payload = JSObject()
        payload.put("granted", UsageStats.hasPermission(activity))
        invoke.resolve(payload)
    }

    /** 跳系统「使用情况访问」页。能不能授上是用户的事，这里只负责把他送到门口。 */
    @Command
    fun usageOpenSettings(invoke: Invoke) {
        UsageStats.openSettings(activity)
        invoke.resolve()
    }

    /**
     * 取 [fromMs, toMs) 的前台时长（按包聚合），Rust → Kotlin。
     *
     * 参数用 `invoke.getArgs()` 的 `org.json` 取值，不用 `@InvokeArg` + `parseArgs(Class)`：
     * 后者走 Jackson 反射，release 包开 R8 时反射链被优化掉会把异常折成一句
     * 「系统调用失败」，症状与业务失败无法区分（ADR-055）。
     */
    @Command
    fun usageDay(invoke: Invoke) {
        val args = invoke.getArgs()
        val from = args.optLong("from", 0L)
        val to = args.optLong("to", 0L)
        val payload = JSObject()
        if (from <= 0L || to <= from) {
            payload.put("rows", JSArray())
            payload.put("granted", UsageStats.hasPermission(activity))
            invoke.resolve(payload)
            return
        }
        /* ADR-056：跨桥的列表只许 JSArray（org.json.JSONArray 直接 put 会被序列化成字符串） */
        payload.put("rows", JSArray(UsageStats.queryDay(activity, from, to)))
        payload.put("granted", true)
        invoke.resolve(payload)
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

    /**
     * 悬浮条的显示快照（[V0.11.27]，Rust → Kotlin）。
     *
     * 由 Rust 在**每次计时状态迁移**时推来（`app::overlay_push`），落进 `Prefs` 再让服务
     * 立刻重画。字段名与 `models::overlay::OverlaySnapshot` 的 camelCase 一一对应。
     *
     * 为什么不在这里直接读库：v0.11.22 的做法（原生直读 `timing.db`）在真机上失败过一次，
     * 失败时只有一行被吞掉的异常，用户看到「主界面在计时、悬浮条不动」。显示源改成
     * 状态机算出来的快照之后，原生侧不需要理解库，也就不会再有两份口径。
     */
    @Command
    fun overlayPush(invoke: Invoke) {
        val args = invoke.getArgs()
        val snap = JSONObject().apply {
            put("status", args.optString("status", "idle"))
            put("item", args.optString("item", ""))
            put("accumulatedSec", args.optLong("accumulatedSec", 0L))
            /* null 要原样保留：`optLong` 对 JSON 的 null 会给 0，而 0 是一个合法的墙钟时刻
               （1970），拿它当锚点会算出五十六年的时长。 */
            if (args.isNull("runningSince")) put("runningSince", JSONObject.NULL)
            else put("runningSince", args.optLong("runningSince", 0L))
            put("mode", args.optString("mode", "countup"))
            put("targetSec", args.optLong("targetSec", 0L))
        }
        Prefs.setOverlaySnapshot(activity, snap.toString())
        /* 只在开关打开时叫醒服务：`refresh` 走的是 `startService`，对没开的用户来说
           那等于「每次开始计时都凭空起一个前台服务 + 一条常驻通知」——功能关了还冒出来，
           是比不显示更糟的错。快照照存不误：用户之后打开开关，第一帧就该是对的。 */
        if (Prefs.overlayEnabled(activity)) PillService.refresh(activity)
        invoke.resolve()
    }

    /**
     * 取走「悬浮条被按了一下」的标记（[V0.11.27]，前端在回到前台时调用）。
     *
     * 返回 `{pending, ageMs}`：`pending=true` 表示这一按**没有被** WebView 里的监听者接走
     * （否则前端收到事件时已经清掉了），调用方补做一次切换。
     *
     * `ageMs` 让调用方能自己决定要不要认：一个昨天按的标记不该在今天打开 App 时突然
     * 把计时切一下。
     */
    @Command
    fun overlayTakeTap(invoke: Invoke) {
        /* [V0.11.28] 标记里多带一个「动作类型」：通知栏的「结束」也要靠这条兜底通道补做，
           只回一个时间戳的话前端只能猜 —— 猜成「切换」就会把已经结束的计时又开起来。 */
        val action = Prefs.pendingAction(activity)
        val res = JSObject()
        res.put("pending", action != null)
        res.put("action", action?.kind ?: "")
        res.put(
            "ageMs",
            if (action != null) System.currentTimeMillis() - action.at else -1L,
        )
        if (action != null) Prefs.clearPendingAction(activity)
        invoke.resolve(res)
    }

    /** 事件已经有人接走：把标记清掉，避免回前台时再补做一次（那样会变成两下）。 */
    @Command
    fun overlayClearTap(invoke: Invoke) {
        Prefs.clearPendingAction(activity)
        invoke.resolve()
    }

    /** 从系统授权页返回时补一次：开关已存 true，权限也给了，就该把服务起来。 */
    override fun onResume(activity: AppCompatActivity) {
        super.onResume(activity)
        runCatching { PillService.sync(activity) }
    }

    // ------------------------------------------------------------ 凭据存储

    /* WebDAV 应用密码（V0.11.13）。Rust 侧 `infra/secret_bridge.rs` 调这三条，
       加解密与落盘全在 `native/SecretStore.kt`。参数走 `getArgs()`（ADR-055），
       回值 `JSObject`（ADR-056），失败 `reject` 且把原文带上——不然排障只剩一句「系统调用失败」。

       注意：`secretGet` 在**没有值时不放** `value` 键，Rust 侧 `Option<String>` 才是 `None`；
       放空串会被当成"存了一个空密码"。 */

    @Command
    fun secretPut(invoke: Invoke) {
        val args = invoke.getArgs()
        val key = args.optString("key")
        if (key.isBlank()) return invoke.reject("凭据键为空：这是程序错误，请反馈")
        runCatching { SecretStore.put(activity, key, args.optString("value")) }
            .onSuccess { invoke.resolve() }
            .onFailure {
                invoke.reject("存不下应用密码：${it.message ?: it.javaClass.simpleName}")
            }
    }

    @Command
    fun secretGet(invoke: Invoke) {
        val key = invoke.getArgs().optString("key")
        if (key.isBlank()) return invoke.reject("凭据键为空：这是程序错误，请反馈")
        runCatching { SecretStore.get(activity, key) }
            .onSuccess { stored ->
                val res = JSObject()
                if (stored != null) res.put("value", stored)
                invoke.resolve(res)
            }
            .onFailure {
                invoke.reject("取不出应用密码：${it.message ?: it.javaClass.simpleName}")
            }
    }

    @Command
    fun secretClear(invoke: Invoke) {
        val key = invoke.getArgs().optString("key")
        if (key.isBlank()) return invoke.reject("凭据键为空：这是程序错误，请反馈")
        runCatching { SecretStore.clear(activity, key) }
            .onSuccess { invoke.resolve() }
            .onFailure {
                invoke.reject("清不掉应用密码：${it.message ?: it.javaClass.simpleName}")
            }
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
