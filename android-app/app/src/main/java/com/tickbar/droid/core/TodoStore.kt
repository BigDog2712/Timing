package com.tickbar.droid.core

/**
 * 待办的读写门面。数据在 SQLite 的 `todos` 表，这里只是一份内存镜像，
 * 好让列表渲染不用每次都查库（也避免渲染期间游标还开着）。
 *
 * 增删改都是「先落库、再改内存」，落库失败（id=0）就不进列表 —— 宁可看不见，也不要骗人。
 */
object TodoStore {

    data class Todo(val id: Long, val title: String, var done: Boolean)

    val items = mutableListOf<Todo>()

    private var loaded = false

    /** 首次访问自动拉一次；之后靠增删改保持同步。 */
    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        items.clear()
        items.addAll(RepoTodo.load().map { Todo(it.id, it.title, it.done) })
    }

    fun add(title: String) {
        val t = title.trim()
        if (t.isEmpty()) return
        val id = RepoTodo.add(t)
        if (id <= 0L) return
        items.add(0, Todo(id, t, false))
    }

    fun toggle(t: Todo) {
        t.done = !t.done
        RepoTodo.setDone(t.id, t.done)
    }

    fun remove(t: Todo) {
        items.remove(t)
        RepoTodo.remove(t.id)
    }

    val remaining: Int get() = items.count { !it.done }

    /** 单测 / 清空数据后用。 */
    internal fun reset() {
        items.clear()
        loaded = false
    }
}
