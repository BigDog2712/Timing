# Timing 安卓端 · 0.3.2

原生 Kotlin 写的悬浮计时器：**一个悬浮小条（小圆点 / 顶部胶囊）常驻桌面，App 里是四个页签**。
0.2.0 把数据落到 SQLite（表结构与桌面同构）；0.3.x 接上 **Obsidian 双向同步** —— 两端
读写同一个 vault 里的日记区块，按「事项 + 开始时刻」三方合并。

0.3.2 是**稳定性版本**：崩溃落盘 + 首屏可查、启动路径逐层兜底、数据库版本补齐、
前台服务进不了前台时主动退场。改动详见 [§7 闪退了怎么办](#7-闪退了怎么办)。

**当前状态**：`assembleDebug` 通过（约 1.04 MB APK），**60 条纯 JVM 单测全绿**
（状态机 7 / 时钟落库 5 / 天周计算 6 / 时间格式 4 / 区块解析 9 / Planner 格式 10 / 三方合并 10）；
**未做真机验证**（本机无设备也无模拟器），悬浮窗手势、通知栏按钮、SQLite 实际读写、
SAF 目录授权都需要装机确认。

数据落点与两端结构契约写在 **[`docs/sync/OBSIDIAN-SYNC.md`](../docs/sync/OBSIDIAN-SYNC.md)**。

---

## 1. 为什么是原生 Kotlin，而不是复用桌面那套 Tauri

桌面版（`src-tauri/`，v0.4.1）和旧版本出过的 Tauri 安卓包（`Timing-v0.4.1-android-arm64.apk`）都**没有悬浮层**能力，原因是技术性的，不是没做：

| 需求 | 需要的系统能力 | Tauri / WebView 能做吗 |
| --- | --- | --- |
| 小条浮在别的 App 上面 | `WindowManager` + `TYPE_APPLICATION_OVERLAY` 窗口 | ❌ Tauri 的 Android 壳只管理自己的 Activity，拿不到系统级窗口 |
| 退到后台计时不中断 | 前台服务（`startForeground`）+ 常驻通知 | ⚠️ 需要一个自定义 Tauri 插件把 Kotlin 服务桥给 JS，成本高于直接写原生 |
| 拖动小条 / 1 秒刷新 | 原生触摸事件 + 自绘 | ⚠️ WebView 跨进程刷新 1 秒级 UI，耗电和延迟都不划算 |

所以本目录是**独立原生工程**，`src-tauri/` 一行没动，两个 APK 可以并存。

## 2. 需求对照

| 桌面能力 | 安卓落点 | 状态 |
| --- | --- | --- |
| 悬浮药丸（32px、状态环 + 数字 + 事项名） | `PillView`：32dp 药丸 / 28dp 圆点 | ✅ |
| 按一下就开计时 | 点圆点 → 直接开正计时并展开成药丸 | ✅ |
| 暂停 / 继续 / 结束 | 点药丸、App 主按钮、通知栏按钮 | ✅ |
| 正计时 / 倒计时 + 剩余 ≤60s 变红闪烁 | `TimerCore` + `PillView` | ✅ |
| 到点恒结束并保存 | `TimerCore.current()` 内收口 | ✅ |
| 最低记录时长（默认 30s） | 设置页可改 5/30/60s | ✅ |
| 记录（日 / 周视图） | 页签③：今天（分布 + 明细）/ 本周（七天柱 + 事项占比） | ✅ 0.2.0 |
| 事项 / 待办 | 页签②：今日汇总 + 待办（长按删） | ✅ 落库 |
| 数据持久 | SQLite `timing.db`，表与桌面同构 | ✅ 0.2.0 |
| 深 / 浅主题 | 设置 → 主题，令牌抄桌面 `03-theme-light.css` | ✅ 0.2.0 |
| 窗口位置记忆 | 拖动落盘 + 旋转重算 + 一键复位 | ✅ 0.2.0 |
| md-sync（写 Obsidian 日记） | 设置 → 同步：SAF 选目录 + 模板 + 标题，双向合并 | ✅ 0.3.0 |
| 同步收敛加固 | 归一化比较 + 无变化不写 + 半截文件整轮跳过 | ✅ 0.3.1 |
| 便利贴（列表 + 全屏编辑 + 挂当前事项） | 页签③「便利贴」+ 二级编辑页；正文 ≤4000 字 | ✅ 本版 |
| 便利贴写进 Obsidian | 日记里的 `#### 便利贴` 表格，按桌面发下的行号认人 | ✅ 本版 |
| 插件、主题四色 | — | ⏳ 后续 |
| 托盘、开机自启 | 手机无对应语义 | 🚫 不做 |

## 3. 关于「小米超级岛 / 灵动岛」

### 3.1 接入需要什么条件

超级岛**不是**一个公开 SDK，是小米的准入制能力。走官方通道要按顺序过六关（依据 `dev.mi.com/xiaomihyperos` 的接入流程文档）：

1. **企业开发者认证**——注册小米账号 + 企业资质，人工审核 1–3 个工作日；
2. **创建应用并通过审核**——关键是：**应用得在架**（应用商店已上架），包体与资料都要过审；
3. **开通推送服务权益**——只有走 MiPush 云侧下发时才需要；纯客户端本地发岛可跳过；
4. **启用超级岛服务**——应用详情 → 开发 → 开放服务 → 小米超级岛 → 填写联系信息 + **配置签名证书指纹**；
5. **上岛场景预审 → 方案提报**——说明业务场景与核心信息，按《方案提报模板》提，运营/促销类场景会被驳回；
6. **设计审核 + 联调**——必须套《摘要态 / 展开态设计模板》（OS2/OS3 分版本、不向下兼容）；图片 ≤100KB、HTTPS、宽高比 1.78 ~ 1:1；联调要申请设备白名单，通过后提交**正式环境 APK** 换取正式权限，再灰度放量，通常 **7–15 天**到全量。

技术上有两条路：**客户端实现**（按原生通知方式发「岛通知」）或 **MiPush 扩展参数**（只支持 regId 发送，进程被杀也能收到）。

**对 Timing 的结论**：这条路要求「企业资质 + 已上架应用 + 设计稿过审 + 逐场景报备」，为一个个人计时工具走完全程不划算，而且审核周期比功能迭代还长。所以本期做**视觉等价**：

1. 悬浮窗口默认停在顶部正中、状态栏下 4dp —— 就是灵动岛的位置，胶囊形、深色底；
2. 同时发常驻通知（`IMPORTANCE_LOW`），带「暂停 / 结束」。

将来真拿到合作接口，只需替换 `OverlayService` 的呈现层，`TimerCore` 和页面一行不用动。

### 3.2 一个例外：部分机型会把「持续通知」升级成岛的样式

HyperOS 对**媒体播放、导航、通话、录音、计时器**这几类前台服务有系统级收纳，部分版本会把通知渲染成岛状。这不是第三方注册，而是系统按 `Notification.Category` + 前台服务类型自动判定。想被命中，实践上要做：

- 前台服务类型声明准确（本项目已用 `specialUse` + `floating_timer_overlay`）；
- 通知带 `setCategory(Notification.CATEGORY_STOPWATCH)` / `CATEGORY_ALARM`；
- 优先用 `Notification.CallStyle` 之外的标准模板（`setChronometer` 系列），让系统能识别为「计时」。

这条路径**没有文档保证**，机型/版本差异大，我按「能命中就命中，命中不了也不影响功能」的方式接：

```kotlin
// OverlayNoti.build() 里
.setCategory(if (s.active) Notification.CATEGORY_STOPWATCH else Notification.CATEGORY_REMINDER)
```

## 4. 数据落点与两端互通

### 4.1 两层：私有 SQLite + 共享 Markdown

Obsidian（无论官方 Sync 还是 Remotely Save）同步的是 **vault 目录里的文件**，不是 SQLite。
所以两端不能靠同步 `.db` 互通，只能让「共享的数据」以 Markdown 形态落进 vault：

````
共享层（Obsidian 同步）
  <vault>/<任意目录>/2026-11-03.md
    #### 事项计时        ← 桌面与手机都读、都写
    - [ ] 写作
      ```yaml
      planner:
        log:
          - start: 2026-11-03 09:00:00
            end:   2026-11-03 09:30:00
            duration: 30m
      ```

私有层（不同步，各自离线可用）
  桌面 %APPDATA%/com.timing.app/timing.db     手机 /data/data/com.timing.droid/databases/timing.db
````

共享层决定「这一天有什么」，私有层只负责界面快与离线可用。

**为什么不能干脆把电脑端的 `timing.db` 挪进 vault 让插件同步？** 四个独立的原因：

| 问题 | 后果 |
|---|---|
| 二进制不可合并 | 同步是整文件取舍，两端各记一条 → 只能二选一，另一边当天记录整体消失 |
| 三件套必须原子替换 | SQLite 运行时还有 `-wal` / `-shm`。插件一个文件一个文件传，必然出现「`.db` 换了、`-wal` 还是旧的」→ **数据库损坏** |
| 写时占用 | 手机查库的同时插件在替换文件，SQLite 会拿到损坏的页 |
| 失去救援能力 | SQLite 独立，才能在文件被覆盖后靠合并把记录救回来；把它交给同步通道等于把救生圈扔了 |

### 4.2 落点能不能放在程序外部

**两端都能，但手机必须用系统目录选择器。**

- **桌面端**：设置 → 同步 → 根目录，直接填绝对路径。校验只查长度 ≤512 与不能换行
  （`models/md_sync.rs::validate`），不限制必须在程序目录内，所以 vault、NAS 共享盘都能指；
  还支持 `%USERPROFILE%` 和开头的 `~`。文件模板必须是相对路径（不带盘符、不含 `..`）。
- **安卓端**：不能填路径。Android 11 起分区存储禁止按 `/storage/emulated/0/...` 写共享存储
  （直接写会 `EACCES`）。改用 SAF：设置 → 同步 → 「日记目录」→ 系统选择器里选中 vault 里的
  目录 → 允许。拿到 `content://.../tree/...` 后 `takePersistableUriPermission` 长期化，
  重启后仍有效。效果与填路径等价，只是目录由用户点选。

  `core/md/SafVault.kt` 用 `DocumentsContract` 直接读写，没有引 AndroidX 的 `DocumentFile`
  —— 维持「零运行时依赖」。所有派生 URI 都用 `buildDocumentUriUsingTree` 构造，
  手拼 URI 会丢掉 tree 授权、抛 `SecurityException`。

  注意：`Android/data`、`Android/obb` 下的目录对 SAF 关闭，选不进去；Obsidian vault 一般不在那里。

### 4.3 两端怎么配成一对

三项必须完全一致，否则各写一块、互不相认：

| 配置 | 桌面端 | 安卓端 |
| --- | --- | --- |
| 目录 | `...\MyVault\Diary` | 系统选择器选 `MyVault/Diary` |
| 文件模板 | `{date}.md` | `{date}.md` |
| 标题行 | `#### 事项计时` | `#### 事项计时` |

手机每 20 秒自动跑一轮（仅前台），桌面每 2 秒一轮；两边都能手动「立即同步」。

用 Remotely Save 的话，落地顺序是：手机装 Obsidian → 建 vault（**不要在 `Android/data`
或 `Android/obb` 下**，那两个目录对系统选择器关闭）→ 装 Remotely Save 配同一远端 → 先同步
一轮把 `Diary/` 拉下来 → 再装 Timing 选这个目录。Timing **不负责上传**，它只负责把
那篇 `.md` 改对；上传要等 Obsidian 活着时由 Remotely Save 干。

### 4.4 冲突：不做二选一，做三方合并

桌面端原本是单机逻辑（SQL 变→导出，文件变→导入）。双端下二选一必然丢数据——手机刚记的
会被桌面刚写的覆盖。所以 `core/md/MdMerge.kt` 改成三方合并，按 `(事项, 开始时刻)` 逐条判定：

| 情形 | 取值 |
| --- | --- |
| `local == remote` | 任意（含两边都删了） |
| `local == base` | `remote`（只有对面动过） |
| `remote == base` | `local`（只有本机动过） |
| 其余 | `remote`（真冲突，文件优先） |

以「事项 + 开始时刻」为键，意味着同一条被两端同时改几乎不可能（时段落盘后不可变）。
`ongoing: true` 的实时段不参与合并，只原样搬运——本机既不吞掉桌面正在计的段，
也不把它当成已完成记录。

**Remotely Save 会整体覆盖文件，所以还要防「互相写死」。** 三道闸门都在
`MdRoundTripTest` 里锁着：

| 闸门 | 做法 | 防的是什么 |
| --- | --- | --- |
| 归一化比较 | 比 `render(parse(body))` 而不是原文 | Linter 插件改缩进、给 `duration` 加引号，不算内容变化 |
| 无变化不写 | 归一化后相同就完全不碰文件 | mtime 不跳，插件不会认为需要上传 |
| 截断检测 | 围栏不成对 / 非法 UTF-8 / 整篇突然变空 | 读到写了一半的文件时整轮跳过，**绝不把「读到的缺失」当成「用户删除」** |

最后一条最要紧：SAF 的写入是就地截断，不是原子替换。半截文件里少掉的条目会被合并判成
「用户删了」，于是本机跟着删库——`MdTimers.looksTruncated()` 就是拦这个的。

### 4.5 为什么不选 git

git 能当搬运工，不能当同步协议：`.db` 是二进制、冲突只能二选一；每次 commit 存一份完整库；
安卓端没有 `git` 可执行文件（JGit 重且要管凭证）。唯一不冲突的姿势是「每设备只往自己文件
追加」，那时 git 已退化成对象存储，用 WebDAV / S3 更省事。

git 在本项目里**正确的位置**：代码 + `migrations/` + 手动导出备份。低频、人工触发、只读归档。

## 5. 目录

```
android-app/
├── settings.gradle.kts / build.gradle.kts / gradle.properties
└── app/
    ├── build.gradle.kts            # 零运行时依赖，compileSdk 36 / minSdk 26
    └── src/main/java/com/timing/droid/
        ├── TickApp.kt          # Application：只做一件事——装崩溃兜底
        ├── core/
        │   ├── Tk.kt           # 设计令牌（深/浅两套，读时求值）
        │   ├── TimeFmt.kt      # MM:SS / HH:MM:SS / 1h 23m
        │   ├── Days.kt         # 天/周边界（周一为首，纯函数可测）
        │   ├── Prefs.kt        # 开关、主题、小条位置、device_id
        │   ├── Crash.kt        # 未捕获异常落盘 + 下次启动回读
        │   ├── Db.kt           # SQLiteOpenHelper + 建表（与桌面同构）
        │   ├── Repo.kt         # 计时落库与聚合查询（今日 / 本周 / 按事项）
        │   ├── RepoTodo.kt     # 待办落库（从 Repo 拆出，守 300 行上限）
        │   ├── TodoStore.kt    # 待办门面（库的内存镜像）
        │   ├── RepoNote.kt     # 便利贴落库（多一列 sync_id：Markdown 里认人用）
        │   ├── NoteStore.kt    # 便利贴门面 + 当前事项判定
        │   ├── NoteText.kt     # 编辑器纯函数：圆点 / 续行 / 缩进（对齐桌面 noteText.ts）
        │   ├── md/             # Obsidian 双向同步
        │   │   ├── MdCfg.kt       # 落点配置：SAF URI / 模板 / 两个区块标题 / 基线
        │   │   ├── SafVault.kt    # SAF 目录读写（DocumentsContract，零依赖）
        │   │   ├── MdSection.kt   # 标题区块定位与替换（对齐桌面 md_file.rs）
        │   │   ├── MdTimers.kt    # Planner 格式 render / parse
        │   │   ├── MdMerge.kt     # 计时段三方合并（纯函数，10 条单测）
        │   │   ├── MdNotes.kt     # 便利贴表格 render / parse（对齐桌面 format/notes.rs）
        │   │   ├── MdNotesSync.kt # 便利贴那一轮：认人 + 三方合并（9 条单测）
        │   │   └── MdSync.kt      # 编排：读三方 → 合并 → 双向落地
        │   └── TimerCore.kt    # 状态机（唯一业务内核，Store 接口可替换）
        ├── overlay/
        │   ├── OverlayService.kt  # 前台服务：生命周期 + 通知 + 500ms 心跳
        │   ├── PillGeometry.kt    # 窗口参数 / 收边 / 复位
        │   ├── PillDrag.kt        # 拖动 / 点按 / 长按
        │   ├── PillView.kt        # 自绘小条 / 小圆点
        │   ├── OverlayNoti.kt     # 常驻通知（内容不变不重推）
        │   ├── RotationWatcher.kt # 旋转 / 分屏广播（收边用）
        │   └── OverlayCtl.kt      # 权限查询与跳转
        └── ui/
            ├── MainActivity.kt    # 外壳 + 五页签 + 边到边（启动全程兜底）
            ├── Router.kt          # 二级页（便利贴编辑）与返回键分层
            ├── Insets.kt          # 系统栏 + 键盘留白（边到边）
            ├── Notice.kt          # 首屏提示条：崩溃 / 库异常 / 去授权
            ├── FallbackPage.kt    # 单页构造失败时的占位
            ├── Page.kt / Ui.kt    # 页面接口、手写 UI 工具
            ├── TimerPage.kt       # ① 计时
            ├── TodoPage.kt        # ② 事项
            ├── NotesPage.kt       # ③ 便利贴清单
            ├── NoteEditPage.kt    # ③ 便利贴全屏编辑（二级页）
            ├── NoteTools.kt       # 编辑页工具条：圆点 / 缩进 / 关联事项
            ├── RecordsPage.kt     # ④ 记录（今天 / 本周）
            ├── WeekBars.kt        # 七天柱状图（自绘）
            ├── SettingsPage.kt    # ⑤ 设置
            ├── SyncSection.kt     # 设置页的「同步（Obsidian）」一节
            ├── RingView.kt        # 大计时环
            └── Sheets.kt          # 定长倒计时 / 换事项 / 文本输入 / 二次确认
```

单文件均 ≤300 行（仓库硬性规则）。`OverlayService` 原本 380 行，已按「窗口几何」「手势」「旋转监听」
「通知推送」拆到 `PillGeometry` / `PillDrag` / `RotationWatcher` / `OverlayNoti`。

## 6. 怎么跑起来

构建组合（与已验证的 Tauri 安卓工程对齐过版本，两套工程共用同一份 Gradle 缓存）：
Gradle **9.6.1** · AGP **9.3.1** · Kotlin **2.2.10** · `compileSdk 36` / `targetSdk 35` / `minSdk 26`。
运行前提只有 JDK 17 + Android SDK（platforms;android-36、build-tools 36）。

```bash
cd android-app

export JAVA_HOME=/c/Software/android-tools/jdk-17      # 本机 JDK 位置
export PATH="$JAVA_HOME/bin:$PATH"

./gradlew :app:assembleDebug          # 出包
./gradlew :app:testDebugUnitTest      # 60 条单测
./gradlew :app:installDebug           # 连上手机后直接装
```

打好的一份在 `release/Timing-android-0.3.1.apk`（debug 签名，仅自测安装）。

**Android Studio**：`File → Open` 选本目录即可，`gradlew` 与 wrapper jar 已在仓库里。

**第一次启动必做的授权**

1. App 顶部提示条 → 点「去授权」→ 打开「显示在其他应用上层 / 悬浮窗」；
2. 系统弹通知权限时允许（拒绝也能用，只是通知栏没有暂停/结束）；
3. 想两端同步：设置 → 同步 → 点「日记目录」，在系统选择器里选中 Obsidian vault 里的
   存放目录（与桌面端「设置 → 同步」填的目录是同一个）。

## 7. 闪退了怎么办

0.3.2 起内置崩溃兜底：**未捕获异常写进 App 私有目录，下次启动时首屏顶部出一条红条**，
点「查看」看完整堆栈，点「复制」直接发出来。同时启动路径已拆成「哪一页坏只坏哪一页」，
正常情况下不该再出现「打开即闪退」。

排查顺序：

| 现象 | 说明 | 动作 |
| --- | --- | --- |
| 装完点开就退，第二次打开正常 | 上次崩在启动路径上，已被兜住 | 首屏红条 →「查看」→ 复制堆栈 |
| 每次打开都退，连红条都看不到 | 崩在 `Application` 之前（主题 / 资源 / 签名） | 只能看 logcat，见下 |
| 能进 App，某一页显示「加载失败」 | 那一页构造抛了异常，其余页可用 | 把占位页上那行异常发出来 |
| 用一会儿退 | 多半是前台服务被系统杀 / ROM 拦截 | 设置里关掉「常驻悬浮窗」再看还退不退 |

**抓 logcat（最准）**：手机开「USB 调试」连电脑，装好 platform-tools 后：

```bash
adb logcat -c                                   # 清空
# 然后在手机上打开 Timing，等它闪退，立刻执行：
adb logcat -d -b crash AndroidRuntime:E "*:S"
```

`FATAL EXCEPTION` 往下的十几行就是原因，整段发出来即可。

**覆盖安装 vs 卸载重装**：先直接覆盖安装（保留数据）。只有在「每次打开都退」时才建议卸载重装
——那会清掉私有目录里的 `timing.db`（Obsidian vault 里的 Markdown 不受影响）。

0.3.2 具体堵掉了这几条：

| 修复 | 原来的后果 |
| --- | --- |
| `Db.VERSION` 1 → 2，`onUpgrade` 给两张表补 `uid`/`device_id`/`rev` | 装过 0.2.0 的机器升级后，一保存就抛 `no column named uid` |
| 数据库打不开时备份并重建；仍失败则降级纯内存 | 损坏的 `.db` 会让 App 永远起不来 |
| `startForeground` 失败（含 `specialUse` 被 ROM 拦）时 `stopSelf` | 系统 5 秒后杀掉整个进程 = 用着用着闪退 |
| 四个页签各自 `runCatching` | 任一页构造抛异常 = 打开即闪退 |
| `startForegroundService` / 系统栏设置 / insets 全部包住 | 单点异常拖死整个启动流程 |

## 8. 已知边界

- **同步只覆盖「当天」**：基线按天存，打开 App 时同步今天的日记；手机上改历史日期不会回写；
- **待办还没进共享层**：`todos` 表缺 `planned_at` / `done_at`，与桌面待办区块对不齐，
  所以只同步计时与便利贴。手机改了待办不会被同步；
- **便利贴的号由桌面端发**：手机第一次写出一条便利贴时表里那行**不带号**，桌面端读到会
  插入一条自己的并回写 `<!-- tb-note:N -->`，手机下一轮才认领这个号。也就是说
  **首轮往返之前，两端看到的是「各有一张」**；只影响第一条，之后都锁在同一张上。
  手机不能自己发号——桌面端遇到不认识的号会当成新行插入，两端会越同步越多；
- **冲突副本的处理因插件而异**：Obsidian Sync 会生成 `xxx (Conflicted copy).md`；
  **Remotely Save 通常不生成、直接按修改时间择一覆盖**。两种情况本应用都管不到副本本身，
  需要人工删掉较旧的一份；被覆盖掉的记录靠本机 SQLite 在下一轮合并中写回；
- **手机端 Obsidian 必须真的在跑**：Remotely Save 的定时同步挂在 Obsidian 进程上。
  Timing 只负责把 `.md` 改对，上传那一步要一个活着的 Obsidian；
- **别在没同步前「清除数据 / 重装」**：SQLite 既是本地副本也是被覆盖时的救援来源。
- **两端同时写有秒级窗口**：手机 20 秒一轮、桌面 2 秒一轮，理论上存在「桌面读到旧文件后
  又基于旧基线写回」的竞态。窗口很窄，桌面写入前会先读一次并留备份；
- **记录只有「已结束」的会话**：正在进行中的那一条不落库，进程被杀会丢这一轮；
- **软删除未清理**：`deleted_at` 行会一直留着（正好当墓碑用），等以后再做垃圾回收；
- **国产 ROM 后台限制**：需要手动给本应用加「自启动 / 省电白名单」，否则前台服务仍可能被清；
- **未做真机验证**：本机只有构建环境、没有设备。悬浮手势、通知栏按钮、SQLite 真实读写、
  SAF 目录授权与写入都要装机确认。

## 9. 下一步（建议顺序）

1. 真机跑一遍：悬浮手势 → 通知栏按钮 → 选 Obsidian 目录 → 两端来回记几段验证合并；
2. **便利贴真机验证**（这一版新加）：新建 → 写正文 → 返回列表 → 桌面上打开同一个日记文件
   看 `#### 便利贴` 表格；再在桌面改一行，回手机看是否被收下；两端各删一张，看是否都消失；
3. 待办也进共享层：给 `todos` 补 `planned_at` / `done_at`，实现 `#### 待办事项` 区块；
4. 历史日期补同步（按天回放基线）；
5. 进行中的会话也落库，杀进程可恢复。
