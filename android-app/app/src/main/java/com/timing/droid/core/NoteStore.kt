package com.timing.droid.core

/**
 * 便利贴的读写门面。手法与 [TodoStore] 一致：内存里留一份镜像，界面渲染不碰游标。
 *
 * 一个例外：**列表里不显示空白便利贴**。新建时会先落一行空记录（这样编辑页一有输入
 * 就只是 update，不用「先建后改」两段逻辑），而空记录在界面上是噪音——用户从编辑页
 * 直接返回时它就该消失。真正删行由 `NoteEditPage` 在返回时做（对齐桌面「取消不留空贴」）。
 */
object NoteStore {

    /** 最近改过在前（`RepoNote.list()` 已经排好序）。 */
    val items = mutableListOf<RepoNote.Note>()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        reload()
    }

    fun reload() {
        loaded = true
        items.clear()
        items.addAll(RepoNote.list())
    }

    /** 界面上要展示的那些（滤掉空白）。 */
    val visible: List<RepoNote.Note> get() = items.filter { !it.blank }

    val count: Int get() = visible.size

    /**
     * 当前事项名：计时中/暂停的会话事项优先，空闲时是上一次用过的事项
     * （`TimerCore` 结束时会把它留在 `Snapshot.item` 里）。
     *
     * 这就是桌面「便利贴默认绑定当前事项」的同一口径：新建的贴自动有归属，
     * 不会散落成一堆无主便条。
     */
    fun currentItemName(): String? =
        TimerCore.current().item.trim().takeIf { it.isNotEmpty() }

    /** 新建一张空便利贴，返回本地 id（0 = 落库失败，调用方不再进编辑页）。 */
    fun create(itemName: String? = currentItemName()): Long {
        val id = RepoNote.create(itemName, "")
        if (id <= 0L) return 0L
        reload()
        return id
    }

    /** 改正文；同时把内存镜像里的那条换掉，避免返回列表时看到旧内容。 */
    fun setContent(id: Long, content: String) {
        if (RepoNote.setContent(id, content) == 0) return
        replace(id)
    }

    /** 改关联事项（null = 解绑成随记）。 */
    fun setItem(id: Long, itemName: String?) {
        if (RepoNote.setItem(id, itemName) == 0) return
        replace(id)
    }

    fun remove(id: Long) {
        RepoNote.softDelete(id)
        items.removeAll { it.id == id }
    }

    fun get(id: Long): RepoNote.Note? = items.firstOrNull { it.id == id } ?: RepoNote.get(id)

    /** 空白便利贴：返回时该删掉，而不是留一张看不见的便条。 */
    fun isBlank(id: Long): Boolean = get(id)?.blank ?: true

    /** 单测 / 清空数据后用。 */
    internal fun reset() {
        items.clear()
        loaded = false
    }

    private fun replace(id: Long) {
        val fresh = RepoNote.get(id) ?: return
        val index = items.indexOfFirst { it.id == id }
        if (index >= 0) items[index] = fresh else items.add(0, fresh)
        items.sortByDescending { it.updatedAt }
    }
}
