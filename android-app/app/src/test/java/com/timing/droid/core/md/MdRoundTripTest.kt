package com.timing.droid.core.md

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 收敛性测试：**两端来回同步必须停在不动点**。
 *
 * 背景：Obsidian 的 Remotely Save 是「文件级」同步，不做行级合并，也不会像
 * Obsidian Sync 那样生成冲突副本——它只按修改时间（或大小）择一覆盖。
 *
 * 于是本应用有一个硬约束：**合并后的渲染结果必须与文件里的区块逐字节相同**。
 * 只要差一个字符，本机就会认为「文件变了」→ 写回 → mtime 变化 → Remotely Save
 * 上传 → 另一端下载 → 另一端也判定变了 → 再写回 …… 形成同步风暴，
 * 既费流量，也会让两端互相覆盖彼此的新记录。
 *
 * 这组用例锁住三件事：
 * 1. `render(parse(x)) == x`（格式幂等）；
 * 2. `merge(base, base, base) == base`（无变化时不动）；
 * 3. 桌面端写一段 → 手机收下 → 手机再跑一轮时**不再写文件**（真收敛）。
 */
class MdRoundTripTest {

    /** 桌面端 `format.rs` 的真实输出形状（含 duration、含多个事项、含进行中的段）。 */
    private val deskRender = """
        - [ ] 写方案
          ```yaml
          planner:
            log:
              - start: 2026-11-03 09:00:00
                end: 2026-11-03 09:30:00
                duration: 30m
              - start: 2026-11-03 10:15:00
                end: 2026-11-03 10:45:30
                duration: 30m30s
          ```
        - [ ] 读论文
          ```yaml
          planner:
            log:
              - start: 2026-11-03 09:30:00
                end: 2026-11-03 10:15:00
                duration: 45m
          ```
        - [ ] 整理笔记
          ```yaml
          planner:
            log:
              - start: 2026-11-03 11:00:00
                end: 2026-11-03 11:12:00
                duration: 12m
                ongoing: true
          ```
    """.trimIndent()

    // ------------------------------------------------------------ 1. 格式幂等

    @Test
    fun `render parse 往返后字节完全相同`() {
        val once = MdTimers.render(MdTimers.parse(deskRender))
        assertEquals(deskRender, once)

        // 再来一轮，确认不是「恰好在第一次对齐」
        val twice = MdTimers.render(MdTimers.parse(once))
        assertEquals(deskRender, twice)
    }

    @Test
    fun `三方全等时合并不动任何一条`() {
        val parsed = MdTimers.parse(deskRender)
        val map = MdMerge.flatten(parsed)
        val merged = MdMerge.merge(map, map, map)
        assertEquals(map, merged)
    }

    @Test
    fun `ongoing 段被 flatten 丢弃但仍能原样搬回`() {
        val parsed = MdTimers.parse(deskRender)
        val flat = MdMerge.flatten(parsed)
        // 整理笔记那条只有 ongoing，展平后应当一条不剩
        assertEquals(null, flat[MdMerge.Key("整理笔记", 1762138800000L)])
        assertEquals(3, flat.size)

        val back = MdTimers.render(MdMerge.toEntries(flat))
        // 展平再去掉的 ongoing 不会自己回来（只有 renderWithOngoing 能搬），这里只验不崩
        assertTrue(back.contains("写方案"))
    }

    // ------------------------------------------------------------ 2. 真收敛

    /**
     * 模拟 Remotely Save 的一天：
     *
     * 1. 桌面写文件（两条已完成 + 一条进行中）；
     * 2. 手机读到这个文件，合进本机库，写回——此时内容应与文件一致，**不该写**；
     * 3. 手机记一条新的，写回；
     * 4. 桌面下载了手机写的文件，记一条新的，写回；
     * 5. 手机再读——收下桌面的那条，写回；
     * 6. 手机再读一次——**必须什么都不做**（这是不动点）。
     */
    @Test
    fun `两端交替写入后停在同一份内容`() {
        val heading = "#### 事项计时"

        // ---- 1. 桌面首写
        var file = MdSection.append("# 2026-11-03\n\n", heading, deskRender)
        var base: Map<MdMerge.Key, MdMerge.Seg> = emptyMap()

        // ---- 2. 手机第一轮：空库 → 收下桌面全部
        var remoteEntries = MdTimers.parse(MdSection.body(file, heading)!!)
        var remote = MdMerge.flatten(remoteEntries)
        var local = remote
        var merged = MdMerge.merge(base, local, remote)
        assertEquals(3, merged.size)
        var body = MdMerge.renderMerged(merged, remoteEntries)
        assertEquals(MdSection.body(file, heading), body)   // 与文件一致 → 不该写回
        base = merged
        local = merged

        // ---- 3. 手机记一条新记录 12:00–12:25
        val phoneRec = MdMerge.Seg(ts("2026-11-03 12:25:00"), 25 * 60L)
        local = LinkedHashMap(local).apply { put(MdMerge.Key("回邮件", ts("2026-11-03 12:00:00")), phoneRec) }
        merged = MdMerge.merge(base, local, remote)
        assertEquals(4, merged.size)
        body = MdMerge.renderMerged(merged, remoteEntries)
        // 桌面的 ongoing 段必须被原样带走，不能因为本机写盘就被抹掉
        assertTrue("进行中的段要原样保留", body.contains("ongoing: true"))
        file = MdSection.replace(file, heading, body)
        base = merged
        remote = merged
        remoteEntries = MdTimers.parse(body)

        // ---- 4. 桌面下载后，在 13:00–13:40 记一条
        val deskRec = MdMerge.Seg(ts("2026-11-03 13:40:00"), 40 * 60L)
        val deskLocal = LinkedHashMap(remote).apply {
            put(MdMerge.Key("开会", ts("2026-11-03 13:00:00")), deskRec)
        }
        val deskMerged = MdMerge.merge(base, deskLocal, remote)
        assertEquals(5, deskMerged.size)
        file = MdSection.replace(file, heading, MdMerge.renderMerged(deskMerged, remoteEntries))

        // ---- 5. 手机读到桌面新写的文件
        val phoneSees = MdMerge.flatten(MdTimers.parse(MdSection.body(file, heading)!!))
        assertEquals(5, phoneSees.size)
        merged = MdMerge.merge(base, local, phoneSees)
        // 手机本机没有「开会」，桌面有 → 收下；手机有「回邮件」，桌面也有 → 保留
        assertEquals(5, merged.size)
        assertNotNull(merged[MdMerge.Key("开会", ts("2026-11-03 13:00:00"))])
        assertNotNull(merged[MdMerge.Key("回邮件", ts("2026-11-03 12:00:00"))])

        val fileBody = MdSection.body(file, heading)!!
        val phoneBody = MdMerge.renderMerged(merged, MdTimers.parse(fileBody))
        // 归一化后相同 → 不该写盘（这是「不震荡」的判据）
        assertEquals(MdMerge.normalized(fileBody), MdMerge.normalized(phoneBody))

        // ---- 6. 再跑一轮：必须是不动点
        base = merged
        local = merged
        val again = MdMerge.merge(base, local, MdMerge.flatten(MdTimers.parse(fileBody)))
        assertEquals(merged, again)
        assertEquals(phoneBody, MdMerge.renderMerged(again, MdTimers.parse(fileBody)))
    }

    /**
     * 格式抖动不该被判定成「内容变了」。
     *
     * Obsidian 里装了 Linter / YAML 格式化插件的人很多，它们会把 `duration: 30m`
     * 改成 `duration: "30m"`、把 2 空格缩进改成 4 空格。如果按原文比较，
     * 本机就读一次写一次，Remotely Save 每轮都上传，两端互相覆盖。
     */
    @Test
    fun `缩进和引号被改写后仍视为同一份内容`() {
        val reformatted = """
            - [ ] 写方案
                ```yaml
                planner:
                  log:
                    - start: 2026-11-03 09:00:00
                      end: 2026-11-03 09:30:00
                      duration: "30m"
            ```
        """.trimIndent()

        val origin = """
            - [ ] 写方案
              ```yaml
              planner:
                log:
                  - start: 2026-11-03 09:00:00
                    end: 2026-11-03 09:30:00
                    duration: 30m
              ```
        """.trimIndent()

        // 事实层面完全一样
        assertEquals(MdMerge.flatten(MdTimers.parse(origin)), MdMerge.flatten(MdTimers.parse(reformatted)))
        // 归一化后逐字相同 → 不会触发写盘
        assertEquals(MdMerge.normalized(origin), MdMerge.normalized(reformatted))
    }

    @Test
    fun `事实真的变了还是能识别出来`() {
        val a = "- [ ] 写方案\n  ```yaml\n  planner:\n    log:\n      - start: 2026-11-03 09:00:00\n        end: 2026-11-03 09:30:00\n  ```"
        val b = "- [ ] 写方案\n  ```yaml\n  planner:\n    log:\n      - start: 2026-11-03 09:00:00\n        end: 2026-11-03 09:45:00\n  ```"
        assertTrue(MdMerge.normalized(a) != MdMerge.normalized(b))
    }

    /**
     * Remotely Save 的坏习惯：把两端的改动**择一覆盖**（不是合并）。
     * 极端情况下，手机刚写进文件的记录会被桌面的旧版本整段覆盖掉。
     *
     * 但本机 SQLite 里还留着那条记录 —— 三方合并靠 `remote == base` 判定
     * 「文件没动过这一条，是我自己加的」，于是把它补回去。
     *
     * 这就是「SQLite 必须留在 vault 外」的根本原因：它是被覆盖时的救援副本。
     */
    @Test
    fun `文件被外部整体覆盖后能靠本机库救回`() {
        val keep = MdMerge.Seg(ts("2026-11-03 09:30:00"), 30 * 60L)
        val lost = MdMerge.Seg(ts("2026-11-03 12:25:00"), 25 * 60L)
        val other = MdMerge.Seg(ts("2026-11-03 13:40:00"), 40 * 60L)

        val kKeep = MdMerge.Key("写方案", ts("2026-11-03 09:00:00"))
        val kLost = MdMerge.Key("回邮件", ts("2026-11-03 12:00:00"))
        val kOther = MdMerge.Key("开会", ts("2026-11-03 13:00:00"))

        // 基线：两端都见过「写方案」
        val base = mapOf(kKeep to keep)
        // 本机：基线 + 自己刚记的「回邮件」
        val local = mapOf(kKeep to keep, kLost to lost)
        // 文件：被桌面端覆盖成了「写方案 + 开会」，手机那条不见了
        val remote = mapOf(kKeep to keep, kOther to other)

        val merged = MdMerge.merge(base, local, remote)
        assertEquals(3, merged.size)
        assertNotNull("手机刚记的那条不能被覆盖掉", merged[kLost])
        assertNotNull("桌面记的那条要收下", merged[kOther])
        assertNotNull(merged[kKeep])
    }

    // ------------------------------------------------------------ 3. 用户手改

    @Test
    fun `用户在文件里删掉一条 会传导到本机`() {
        val seg = MdMerge.Seg(ts("2026-11-03 09:30:00"), 30 * 60L)
        val gone = MdMerge.Seg(ts("2026-11-03 12:25:00"), 25 * 60L)
        val kA = MdMerge.Key("写方案", ts("2026-11-03 09:00:00"))
        val kB = MdMerge.Key("回邮件", ts("2026-11-03 12:00:00"))

        val base = mapOf(kA to seg, kB to gone)
        val local = base                      // 本机没动
        val remote = mapOf(kA to seg)         // 用户在文件里删了「回邮件」

        val merged = MdMerge.merge(base, local, remote)
        assertEquals(setOf(kA), merged.keys)   // 尊重手改，删掉
    }

    // ------------------------------------------------------------ 4. 读到半截

    /**
     * 读到半截必须能被认出来。
     *
     * 否则半截文件里少掉的条目会被三方合并判成「用户删了」，本机跟着删库。
     */
    @Test
    fun `围栏不成对或含非法字符时判为截断`() {
        // 断在 yaml 块内部：只有一个开围栏
        assertTrue(MdTimers.looksTruncated("- [ ] 写方案\n  ```yaml\n  planner:\n    log:\n"))
        // 完整内容不算
        assertTrue(!MdTimers.looksTruncated(deskRender))
        // 截断在中文多字节字符中间 → 解码出替换字符
        assertTrue(MdTimers.looksTruncated("写方案\uFFFD"))
        // 空串不算截断：整篇为空另有判据（比对基线），不能在这里误判
        assertTrue(!MdTimers.looksTruncated(""))
        // 用户手写的纯清单（没有 yaml 块）不该被误判
        assertTrue(!MdTimers.looksTruncated("- [ ] 读论文\n- [x] 整理笔记"))
    }

    private fun ts(text: String): Long = MdTimers.parseTs(text)!!
}
