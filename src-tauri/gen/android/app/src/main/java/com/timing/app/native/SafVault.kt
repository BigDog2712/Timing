package com.timing.app.native

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract

/**
 * 用 **SAF（Storage Access Framework）** 读写程序外部的目录。
 *
 * ## 为什么不用路径
 *
 * Android 11 起，应用不能再用 `/storage/emulated/0/...` 这种裸路径写共享存储（会
 * `EACCES`）。Obsidian 的 vault 恰好就在共享存储里，所以唯一合法的通道是 SAF：用户
 * 在弹出的系统选择器里点一次目录，我们拿到一个 `content://.../tree/...` 的 URI，再用
 * `takePersistableUriPermission` 把这个授权**长期化**（重启后依然有效）。
 *
 * ## 为什么不用 AndroidX 的 DocumentFile
 *
 * 只要一层薄包装就要多拖一个 artifact，而这里用到的东西 `DocumentsContract` 全都有。
 *
 * ## 一个必须守住的细节
 *
 * 所有派生 URI 都必须用 `buildDocumentUriUsingTree(treeUri, docId)` 构造。直接拼
 * `content://authority/document/...` 会丢掉 tree 授权、抛 `SecurityException`。
 * 这不是风格问题，是「能读写」和「全崩」的区别。
 */
class SafVault(private val ctx: Context, val treeUri: Uri) {

    /** 目录里的一个条目。 */
    data class Node(
        val docId: String,
        val name: String,
        val dir: Boolean,
        val modified: Long,
    )

    private val resolver: ContentResolver get() = ctx.contentResolver
    private val rootId: String by lazy { DocumentsContract.getTreeDocumentId(treeUri) }

    /** 供「打开文件」用：把一个条目换成可对外授权的 `content://` URI。 */
    fun uriOf(docId: String): Uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)

    private fun children(parentId: String): List<Node> {
        val out = ArrayList<Node>()
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
        resolver.query(
            uri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            ),
            null,
            null,
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                out.add(
                    Node(
                        docId = cursor.getString(0),
                        name = cursor.getString(1) ?: "",
                        dir = cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR,
                        modified = if (cursor.isNull(3)) 0L else cursor.getLong(3),
                    ),
                )
            }
        }
        return out
    }

    private fun find(parentId: String, name: String): Node? =
        children(parentId).firstOrNull { it.name == name }

    /** 只找不建。用于「本机没数据时不要凭空在 vault 里造一篇日记」。 */
    fun findFile(relPath: String): Node? {
        val parts = relPath.split('/').map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.isEmpty()) return null
        var parentId = rootId
        for (index in 0 until parts.size - 1) {
            val dir = find(parentId, parts[index]) ?: return null
            if (!dir.dir) return null
            parentId = dir.docId
        }
        return find(parentId, parts.last())
    }

    /** 找到或创建多级路径上的文件（`2026/11/2026-11-03.md` 这种模板也能用）。 */
    fun ensureFile(relPath: String): Node? {
        val parts = relPath.split('/').map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.isEmpty()) return null

        var parentId = rootId
        for (index in 0 until parts.size - 1) {
            val name = parts[index]
            val dir = find(parentId, name) ?: create(parentId, name, dir = true) ?: return null
            // 同名文件占着目录位：宁可失败，也不删用户的东西
            if (!dir.dir) return null
            parentId = dir.docId
        }
        val leaf = parts.last()
        find(parentId, leaf)?.let { return it }
        return create(parentId, leaf, dir = false)
    }

    private fun create(parentId: String, name: String, dir: Boolean): Node? {
        if (dir) {
            val created = runCatching {
                DocumentsContract.createDocument(
                    resolver,
                    uriOf(parentId),
                    DocumentsContract.Document.MIME_TYPE_DIR,
                    name,
                )
            }.getOrNull()
            if (created == null) return find(parentId, name)
            return Node(DocumentsContract.getDocumentId(created), name, true, 0L)
        }
        /* 各家 provider 对 mime 与扩展名的匹配要求不一，逐个降级重试。 */
        val candidates = when {
            name.endsWith(".md", true) ->
                listOf("text/markdown", "text/plain", "application/octet-stream")
            name.endsWith(".txt", true) -> listOf("text/plain", "application/octet-stream")
            else -> listOf("application/octet-stream")
        }
        for (mime in candidates) {
            val created = runCatching {
                DocumentsContract.createDocument(resolver, uriOf(parentId), mime, name)
            }.getOrNull()
            if (created != null) {
                return Node(DocumentsContract.getDocumentId(created), name, false, 0L)
            }
            // 有的 provider 建成功却抛异常（属性回填失败），这里再查一次
            find(parentId, name)?.let { return it }
        }
        return find(parentId, name)
    }

    fun readText(node: Node): String? = runCatching {
        resolver.openInputStream(uriOf(node.docId))?.use {
            it.readBytes().toString(Charsets.UTF_8)
        }
    }.getOrNull()

    /** 整篇覆盖写。 */
    fun writeText(node: Node, text: String): Boolean {
        val bytes = text.toByteArray(Charsets.UTF_8)
        val uri = uriOf(node.docId)
        val written = runCatching {
            // "wt" = 写入并截断。不截断会留下上一次更长的尾巴。
            resolver.openOutputStream(uri, "wt")?.use { it.write(bytes); it.flush() }
        }
        if (written.isFailure || written.getOrNull() == null) {
            return runCatching {
                resolver.openOutputStream(uri, "w")?.use { it.write(bytes); it.flush() }
                true
            }.getOrDefault(false)
        }
        return true
    }

    /** 给设置页显示的人话目录名（部分 provider 能给出真实名，给不出就退回 URI）。 */
    fun describe(): String {
        val parts = children(rootId).take(3).map { it.name }
        val suffix = if (parts.isEmpty()) "（空目录）" else parts.joinToString("、")
        return "$suffix · …"
    }

    companion object {

        /** 上次选的目录还在不在（用户可能把目录删了 / 撤销了授权）。 */
        fun available(ctx: Context, treeUri: String): Boolean {
            if (treeUri.isEmpty()) return false
            val uri = runCatching { Uri.parse(treeUri) }.getOrNull() ?: return false
            return ctx.contentResolver.persistedUriPermissions.any {
                it.uri == uri && it.isWritePermission && it.isReadPermission
            }
        }

        /** 把一次性授权变成长期授权；失败说明 intent 没带 PERSISTABLE 标志。 */
        fun persist(ctx: Context, uri: Uri): Boolean = runCatching {
            ctx.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
            true
        }.getOrDefault(false)

        fun open(ctx: Context, treeUri: String): SafVault? {
            if (treeUri.isEmpty()) return null
            val uri = runCatching { Uri.parse(treeUri) }.getOrNull() ?: return null
            return runCatching { SafVault(ctx, uri) }.getOrNull()
        }
    }
}
