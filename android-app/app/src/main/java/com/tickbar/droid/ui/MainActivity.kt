package com.tickbar.droid.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsetsController
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.tickbar.droid.core.Crash
import com.tickbar.droid.core.Prefs
import com.tickbar.droid.core.Repo
import com.tickbar.droid.core.TimerCore
import com.tickbar.droid.core.Tk
import com.tickbar.droid.core.md.MdSync
import com.tickbar.droid.overlay.OverlayCtl
import com.tickbar.droid.overlay.OverlayService

/**
 * App 外壳：一条顶部授权提示 + 一个内容区 + 四个页签（计时 / 事项 / 记录 / 设置）。
 *
 * 这里刻意不用 Fragment / Navigation：四个页面是常驻对象，切页只是换 View，
 * 状态天然保留（比如计时页的 ticker 停了再起不会丢）。
 */
class MainActivity : Activity() {

    companion object {
        const val EXTRA_TAB = "tab"

        /** 选 Obsidian 目录的请求码。 */
        private const val REQ_TREE = 0x71
    }

    private lateinit var host: FrameLayout
    private lateinit var banner: Notice.Bar
    private lateinit var navBar: View

    /** 二级页（便利贴编辑）。页签名之外的唯一一层，返回键按它分层。 */
    lateinit var router: Router
        private set
    private val pages = mutableListOf<Page>()
    private val nav = mutableListOf<TextView>()
    private var index = 0

    private var treeCb: ((Uri?) -> Unit)? = null

    /** 同步执行器：互斥 + 撞车回调排队 + 节拍器（细节见 [SyncRunner]）。 */
    private val sync = SyncRunner(this) { pages.getOrNull(index)?.onShow() }

    private fun d(v: Int) = Tk.dp(this, v)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 上一次若崩过，先把堆栈取出来（取完即删，只显示这一次）
        val crash = Crash.take(this)

        // 主题必须在任何 View 创建之前定下来（Tk 的色值是读时求值的，晚了就半深半浅）。
        // 读偏好 / 改系统栏都可能因 ROM 差异抛异常，包一层，失败就用默认深色。
        runCatching { Tk.mode = Prefs.theme(this) }
        runCatching { applySystemBarIcons() }

        // 库打不开就降级为纯内存 + 首屏黄条：宁可这一次不落盘，也不能让 App 起不来
        val dbOk = runCatching {
            Repo.init(this)
            TimerCore.store = Repo
            TimerCore.minRecordMs = Prefs.minRecordMs(this)
            TimerCore.reloadToday()
        }.isSuccess && Repo.ready

        runCatching { OverlayCtl.requestNotifications(this) }

        // 五个页签一次性构造：任何一页抛异常都不能牵连其他页（否则就是「打开即闪退」）
        pages += safePage("计时") { TimerPage(this) }
        pages += safePage("事项") { TodoPage(this) }
        pages += safePage("便利贴") { NotesPage(this) }
        pages += safePage("记录") { RecordsPage(this) }
        pages += safePage("设置") { SettingsPage(this) }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Tk.PLATE)
        }

        // targetSdk 35 起系统强制「边到边」：内容会画到状态栏 / 导航栏底下。
        // 统一交给 Insets（它连键盘高度一起算，见该文件注释）。
        Insets.apply(this, root)

        // 提示条本身也不能成为崩溃源：它建不出来就退化成一条空 View
        banner = runCatching { Notice.build(this, crash, dbOk) }
            .getOrElse { Notice.Bar(LinearLayout(this), isPermissionHint = false) }
        root.addView(banner.view)

        host = FrameLayout(this)
        root.addView(host, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        navBar = runCatching { buildNav() }.getOrElse { View(this) }
        root.addView(navBar)

        setContentView(root)
        router = Router(
            this,
            host,
            navBar,
            onCover = { covered -> pages.forEach { it.view.visibility = if (covered) View.GONE else View.VISIBLE } },
            onRestore = { show(index) },
        )
        runCatching { show(savedInstanceState?.getInt(EXTRA_TAB) ?: 0) }
    }

    /** 单页构造失败 → 用占位页顶替，其余页照常。 */
    private fun safePage(name: String, make: () -> Page): Page =
        runCatching { make() }.getOrElse { FallbackPage(this, name, it) }

    /**
     * 浅色主题下状态栏 / 导航栏要换成「深色图标」，否则白底白字。
     * 边到边模式下系统栏是透明的，图标颜色只能用 insetsController 改。
     */
    private fun applySystemBarIcons() {
        // 窗口底色跟着主题走，否则浅色主题启动瞬间会闪一下深色（themes.xml 里的静态值）
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Tk.PLATE))
        if (Build.VERSION.SDK_INT < 30) return
        val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(if (Tk.dark) 0 else light, light)
    }

    // ------------------------------------------------------------ 底部导航

    private fun buildNav(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Tk.PANEL)
        }
        listOf("计时", "事项", "便利贴", "记录", "设置").forEachIndexed { i, label ->
            val item = TextView(this).apply {
                text = label
                textSize = 12f
                gravity = Gravity.CENTER
                includeFontPadding = false
                setPadding(0, d(16), 0, d(16))
                isClickable = true
                setOnClickListener { show(i) }
            }
            nav += item
            bar.addView(item, LinearLayout.LayoutParams(0, Ui.WRAP, 1f))
        }
        return bar
    }

    // ------------------------------------------------------------ 切页

    /**
     * 切页：只切 visibility，**不重挂 View**。
     *
     * 旧实现每次 `removeAllViews()` + `addView`：View 被 detach/attach 一次，整页重新
     * measure/layout、ScrollView 滚动位置丢失、`NotesPage` 的 attach 监听又全量重建一次。
     */
    private fun show(i: Int) {
        if (pages.isEmpty()) return
        index = i.coerceIn(0, pages.size - 1)
        mountPages()
        pages.forEachIndexed { idx, p ->
            p.view.visibility = if (idx == index) View.VISIBLE else View.GONE
        }
        pages[index].let { p -> runCatching { p.onShow() } }
        nav.forEachIndexed { idx, t ->
            val on = idx == index
            t.setTextColor(if (on) Tk.ACCENT else Tk.INK_DIM)
            t.setTypeface(t.typeface, if (on) Typeface.BOLD else Typeface.NORMAL)
        }
    }

    /**
     * 把所有页挂到内容区。判据是 **`view.parent == null`**，不是「挂过没有」：
     * 二级页 `Router`（或将来任何整区替换）都可能把页签 View 摘下来，只记一个「已挂载」
     * 布尔就会让 [show] 以为已经挂好、只切 visibility —— 结果是回到原页签看到一片空白。
     * 所以每页自己对自己负责：没 parent 才挂，已有 parent 一律不动（也不会重复 addView）。
     */
    private fun mountPages() {
        val fill = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        )
        for (p in pages) if (p.view.parent == null) host.addView(p.view, fill)
    }

    // ------------------------------------------------------------ 同步

    /**
     * 让用户选一个目录作为同步落点（Obsidian vault 里的任意目录）。
     *
     * 必须走 SAF：Android 11 起应用不能按裸路径写共享存储。选完由调用方
     * `takePersistableUriPermission` 把授权长期化，之后重启仍然能读写。
     */
    @Suppress("DEPRECATION")
    fun pickVaultDir(cb: (Uri?) -> Unit) {
        treeCb = cb
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        runCatching { startActivityForResult(intent, REQ_TREE) }
            .onFailure {
                treeCb = null
                cb(null)
            }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_TREE) return
        val cb = treeCb
        treeCb = null
        cb?.invoke(if (resultCode == RESULT_OK) data?.data else null)
    }

    /**
     * 跑一轮同步（设置页「立即同步」等调用点用）。互斥、回调排队、页面刷新都在
     * [SyncRunner] 里，这里只是转调，避免外壳继续变厚。
     */
    fun requestSync(onDone: ((MdSync.Report) -> Unit)? = null) = sync.request(onDone)

    // ------------------------------------------------------------ 生命周期

    override fun onResume() {
        super.onResume()
        // 只对「去授权」那条做显隐：崩溃 / 库异常的提示不该被一授权就顺手藏掉
        if (::banner.isInitialized && banner.isPermissionHint) {
            banner.view.visibility = if (OverlayCtl.canDraw(this)) View.GONE else View.VISIBLE
        }
        // 授权返回 / 开关变更后在这里收口：该开就开，该关就关
        runCatching { OverlayService.sync(this) }
        pages.getOrNull(index)?.let { p -> runCatching { p.onShow() } }

        /* 回前台立刻同步一次，之后由 ticker 按上一轮结果排下一次 */
        sync.start()
    }

    override fun onPause() {
        super.onPause()
        sync.stop()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.getIntExtra(EXTRA_TAB, index)?.let { show(it) }
    }

    override fun onBackPressed() {
        // 三层：先关二级页（全屏编辑），再回首页签，最后才是退到后台
        if (::router.isInitialized && router.close()) return
        if (index != 0) show(0) else super.onBackPressed()
    }
}
