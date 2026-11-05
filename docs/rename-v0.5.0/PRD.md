# Timing v0.5.0 变更规格（PRD）· 品牌改名 + 数据迁移 + 优化

- 文档类型：变更规格（PRD）
- 版本：0.4.1 → **0.5.0**（破坏性：产品标识符变更 + 数据目录搬迁）
- 撰写：许清楚（产品经理）｜日期：2026-11-04
- 工程根：`D:\101-Workshop\261102-Timing`
- 上游约束来源：`AGENTS.md`、`README.md`、`docs/phase2/IPC-CONTRACT-v2.md`、`docs/plugin-spec.md`
- 本文用途：作为架构师设计迁移方案、工程师分批落地、QA 转测试用例的**唯一需求依据**
- 配套文档：`docs/rename-v0.5.0/ARCHITECTURE.md`（架构与任务分解 T01–T05）、`docs/decisions/ADR-036.md`（品牌回归）、`ADR-037.md`（契约口径修正）

## 修订记录

| 版本 | 日期 | 修订内容 | 依据 |
| --- | --- | --- | --- |
| v1 | 2026-11-04 | 初稿：变更目标与范围、命名规范、L1/L2/L3 三层清单、数据迁移规格、安卓代价、优化需求池、GitHub 交付、风险与回滚、待确认 | 现场核查（`git grep` / 实机目录 / 门禁脚本实测） |
| **v3** | 2026-11-04 | ① **回滚大小写裁决**：两个安卓工程的主题名大小写**本就相反**（`gen/android` = `Theme.tickbar` 小写、`android-app/` = `Theme.TickBar` 大写），不是笔误，各自以各自文件为准；品牌残留校验一律改 `git grep -in`（大小写不敏感） ② **决策变更**：`android-app/` 作为归档件**代码零改动**（包名 / `app_name` / 主题名 / 45 个 .kt 包路径全部保留 TickBar 旧名），原 L1-14..L1-17、L2-26/27 由「改」改为「不改」，新增 §5.7 记录三条理由与三项配套 ③ 修订 v2 的行数贴顶表 / P1-1 纪律不变 | 架构师逐文件核实 + 主理人拍板 |
| **v2** | 2026-11-04 | ① **契约口径修正**：命令 65 → 67（新增 `get_migration_info` / `open_legacy_dir`），事件 11 / 错误码 16 / schema v4 不变；补 §1.5 说明为何「零成本复用现有命令」与「塞进 settings」都被否决 ② **补覆盖式迁移规格**（原 v1 的逻辑漏洞：空白启动会把迁移永久锁死）③ **安卓产物边界**：本轮 Release 不含安卓产物；`android-app/` 归档冻结 9/0.3.6 ④ **待确认收敛**：6 项已拍板落地 | `ARCHITECTURE.md` §1.2 / §1.3 / §7 N1 / §8 Q1–Q7；主理人拍板 |

---

## 1. 变更目标与范围

### 1.1 一句话

**把产品身份从 `TickBar` 换成 `Timing`（显示名 / npm 包名 / identifier / crate / 安卓主线包名五处一致；归档工程 `android-app/` 除外），并保证 0.4.1 及更早版本用户的全部本地数据在 0.5.0 首次启动后原样可见；业务语义零变更。**

### 1.2 为什么是「换成」而不是「起个新名」

这不是起新名，是**回到原名**。本工程是 C#/GDI 老产品 `Timing v1.7.x` 的 Rust 重写：

- `docs/timing-1.7.3-parity.md`：功能对等验收矩阵，参考源 `D:\101-Workshop\261015-Timing\Timingv1.7.3\src\ElioTimer.Ui\`
- `docs/design/TIMING-DELTA-AUDIT.md`：`TickBar V0.2.0 vs Timing v1.7.0` 逐项视觉偏差审计
- GitHub 仓库名早已是 `Timing_Rust`（`https://github.com/BigDog2712/Timing_Rust`）

**`TickBar` 是重写期的工程代号。** 产品叙事因此不是"改名"，而是"代号回归产品名"，这对老 Timing 用户是可解释的。

### 1.3 变更范围（做 / 不做）

| 维度 | 0.5.0 做 | 0.5.0 不做 |
| --- | --- | --- |
| 产品身份 | 显示名、npm 包名、identifier、crate 名、**安卓主线包名（`com.timing.app`）**、安装产物名 | 图标记号（`docs/design/BRAND-ICON.md` 的计时环）不改；**归档工程 `android-app/` 的包名 / 应用名 / 主题名一个字符不改**（§5.7） |
| 数据 | 桌面：老数据目录整体迁移（含**覆盖式迁移**兜底，见 §4.1）；失败不丢数据、可回滚 | 安卓：不自动迁移（见 §5），只提供手工路径 |
| 契约 | **命令 65 → 67**（新增 `get_migration_info`、`open_legacy_dir` 两条命令，供 §6 P0-7 的迁移可见性）；**事件 11 / 错误码 16 / DB schema v4 不变**（为何不做到零变化见 §1.5） | 不新增错误码（两条新命令失败一律复用 `IO_ERROR`）、不改既有 65 条命令语义、不改窗口 label、不改 SQL 表列名 |
| 代码 | 标识符、注释、现行文档 | 不重构业务逻辑（除 §6 需求池单列的项） |
| 发布 | 首个 git tag `v0.5.0` + 首个 GitHub Release + About 描述 | 不重写历史 commit、不篡改 CHANGELOG 既有条目 |

### 1.4 硬约束遵守声明（不得提议违反）

| 约束 | 本规格的处理 |
| --- | --- |
| 单文件 ≤300 行（`check:size`） | §6 P1-1：**5 个文件正好 300 行**（零余量），改名后如需加代码必须先拆 |
| 六层只能向下（`check:layers`） | 迁移模块放 `infra/appdata_migrate/`（依赖白名单：std + sqlx + dirs + serde + chrono，**不得** `use crate::services` / `use tauri::`），调用点在 `lib.rs`（根装配层） |
| IPC 契约 4 处一致（`check:contract`） | 命令 **+2**（`get_migration_info` / `open_legacy_dir`），事件 / 错误码 0 变化；4 处落点必须同批改，`check:contract` 以计数 67 为唯一验收 |
| 错误码只在 `error.rs` 定义 | **不新增错误码**：两条新命令与迁移失败一律复用 `IO_ERROR`；迁移失败的主提示走原生对话框 + 日志，不走 IPC 错误面 |
| CSS 只用 `var(--*)` | 本次不动样式值，只统一 localStorage 键名 |
| 零 emoji | 全文遵守 |
| 文档中文 | 全文中文 |

### 1.5 契约口径修正：为什么不是「零变化」

v1 写的是「命令 65 / 事件 11 / 错误码 16 零变化」。这条在需求上是好的，但**技术上无法零成本实现**——因为「迁移可见性」（设置页显示数据来源 + 打开旧数据目录）必须有数据来源。三条路径逐条被证伪：

| 备选 | 核查结论 | 处置 |
| --- | --- | --- |
| 复用现有命令 | 逐条查过 65 条：`plugin_open_dir` 绑死 `<app_data>/plugins` 子目录；`md_sync_*` 绑死用户配置的外部落点；诊断快照 `diagnostics.txt` **只有写没有读**，且它根本不是 IPC 命令。**没有任何一条能读 app_data_dir 下的任意文件、或打开任意目录**。把 `plugin_open_dir` 改成接受任意路径，等于给前端开一条「打开任意目录」的通路，与 `ADR-015` 的最小权限面冲突 | **否决**（语义污染 + 越权面扩大） |
| 塞进 `settings` kv 表，走既有 `get_settings` | `settings` 表确实是 kv，**但前端读设置不是读 kv**：`commands/settings_cmd.rs:54-58` 的 `get_settings() -> AppResult<Settings>` 返回**强类型 `Settings`**，由 `services::settings::get()` 把 kv 行映射成字段。加迁移字段要同时扩 `Settings` 类型 + `services::settings::get()` 映射 + 前端 `types/domain` 的 `Settings` 接口 + `settingsStore` 消费方 —— **仍是一次完整契约变更**，且是最坏的一类：`check:contract` 只比对命令名 / 错误码 / 事件，**对响应体字段零校验**，变更发生了门禁全程绿。再叠上「打开旧目录」仍需 1 条新命令，最终是「1 条新命令 + 1 次隐式响应体变更」 | **否决** |
| **新增 2 条显式命令** | 4 处落点可枚举（`lib.rs::generate_handler!`、`IpcApi`、`ipc.ts`、`browserMock*.ts`），缺一处 `check:contract` 直接判红；「打开目录」不需要新能力（`infra/plugin_fs.rs:191 open_dir` 已有 `explorer <dir>` 实现，抽成公共函数复用） | **采纳** |

**准确表述（评审、release notes、契约文档必须用这一句）**：走 `settings` 省掉的只是「命令条数」这个数字，**省不掉契约变更本身**；新方案把变更**显式化**，代价是多 2 个命令名、2 份 mock 与 1 节契约文档 —— 可枚举、可被门禁机械校验。

**新增命令（口径固定，不得再改）**

| 命令 | 语义 | 入参 | 返回 | 失败 |
| --- | --- | --- | --- | --- |
| `get_migration_info` | 纯查询，幂等、无副作用 | 无 | `MigrationInfo`（`source` ∈ `legacy`/`fresh`/`pending`/`unattached`/`skipped`，含 `legacyDir`/`legacyExists`/`rowCounts`） | `IO_ERROR` |
| `open_legacy_dir` | 资源管理器打开旧数据目录，**不存在则 `IO_ERROR`，绝不创建** | 无 | `()` | `IO_ERROR` |

**连带必改（否则文档自相矛盾）**：`docs/phase2/IPC-CONTRACT-v2.md` 命令数 65 → 67 + 新增「迁移可见性」一节；新增 `ADR-037`（记录上表两条否决依据）；`check:contract` 输出应为 `67/67/67 · 16/16 · 11/11`。

> 自启接管**不新增命令**：复用既有 `set_autostart` / `get_autostart`，清理与重挂由后端在 `setup` 内直接调用，不经 IPC。

---

## 2. 命名规范表（唯一口径）

### 2.1 五处正式值

| 面 | 现值 | 0.5.0 值 | 出处（文件） |
| --- | --- | --- | --- |
| 显示名（用户可见） | `TickBar` | **`Timing`** | `tauri.conf.json::productName`、窗口 title、托盘 tooltip |
| npm 包名 | `tickbar` | **`timing`** | `package.json::name`、`package-lock.json` ×2 |
| identifier | `com.tickbar.app` | **`com.timing.app`** | `tauri.conf.json::identifier` |
| Rust crate | `tickbar` / `tickbar_lib` | **`timing` / `timing_lib`** | `Cargo.toml`、`main.rs` |
| 安卓包名（独立工程，**归档不改**） | `com.tickbar.droid` | **保持 `com.tickbar.droid` 不变**（归档件零改动，见 §5.7） | `android-app/app/build.gradle.kts` |
| 安卓包名（Tauri 移动端） | `com.tickbar.app` | **`com.timing.app`**（与 identifier 同源） | `src-tauri/gen/android/app/build.gradle.kts` |
| 版本 | 0.4.1 | **0.5.0**（桌面 6 处同值）；`android-app/` **冻结 `9 / 0.3.6`**（归档件不进版本同步，见 §5.7） | 6 处 `check:version` + 归档冻结断言（§6 P0-3）；`gen/android` 由 `tauri.properties` 提供，不手改 |

### 2.2 书写规范（评审必查）

| 规则 | 正确 | 错误 |
| --- | --- | --- |
| 品牌名大小写 | `Timing` | `timing`（句首除外）、`TIMING`、`Tming`、`TimingBar` |
| 代码标识符 | 全小写 `timing`、`timing_lib` | `Timing`、`timingLib` |
| 反向域名 | `com.timing.app`（现行唯一值）。`com.timing.droid` **仅**是归档件重新启用时的目标值，现存代码里不应出现（见 §5.7） | `com.Timing.app`、`app.timing.com` |
| 环境变量 | 全大写 `TIMING_LOG`、`TIMING_BUILD_TIME` | `Timing_LOG` |
| localStorage 键 | `timing.<域>.v1`、分隔符统一 `.` | `timing:fit-offset`（冒号，历史遗留，本次统一） |
| 中文文案 | 「Timing 计时条」「Timing 设置」 | 「Timing计时条」（缺空格）、「滴答条」 |
| 与旧名并提 | 首次出现写 `Timing（原 TickBar）` | 通篇 `TickBar` |
| 文件/产物名 | `Timing.exe`、`Timing-v0.5.0-windows-x64-setup.exe`、`Timing-android-0.5.0.apk` | `timing.exe`、`Timing_v0.5.0.exe` |

### 2.3 明确保留 `TickBar` 的清单（附理由）

| 保留项 | 位置 | 理由 |
| --- | --- | --- |
| `docs/archive/v1/**` | 历史规格、旧 schema、旧设计稿 | 历史留档。篡改会让 ADR/复盘失真，且这些文档描述的是**当时的**产品 |
| `docs/reviews/**`、`docs/phase4/**`、`docs/PHASE-*.md` | 带日期的评估/QA 报告 | 历史快照，日期即版本证据 |
| `docs/decisions/ADR-001..035.md` 正文 | 决策记录 | 记录的是当时的决策语境。**不改正文**，另新增 `ADR-036` 记录改名决策 |
| `CHANGELOG.md` 既有条目、`更新日志.md` 既有段落 | 发布记录 | 只允许**追加** 0.5.0 条目，不允许回改历史 |
| `src-tauri/src/migrations/0001~0004.sql` 里的 `-- TickBar` 注释 | 4 个 SQL 文件 | 与铁律「改表必须新增迁移、不改历史文件」保持同一口径，避免 review 噪声；注释无运行时含义 |
| 老 DB 路径 `%APPDATA%\com.tickbar.app\tickbar.db` | 兼容读取兜底（§4.3） | **必须保留**：这是回滚通道（§10.3）与迁移失败兜底的物理依据 |
| 老 localStorage 键名 | 只读兜底（§3.2 L2-7..11） | 首启一次性读取，读完写新键；一个版本后删除 |
| **`android-app/` 整个目录（含 `app_name` = TickBar、`com.tickbar.droid`、`Theme.TickBar`、`/com/tickbar/droid/` 45 个 .kt）** | 归档的独立 Kotlin 工程 | **归档即保真**：与 `docs/archive/v1/` 同理，历史留档不该被追认为新名字；且本机无 Android 构建环境，改完无法验证（见 §5.7） |
| 旧 APK 文件名 `release/TickBar-android-*.apk` | 历史产物 | 归档产物，不重命名（`归档说明.md` 有索引） |

---

## 3. 三层改动分类（工程师执行清单）

### 3.1 L1 用户可见品牌层（主线全改；`android-app/` 归档件除外）

| # | 文件 | 现值 | 改后 |
| --- | --- | --- | --- |
| L1-1 | `package.json` | `"name": "tickbar"`、`description` 含 TickBar | `"name": "timing"`、`"description": "Timing — 桌面悬浮计时条（Tauri 2 + React 19）"`、`version: 0.5.0` |
| L1-2 | `package-lock.json` | `name` 2 处（`version` 段 + `packages[""]`） | `timing`（`npm install --package-lock-only` 生成，不手改） |
| L1-3 | `src-tauri/tauri.conf.json` | `productName: "TickBar"`、`identifier: "com.tickbar.app"`、主窗 `title: "TickBar"`、`version: 0.4.1` | `Timing` / `com.timing.app` / `Timing` / `0.5.0` |
| L1-4 | `src-tauri/tauri.android.conf.json` | 窗口 `title: "TickBar"` | `Timing` |
| L1-5 | `src-tauri/Cargo.toml` | `name = "tickbar"`、`[lib] name = "tickbar_lib"`、`description`、`authors = ["TickBar Team"]` | `timing` / `timing_lib` / `"Timing — 常驻悬浮计时条（Windows 桌面，纯本地）"` / `["Timing Team"]`、`version = 0.5.0` |
| L1-6 | `src-tauri/Cargo.lock` | `name = "tickbar"` 段 | 由 `cargo build` 自动重写（**禁止手改**；`check:version` 依赖此段，见 §6 P0-4） |
| L1-7 | `src-tauri/src/main.rs` | `tickbar_lib::run()` | `timing_lib::run()` |
| L1-8 | `index.html` | `<title>TickBar · 悬浮时间记录</title>` | `<title>Timing · 悬浮时间记录</title>` |
| L1-9 | `src-tauri/src/app/tray.rs` | `TRAY_ID = "tickbar-tray"`、`tooltip("TickBar")` | `"timing-tray"` / `"Timing"` |
| L1-10 | `src-tauri/src/app/diagnostics.rs` | 首行 `"TickBar diagnostics"` | `"Timing diagnostics"` |
| L1-11 | `src-tauri/src/lib.rs:154` | `.expect("TickBar 启动失败")` | `"Timing 启动失败"` |
| L1-12 | `src-tauri/src/platform/log.rs:115` | `"---- TickBar v{} start (level={:?}) ----"` | `"---- Timing v{} start ..."` |
| L1-13 | **`src-tauri/src/infra/window_spec.rs:41/68/95/123`** | `"TickBar 设置"` / `"TickBar 计时器"` / `"TickBar 事项"` / `"TickBar 便利贴"` | `"Timing 设置"` 等 4 处 —— **上游清单漏项，任务栏/Alt-Tab 里看得见** |
| L1-14 | `android-app/settings.gradle.kts`（**归档件，不动**） | `rootProject.name = "TickBarDroid"` | **不改**（归档零改动，见 §5.7） |
| L1-15 | `android-app/app/build.gradle.kts`（**归档件，不动**） | `namespace`/`applicationId = "com.tickbar.droid"`、`versionCode = 9`、`versionName = "0.3.6"` | **不改**：包名保持 `com.tickbar.droid`、版本保持 `9 / 0.3.6`；冻结值由 `archived-versions.json` 机械断言，防止后续被「顺手同步」 |
| L1-16 | `android-app/.../res/values/strings.xml`（**归档件，不动**） | `app_name = TickBar` | **不改**：保持 `TickBar`（归档状态即正确状态） |
| L1-17 | `android-app/.../res/values/themes.xml`（**归档件，不动**；该工程**无** `values-night`） | `<style name="Theme.TickBar">`（**大写 T，该文件实际如此**）+ `AndroidManifest.xml` 的 `@style/Theme.TickBar` | **不改**：保持大写 `Theme.TickBar`。注意与 L1-18 的 `Theme.tickbar`（小写）**不是笔误差异，是两个工程各自的真实写法** |
| L1-18 | **`src-tauri/gen/android/`（Tauri 移动端工程，已入库）** | `app/build.gradle.kts` 的 `namespace`/`applicationId = "com.tickbar.app"`；`res/values/strings.xml` 的 `app_name`/`main_activity_title`；`res/values/themes.xml`、`values-night/themes.xml` 的 `<style name="Theme.tickbar">`（**小写 t，该文件实际如此**）+ `AndroidManifest.xml` 的 `@style/Theme.tickbar`（**两处必须同时改，漏一处即构建失败**）；`app/src/main/java/com/tickbar/app/MainActivity.kt` 包声明与目录；`assets/index.html` 的 `<title>` | 全部 `com.timing.app` / `Timing` / `com/timing/app/` —— **上游清单漏项** |
| L1-19 | `scripts/build-release.cmd` | `cargo clean --release -p tickbar`、`src-tauri\target\release\tickbar.exe`、`release\TickBar.exe`、注释 | `-p timing`、`...\timing.exe`、`release\Timing.exe` |
| L1-20 | `plugins/md-sync/plugin.json:6`、`plugins/md-sync/README.md:3/13/17` | 描述与安装路径含 TickBar / `%APPDATA%\com.tickbar.app\plugins` | `Timing` / `%APPDATA%\com.timing.app\plugins` |
| L1-21 | `preview/pill-preview.html:6/104` | `<title>`、`<h1>` 含 TickBar | `Timing`（手工预览页，顺手） |
| L1-22 | `release/` 约定 | `TickBar.exe`、`TickBar-android-*.apk` | 新产物 `Timing.exe`、`Timing-android-0.5.0.apk`；旧文件保留不改名 |

### 3.2 L2 内部标识符层（**本次重点**）

> 判定口径：`改` = 必须改；`改+迁移` = 改了老用户会丢东西，必须带补偿；`不改` = 强行改收益为负。

| # | 标识符 | 现值 | 位置（证据） | 处置 | 改后值 | 补偿措施 |
| --- | --- | --- | --- | --- | --- | --- |
| L2-1 | 应用数据目录 | `%APPDATA%\com.tickbar.app` | 由 `tauri.conf.json::identifier` 派生（Tauri `app_data_dir()`） | **改+迁移** | `%APPDATA%\com.timing.app` | 整目录迁移，见 §4 |
| L2-2 | 数据库文件名 | `tickbar.db` | `infra/db.rs:17`、`app/diagnostics.rs:37`、`tests/migration_v2.rs:119` | **改+迁移** | `timing.db` | 迁移时新旧目录内均改名；DB 打开前加兜底：`timing.db` 不存在但同目录有 `tickbar.db` → 用它（一次性，见 §4.3） |
| L2-3 | 日志文件名 | `tickbar-YYYY-MM-DD.log` | `platform/log.rs:98`、模块注释 `log.rs:19` | **改** | `timing-YYYY-MM-DD.log` | 无需迁移：`prune()` 按 mtime+扩展名清理（`log.rs:71-93`），不解析文件名，旧文件自然过期 |
| L2-4 | 日志级别环境变量 | `TICKBAR_LOG` | `platform/log.rs:18/107`、`error.rs:198` 注释 | **改+兼容** | `TIMING_LOG` | 读 `TIMING_LOG`，缺失时回落读 `TICKBAR_LOG` 并打一条 WARN（保留 1 个版本） |
| L2-5 | 构建期时间戳 | `TICKBAR_BUILD_TIME` | `app/diagnostics.rs:25`、构建脚本 | **改** | `TIMING_BUILD_TIME` | 构建脚本与 `option_env!` 同批改；无用户面影响，不兼容 |
| L2-6 | 前端编译期常量 | `__TICKBAR_MOBILE__` | `vite.config.ts:45`、`vitest.config.ts:14`、`src/lib/platform.ts:17,19`、**`scripts/check-layers.mjs:13,51,94`** | **改** | `__TIMING_MOBILE__` | **必须同批改 `check-layers.mjs` 的 L7 正则**：漏改则规则扫描一个不存在的常量，门禁**仍然绿灯但完全失效**（见 §8 风险 R7） |
| L2-7 | 主题缓存键 | `tickbar.theme` | `src/types/domain/constants.ts:56`（`THEME_CACHE_KEY`）、`src/lib/theme.ts:185/195`、**`index.html:17` 内联防白闪脚本（硬编码字面量）** | **改+兼容** | `timing.theme` | 两处必须同批改（内联脚本逃过类型检查）；读取顺序：新键 → 老键 → 默认；读到老键即写新键 |
| L2-8 | 外观偏好键 | `tickbar.appearance.v1` | `src/stores/appearanceStore.ts:11` | **改+兼容** | `timing.appearance.v1` | 同上双读；此键只影响强调色/透明度偏好，丢失可接受但**免费**，一并兼容 |
| L2-9 | 倒计时档位键 | `tickbar.countdownArm.v1` | `src/stores/countdownArm.ts:13` | **改+兼容** | `timing.countdownArm.v1` | 同上 |
| L2-10 | 倒计时上次时长键 | `tickbar.countdownDuration.v1` | `src/stores/countdownArm.ts:16` | **改+兼容** | `timing.countdownDuration.v1` | 同上 |
| L2-11 | 窗口自适应偏移键 | `tickbar:fit-offset` | `src/hooks/useWindowAutoFit.ts:44` | **改+顺手统一** | `timing.fit-offset` | 分隔符从 `:` 统一为 `.`（与其他 4 键一致，见 §6 P1-2）；双读兼容 |
| L2-12 | 移动端历史 state 标记 | `{ tickbarRecover: true }`、`{ tickbarOverlay: true }` | `components/mobile/MobileShell.tsx:92`、`hooks/useMobileBackSheet.ts:26` | **改**（无害） | `timingRecover` / `timingOverlay` | 纯运行期内存标记，不持久化，无兼容需求 |
| L2-13 | 托盘 id | `tickbar-tray` | `app/tray.rs:21` | **改** | `timing-tray` | 托盘按 id 重建，无持久化 |
| L2-14 | 临时目录/临时文件前缀 | `tickbar-md-backup-{tag}`、`.{name}.tickbar-{pid}.tmp`、`tickbar-plugin-{tag}-...` | `infra/md_backup.rs:113`、`infra/md_file.rs:260`、`services/plugin.rs:236` | **改** | `timing-*` / `.{name}.timing-{pid}.tmp` | 临时文件，无兼容。注意 `md_file.rs` 的 tmp 与目标同目录并 rename，前缀仅供人辨认 |
| L2-15 | 前端 console 前缀 | `[tickbar]` | `components/ui/AppErrorBoundary.tsx:38,72` | **改** | `[timing]` | 无 |
| L2-16 | 测试/文档中的路径字面量 | `%APPDATA%\com.tickbar.app\plugins` | `components/settings/PluginsTab.test.tsx:27`、`src/mocks/browserMockPlugins.ts:23`、`infra/plugin_fs.rs:9` 注释、`models/plugin.rs:99` 注释 | **改** | `com.timing.app` | 仅测试夹具与注释，无运行时依赖；漏改会让单测断言一条不存在的路径 |
| L2-17 | 测试用环境变量名 | `%TICKBAR_NO_SUCH_VAR%` | `infra/md_file_test.rs:59,60` | **改** | `%TIMING_NO_SUCH_VAR%` | 用例语义不变 |
| L2-18 | **Windows 开机自启注册表值名** | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\TickBar` | `tauri-plugin-autostart` 用 `productName` 作值名（`README.md` 平台表已注明走注册表 `Run`） | **改+清理** | `...\Run\Timing` | **迁移时必须删旧值**：旧值指向旧版 exe（NSIS 默认 `%LOCALAPPDATA%\{productName}\`，实际以打包模板为准），卸载旧版后成为孤儿（登录时静默失败或弹"找不到文件"）。实现要点：迁移成功后按用户原「开机自启」设置重新 `enable()`，并显式删除 `Run\TickBar` 值；**值名口径需架构师核对插件实现后确认**，但"清理旧值"这一动作不依赖口径 |
| L2-19 | 窗口位置状态 | `.window-state.json`（在 app_data_dir 内） | `bootstrap.rs` 注释确认插件在窗口创建时回填 | **不改代码，随迁移** | 同文件随目录搬走 | 迁移必须在**窗口创建之前**执行，否则首启窗口位置回到默认（§4.2 时序要求） |
| L2-20 | 插件目录 | `<app_data_dir>\plugins` | `infra/plugin_fs.rs` | **不改代码，随迁移** | — | 已装插件（如 `md-sync`）随目录整体搬走；`md-sync` 的 SAF/Obsidian 落点是外部绝对路径，不受影响 |
| L2-21 | SQL 表名/列名/`settings.schema.version` | `items`/`time_records`/`todos`/`notes`/`settings`… v4 | `migrations/0001~0004.sql` | **不改** | — | 改 = 全量数据重写风险，收益为零 |
| L2-22 | IPC 命令名 / 事件名 / 错误码字符串 | 65 / 11 / 16 | `lib.rs`、`infra/events.rs`、`error.rs` | **不改** | — | 语义与品牌无关；改了要动 4 处 + ADR |
| L2-23 | 窗口 label | `main`/`settings`/`todos`/`timer`/`note-{id}` | `infra/window_spec.rs` | **不改** | — | 前端按 label 路由（`App.tsx`），`ADR-009` 已锁定；`note-{id}` 含业务主键 |
| L2-24 | CSS 令牌名 | `--pill-*`/`--color-*`… | `src/styles/tokens/**` | **不改** | — | 令牌名无品牌字样；改了等于全量样式回归 |
| L2-25 | 插件 `id` / `apiVersion` / 贡献点 | `md-sync`、`2`、`mdSync` | `docs/plugin-spec.md`、`plugins/md-sync/plugin.json` | **不改** | — | 改 `id` 会让用户已装插件目录失联；改契约要升 `apiVersion` + 改契约文档 |
| L2-26 | 安卓 SharedPreferences 文件名 | `"tickbar"` | `android-app/.../core/Prefs.kt`（**仅存在于归档工程**） | **不改**（归档零改动） | 保持 `"tickbar"` | 主线 `gen/android` 没有这个文件（它是 Tauri 工程，偏好走前端 localStorage），故本条对 0.5.0 主线无影响（见 §5.7） |
| L2-27 | 安卓私有库文件名 | `tickbar.db` | `android-app/.../core/Db.kt:NAME`（**仅存在于归档工程**） | **不改**（归档零改动） | 保持 `tickbar.db` | 主线 `gen/android` 与桌面共用 `infra/db.rs`，库名随 L2-2 变为 `timing.db`；归档件不发布、不可安装升级，无跨端同步对象（见 §5.7） |

### 3.3 L3 注释与文档层（改的范围与边界）

#### 数量基线（实测）

| 类别 | 规模 | 说明 |
| --- | --- | --- |
| `src/**` 文件头注释 `* TickBar — xxx` | **231 个文件** | `src/` 共 253 个文件，几乎全覆盖 |
| `scripts/*.mjs`、`vite.config.ts`、`vitest.config.ts`、`eslint.config.js` 头注释 | 6 个文件 | `check-contract` / `check-layers` / `check-size` / `check-version` 的首行注释 |
| Rust 侧 `TickBar` 字样 | 19 处（1 处 `//!` 头注释 + 18 处句内引用） | 与前端不同：Rust 用 `//!` 且多为正文句内提及 |
| 前端 `TickBar` 字样总计 | 232 处 | 绝大多数是头注释 |
| git 跟踪的含 `TickBar`/`tickbar` 文件总数 | 约 290 个（含 gen/android 产物、文档、SQL） | 见 §3.3.2 分类 |

#### 3.3.1 目录级判定规则（写死，避免逐个争辩）

| 规则 | 判定 | 应用 |
| --- | --- | --- |
| **R1** 路径含 `archive/`、`reviews/`、`phase4/`，或文件名含 `PHASE-` | **不改** | `docs/archive/v1/**`、`docs/reviews/**`、`docs/phase4/**`、`docs/PHASE-V0.2.0-*.md` |
| **R2** 文件名或首行含具体日期（`2026-10-18` 等） | **不改**（历史快照） | `docs/reviews/2026-10-18-*`、`docs/reviews/2026-10-25-*` |
| **R3** `docs/decisions/ADR-*.md` | **不改正文**，新增 `ADR-036：品牌回归 Timing` | 全 35 篇 |
| **R4** 被 `AGENTS.md` / `README.md` 引用为「正本/契约/规格」的文档 | **改** | `docs/phase2/IPC-CONTRACT-v2.md`、`IPC-CONTRACT-v3.md`、`docs/plugin-spec.md`、`docs/phase1/ARCHITECTURE-V0.2.0.md`、`docs/design/DESIGN-V0.2.0.md`、`docs/mobile/PRD-ANDROID-V1.md`、`docs/mobile/DESIGN-ANDROID-V1.md`、`docs/phase2/schema-V0.2.0.sql` |
| **R5** 带 `[未发布]`/版本标题的日志类文件 | **只追加，不回改** | `CHANGELOG.md`、`更新日志.md` |
| **R6** `src-tauri/src/migrations/*.sql` | **不改**（含注释） | 与「不改历史迁移」铁律同口径 |
| **R7** 其余 `docs/**` 现行文档 | **改** | `docs/overview-V0.2.0.md`、`docs/CHANGE-PLAN-V0.2.0.md`、`docs/Spec-V0.2.0.md`、`docs/design/**`（含 `BRAND-ICON.md`、`TIMING-DELTA-AUDIT.md`）、`docs/sync/OBSIDIAN-SYNC.md`（当前未入库，见 P0-2） |
| **R8** 根目录文档 | **改** | `README.md`、`AGENTS.md`、`归档说明.md`、`plugins/md-sync/README.md` |

#### 3.3.2 必须一并修改的「文档内可执行断言」（易漏，会让验收假通过）

| 位置 | 内容 | 风险 |
| --- | --- | --- |
| `docs/mobile/DESIGN-ANDROID-V1.md:260` | `unzip -p "$APK" assets/tauri.conf.json \| grep -q '"identifier":"com.tickbar.app"' && echo "id OK"` | 不改 → QA 按文档验证新版 APK 会**假失败**（或有人顺手改成 `com.timing.app` 但漏改别处） |
| `docs/mobile/DESIGN-ANDROID-V1.md:55` | 安卓私有目录 `.../files` + `tickbar.db` 说明 | 不改 → 排障时按错误路径找库 |
| `plugins/md-sync/README.md:13,17` | 插件安装路径 `%APPDATA%\com.tickbar.app\plugins\md-sync` | 不改 → 用户按文档装到已废弃路径，插件"装了不生效" |
| `AGENTS.md`、`README.md` 版本号 | `0.4.1` | 不改 → `check:version` 绿但文档错；`README.md` 首行标题也是版本 |
| `scripts/check-version.mjs:8,36,39` | 硬编码 `name = "tickbar"` 的 Cargo.lock 解析 | 不改 → 解析不到版本，门禁红（这个是"红得明显"，属可控） |

> **纪律一（字面量以真实文件为准）**：本文档（以及任何验收清单）里出现的类名 / 资源名 / 路径字面量，**一律以真实文件内容为准**，不得凭印象书写。凡新增断言，落地时先 `grep` 一次真实文件确认字面量。
>
> **纪律二（大小写必须不敏感）**：**所有品牌残留校验一律用 `git grep -in`（`-i` 大小写不敏感），禁止区分大小写。**
>
> 这条是被一次真实误判逼出来的：两个安卓工程的主题名大小写**相反**且**都正确**——
> `src-tauri/gen/android/`（主线）= `Theme.tickbar`（小写 t，`values/`、`values-night/` 与 Manifest 三处一致）；`android-app/`（归档）= `Theme.TickBar`（大写 T，`values/` 与 Manifest 两处一致）。
> 若 QA 在 `android-app/` 里 `grep "theme.tickbar"`（区分大小写）→ **0 命中 → 误判「已改完」**；反过来在 `gen/android` 里 `grep "Theme.TickBar"` 同样 0 命中。**断言写错大小写 = QA 的 grep 静默漏过，比不写断言更危险**——不写断言至少会人工看一眼，写错却会给出「已检查、通过」的假证据。

#### 3.3.3 头注释批量改写的执行要求

- 统一替换 `* TickBar — ` → `* Timing — `（前端 231 个文件）、`//! TickBar ` → `//! Timing `（Rust）。
- **禁止用无脑全局 `sed`**：`TickBar` 出现在 `Timing（原 TickBar）` 语境、`ADR` 引用、历史版本说明里时不能替换。建议：先 `git grep -n "TickBar"` 人工过一遍分类，再按目录白名单脚本化。
- 每批改完必须跑 `npm run check` + `cargo test`；头注释改动**不应**触碰 300 行上限（替换为等行数），但需确认（§6 P1-1）。
- 提交粒度：`refactor(rename): L1 品牌层` / `refactor(rename): L2 标识符 + 迁移` / `docs(rename): L3 注释与文档`，三个 commit 分开，便于 review 与回滚。

---

## 4. 数据迁移用户侧规格（可验收句式）

### 4.1 触发条件

迁移有**三个互斥入口**，按序判定。

**（1）常规迁移** —— **如果** 以下条件**全部**成立，**那么** 执行自动迁移：

1. 运行平台是桌面（Windows）；
2. 新目录 `%APPDATA%\com.timing.app` 下**既无** `timing.db` **也无** `tickbar.db`；
3. 老目录 `%APPDATA%\com.tickbar.app` 存在，且其中至少有 `tickbar.db` / `plugins/` / `logs/` / `.window-state.json` 之一；
4. 未处于「跳过迁移」状态——**release 构建默认执行**；**debug 构建默认跳过**，仅当显式设置 `TIMING_FORCE_MIGRATE=1` 才执行。

> 条件 4 为什么是「默认跳过」而不是「脚本里加环境变量」：`tauri dev` 与正式版共用同一个 identifier，靠脚本传变量等于**靠记性**；默认跳过才是**靠机制**。release 行为零变化。

**（2）覆盖式迁移** —— **如果** 新库已存在、**但** 存在 `pending-migrate.json` 标记、**且** 老目录仍有数据，**那么** 执行覆盖式迁移（规格见 §4.3）：把当前新目录**整体改名**为 `com.timing.app.premigrate-<时间戳>` 留档，再把老数据迁入。

> **为什么必须有这一条（v1 的逻辑漏洞）**：v1 承诺「用户选『以空白数据启动』后，下次启动仍会重试迁移」在实现上**不成立**——空白会话必然在 `com.timing.app` 里建出 `timing.db`，使入口（1）条件 2 永久为假，**老数据从此再也不会被迁移，且用户收不到任何提示**。`pending-migrate.json` 是唯一能跨会话保留「还欠一次迁移」这一事实的载体。

**（3）不迁移** —— **如果** 入口（1）条件 2 不成立、且不存在 `pending-migrate.json`，**那么** 不迁移、不覆盖、不合并，只记 WARN + 诊断快照输出一行「发现未采用的旧数据：<路径>」，并在设置页迁移卡片显示「发现未采用的旧数据」。（本机现状即命中此分支，见 §8 风险 R2。）

**如果** 入口（1）条件 3 不成立（全新用户），**那么** 直接以空库初始化，日志记 `migrate: no legacy data`，卡片显示「全新数据」。

### 4.2 执行时序（架构硬要求）

**必须**在 `src-tauri/src/lib.rs::run()` 内、`Builder::run()` **之前**执行。

**为什么 `platform::boot_timing::start()` 仍保留在第一行（不是漏改）**：它是冷启动计时的唯一起点，后续 `log_ready` / `db_ready` / `first_frame` 各打点都相对它计算。若把迁移放在它前面，首启耗时统计就会**恰好把最慢的一段（首次迁移可能数百毫秒到数秒）排除在外**——在最需要测量的时候把最该被测量的段落丢掉，等于这个埋点在最关键的版本里失效。因此顺序固定为：`boot_timing::start()` → 迁移 + preboot 决策 → `Builder::run()`。语义上「迁移早于任何 Tauri 初始化」依然成立，因为 `boot_timing::start()` 只记一个时间戳，不做任何初始化。

理由（`app/bootstrap.rs:22` 注释 + `tauri-2.12.4/src/app.rs::setup`）：`setup` 回调**晚于** config 窗口创建，`window-state` 的 `on_window_ready` 在那一刻就回填位置——迁移若写进 `setup`，首启必拿到**空的新目录**，窗口位置回默认，`L2-19` 与 M-11 必失败。

```
run()
 ├─ platform::boot_timing::start()                  ← 保持第一行（计时起点）
 ├─ [新增] let ctx = tauri::generate_context!();     ← 只读 config，不建 App
 ├─ [新增] #[cfg(desktop)] app::preboot::prepare(Paths::resolve(ctx.config().identifier), id)
 │     ├─ infra::appdata_migrate::run_once()         ← 纯文件操作，headless、无 UI
 │     └─ 失败时弹 rfd 阻塞式对话框（重试 / 以空白数据启动 / 退出）——仍在主线程、事件循环未启动
 ├─ Builder::default()...setup(bootstrap::setup)
 │     ├─ log::init(app_data_dir)      ← 迁移结果在此补记日志（迁移跑在 log::init 之前，自身无日志能力）
 │     └─ db::init_pool(app_data_dir)  ← 此时读 timing.db
 └─ builder.run(ctx)  → 窗口创建 + window-state 回填
```

> **失败对话框不得用 `tauri-plugin-dialog`**：该插件 `blocking_show` 的源码注释明确「不得在主线程调用」，而 `run()` 就是主线程 → 调用即自锁。
>
> **给工程师的警示（失败模式长什么样）**：主线程自锁的表现是**进程起来了、窗口一个都不出、任务管理器里有 Timing.exe、点图标没反应、日志里一条错误都没有**（因为阻塞发生在日志初始化之后、事件循环启动之前，logger 本身也写不出东西）。这类"没起来但没报错"的故障最容易被误判成打包问题或杀软拦截，排查方向会完全跑偏。因此**必须在代码里就不能这么写**：`rfd 0.16`（已在 `tauri-plugin-dialog` 的依赖树内，零新编译）在事件循环启动前阻塞是安全的。这条不是风格偏好，是防一类无法从日志反推的死法。
>
> **迁移先于日志**：迁移自身没有 logger，结果缓存在内存，由 `bootstrap::setup` 在 `log::init` 之后按结果补记 `migrate: ok/...`；失败明细直接写 `migration-failed.txt`，不依赖 logger。

### 4.3 迁移内容与方式

| 项 | 规格 |
| --- | --- |
| 方式 | **复制，不移动**（老目录原样保留，作为回滚通道与二次兜底） |
| 原子性 | 先复制到临时目录 `%APPDATA%\com.timing.app.migrating`，全部成功后再 `fs::rename` 为 `com.timing.app`；失败则删临时目录。**保证"要么完整迁移，要么完全没有新目录"** |
| **覆盖式迁移的落地方式** | 目标目录已存在时 `fs::rename(temp, target)` 在 Windows 必失败 → 先把 target **整体改名**为 `%APPDATA%\com.timing.app.premigrate-<yyyyMMddHHmmss>`（只 rename、**严禁删除**），再把 temp rename 成 target。**若该时间戳目录已存在则加序号**（`-2`、`-3`），**不得覆盖任何已有留档** |
| **覆盖式迁移留档的用途** | ① 用户在选择「空白启动」后、下次启动前录入的数据不会丢；② 万一迁移出的老数据不是用户想要的，留档是最后一份现场；③ 设置页明示留档路径，用户可自行删除或交给支持 |
| 复制范围 | 老目录整棵树：`tickbar.db` → `timing.db`、**`tickbar.db-wal` / `tickbar.db-shm`（如存在，必须一并复制）**、`logs/`、`plugins/`、`backups/`、`.window-state.json` |
| WAL 注意 | SQLite 处于 WAL 模式（`db.rs:22`）。只拷主库会丢掉未 checkpoint 的事务 —— 必须连同 `-wal`/`-shm` 一起复制，或复制前确认无进程占用 |
| 并发 | 依赖 `tauri-plugin-single-instance`（`lib.rs` 已注册）保证同机单实例；若前进程未退出导致占用，走 §4.5 失败分支 |
| 校验 | ① 新库存在且 `size == 老库 size`；② `PRAGMA integrity_check` 返回 `ok`；③ 关键表行数与老库一致（`items` / `time_records` / `todos` / `notes` / `settings`）；④ 校验 `settings.schema.version` 可读 |
| 迁移标记（成功） | 成功后写 `%APPDATA%\com.timing.app\migrated-from-tickbar-app.json`：`{ schema:1, at, appVersion, source, dbBytes, rowCounts:{items,timeRecords,todos,notes,settings}, walCopied, verified }`，供诊断、设置页卡片与 QA 核对 |
| 迁移标记（欠账） | 用户在失败对话框选「以空白数据启动」时写 `%APPDATA%\com.timing.app\pending-migrate.json`：`{ schema:1, blankStartedAt, reason:"user chose blank start", legacyDir }`。**覆盖式迁移成功后删除该文件** |
| 迁移失败记录 | 追加写 `%APPDATA%\com.tickbar.app\migration-failed.txt`（`stage` / `reason` / `source` / `temp` / `detail`）；老目录只读写不进去时退化为「只写日志」，**不因此判定迁移失败** |
| 老目录处置 | **永久保留，不自动删除**（已决，见 §10）。设置页诊断文本追加一行：`旧数据备份：%APPDATA%\com.tickbar.app（可手动删除）` |
| 自启清理 | 迁移成功后按用户原「开机自启」设置重挂 `Timing`，并**幂等清理旧值**（`Run\TickBar` 与 `Run\com.tickbar.app` 双名都试、删不到静默忽略）；`auto-launch` 还会写 `Explorer\StartupApproved\Run\<name>`（任务管理器启动项），**两处都要清**，否则启动项列表永远留着 TickBar（§L2-18） |

### 4.4 用户可见行为

**如果** 迁移成功，**那么**：

- 首启**无任何弹窗**（静默成功，不给用户制造"我的数据都被动了"的错觉）；
- 计时记录、待办、便利贴、常用事项、主题/外观偏好、窗口位置、已装插件全部与升级前一致；
- 日志出现 `migrate: ok from=...\com.tickbar.app rows=... bytes=...`；
- 诊断快照 `app_data_dir` 显示 `...\com.timing.app`，`database` 显示 `timing.db`。

**如果** 迁移失败，**那么**：

- **绝不**以空库进入主界面（禁止静默丢数据）；
- 删除本次产生的临时目录，老目录**一字节不动**；
- 弹一个**原生阻塞对话框**（`rfd`，在 `Builder` 之前、事件循环未启动时弹出，见 §4.2 注）：
  - 标题：`数据迁移未完成`
  - 正文：`检测到旧版本数据，但迁移失败，你的原始数据完整保留在：\n%APPDATA%\com.tickbar.app\n原因：{简短原因}\n\n你可以选择重试，或先以空白数据启动（旧数据不会被修改，下次启动会自动再试一次）。`
  - 按钮：`重试`（默认）/ `以空白数据启动` / `退出`
- 写 `%APPDATA%\com.tickbar.app\migration-failed.txt`（追加一段：时间、stage、错误、校验明细），并 `log_error!`；
- 选「退出」→ 进程退出（退出码 2），**不建库、不写任何标记**，老目录一字节不动。

**如果** 用户在失败对话框里选「以空白数据启动」，**那么**：

- 本次会话正常建库、正常使用（不阻塞用户）；
- **必须**写 `%APPDATA%\com.timing.app\pending-migrate.json`（字段见 §4.3）——这是"还欠用户一次迁移"的唯一凭据；
- **不写** `migrated-from-tickbar-app.json`（没迁移成功就不许假装成功）；
- 设置页迁移卡片显示「**旧数据待迁移**（上次选择了空白启动）」，并提供「现在迁移」入口；
- **下次启动**命中 §4.1 入口（2）→ 覆盖式迁移：当前目录整体改名留档 → 老数据迁入 → 删 `pending-migrate.json` → 卡片显示「**已覆盖恢复**，原目录保留于 `<premigrate 路径>`」。

**如果** 覆盖式迁移本身也失败，**那么** 保留 `pending-migrate.json`（下轮继续尝试）+ 保留 premigrate 留档，仍然弹同一个对话框——**两头都不许丢**。

### 4.5 可验收用例（QA 直接转）

| # | 场景（如果…） | 期望（那么…） |
| --- | --- | --- |
| M-01 | 老目录有 0.4.1 数据（含 500 条记录 + 20 待办 + 3 便利贴 + 2 插件），首次启动 0.5.0 | 全部数据在 UI 中可见；行数/条数与升级前一致；老目录仍在且未被修改（mtime 不变，除 wal） |
| M-02 | 迁移成功后再次启动 | **不再迁移**（新库已存在）；无重复数据、无弹窗；日志不出现第二次 `migrate: ok` |
| M-03 | 迁移成功后手动删除老目录，再次启动 | 正常启动，无报错、无弹窗（代码不得依赖老目录存在） |
| M-04 | 全新机器（两目录都不存在） | 正常空库启动；日志 `no legacy data` |
| M-05 | 新目录已存在且有 `timing.db`（例：本机现状） | 不迁移、不覆盖；日志 WARN 列出旧数据路径；用户当前数据不被替换 |
| M-06 | 复制过程中磁盘满 / 目标只读 | 走失败分支：无残留半成品目录、老目录完好、弹窗 + `migration-failed.txt`、不以空库进入 |
| M-07 | 迁移中强杀进程（复制到一半） | 下次启动：临时目录被识别并清理，重新完整迁移；不出现"半个新库" |
| M-08 | 老库处于 WAL 且有未 checkpoint 数据 | 迁移后新库包含最后一批记录（证明 `-wal` 被复制） |
| M-09 | 设置 `TIMING_SKIP_MIGRATE=1` | 完全不迁移，以新目录空库启动（开发/QA 用） |
| M-10 | 老版本开启过开机自启 | 迁移后自启仍生效，且注册表只有 `Timing` 一项，无 `TickBar` 孤儿项 |
| M-11 | 迁移后主题为"浅色"、窗口在副屏 | 首启仍是浅色、仍在副屏原位置（证明 localStorage 兼容 + window-state 迁移 + 时序正确） |
| M-12 | 迁移后卸载 0.5.0，装回 0.4.1 | 0.4.1 正常读到全部老数据（回滚通道有效，见 §10.3） |
| M-13 | 老目录存在但只有一个空 `logs/`（无 db） | 视为"有旧数据"→ 复制日志后正常空库启动；不弹失败框 |
| M-14 | 迁移过程中用户又双击启动一次 | 单实例插件接管聚焦已有窗口，第二个进程不参与迁移（无竞态） |
| **M-15** | 失败后选「以空白数据启动」→ 在空白会话里录入 1 条记录 → 重启 | 启动即执行覆盖式迁移：主库变回**老数据**；空白会话那 1 条记录仍在 `com.timing.app.premigrate-<ts>` 留档里可查；`pending-migrate.json` 已删除；卡片显示「已覆盖恢复」 |
| **M-16** | `premigrate-<时间戳>` 目录名已被占用（同一秒内二次覆盖） | 新留档自动加序号（`-2`），**不覆盖**任何已存在的留档目录；两份留档都在 |
| **M-17** | 覆盖式迁移复制阶段失败 | `pending-migrate.json` 保留、`premigrate-*` 留档保留、target 目录回到覆盖前状态；弹窗可重试；**任何一份数据都不丢** |
| **M-18** | debug 构建（`npm run tauri dev`），未设 `TIMING_FORCE_MIGRATE` | 跳过迁移（`source=skipped`），不做任何文件操作；设 `TIMING_FORCE_MIGRATE=1` 后再启动 → 正常迁移 |

### 4.6 失败处理原则（四条红线）

1. **不许静默丢数据**：任何失败都必须留痕（日志 + 文件）并告知用户。
2. **不许破坏源数据**：老目录只读复制，永不 move、永不部分删除。
3. **不许假装成功**：行数/完整性校验不过 = 失败，等同于复制异常。
4. **覆盖式迁移的留档只改名、严禁删除**：`premigrate-<ts>` 与老目录一样是用户的现场，删除动作只允许用户自己发起。

---

## 5. 安卓升级代价说明

### 5.1 事实

| 项 | 说明 |
| --- | --- |
| 包名 | **`com.tickbar.app` → `com.timing.app`（Tauri 主线，本轮唯一变更）**；`android-app/` 的 `com.tickbar.droid` **保持不变**（归档零改动，见 §5.7） |
| 系统语义 | Android 以 `applicationId` 为身份。改包名 = **新应用**，无法覆盖升级，必须卸载重装 |
| 数据影响 | 老包私有目录 `/data/data/com.tickbar.app/files/tickbar.db`、同沙箱的偏好存储、SAF 落点授权全部**随卸载丢失**（未 root 无法导出）。（历史上装过独立工程 `com.tickbar.droid` 的用户同理，但该包已归档、不再发版） |
| `allowBackup="true"` 能否救 | **不能**。自动备份集按包名归属，新包名恢复不到旧备份 |
| 版本 | `android-app/`（归档工程）**冻结 `versionCode 9 / versionName 0.3.6`**，不随 0.5.0 升（见 §5.7）；`src-tauri/gen/android/` 的版本由 CLI 生成的 `tauri.properties` 提供，不手改 |
| 两套工程 | `src-tauri/gen/android/`（Tauri mobile，`com.timing.app`）为**唯一主线**；`android-app/`（独立 Kotlin）入库后**归档 + 代码零改动**（包名仍为 `com.tickbar.droid`）、本轮不发布（见 §5.7、§10） |

### 5.2 用户侧代价（必须写进 release notes 与应用内提示）

1. 需要**卸载旧版 TickBar** 再装 Timing（不会自动升级）；
2. 旧版数据**不会**自动带过来；
3. 系统设置里「显示在其他应用上层」权限需要为 **Timing** 重新授予（权限跟随包名）；
4. 若用过 Markdown 同步：落点目录在 SAF 中授权过，需重新选择同一目录；
5. 悬浮条位置、主题、倒计时档位等偏好需重设。

### 5.3 迁移路径（给用户的唯一可行方案）

**推荐路径：Markdown 同步（SAF 目录，卸载不删）**

1. 旧版 TickBar → 设置 → 同步：确认落点目录可用，点「立即同步」把计时记录/待办/便利贴写入 Markdown；
2. 卸载 TickBar；
3. 安装 Timing → 设置 → 同步：选择**同一个**目录，执行反向导入；
4. 校验：记录条数与同步前一致。

**备用路径**：`adb backup` 仅在对旧包执行 `bmgr` 且系统未限制时可用，不作为官方口径。

### 5.4 提示文案（可直接抄）

**应用内公告（0.4.1 安卓版最后一次更新里预埋）**

> **Timing 0.5.0 起，安卓包名将变更**
> 由于包名调整，新版本无法直接覆盖升级，需要卸载后重新安装，旧版本中的数据不会自动保留。
> 建议先在「设置 → 同步」里把数据同步到 Markdown 目录，装好新版后再从同一目录导入。
> 桌面版（Windows）不受影响，升级时会自动迁移全部数据。

**Release notes 段落**

> **安卓用户请先看这里**：本次包名由 `com.tickbar.app` 变更为 `com.timing.app`，系统会把它当成一个新应用 —— 请先卸载 TickBar 再安装 Timing，旧版数据不会自动迁移。上手前请用「设置 → 同步」把数据落到 Markdown 目录，装好新版后重新选择该目录导入。这是包名变更的固有代价，仅此一次。

> **注（写给维护者，不进 Release 正文）**：正文只提 `com.tickbar.app` → `com.timing.app`（主线，用户实际安装的那个包）。历史上有极少量用户装过独立工程版（`com.tickbar.droid`），同样需要卸载重装，但其包名本轮**不会**变更（该工程已归档），不必在文案里展开。

### 5.5 本轮 Release 不含安卓产物（已决）

| 项 | 结论 |
| --- | --- |
| 能否构建 | **不能**。本机 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `NDK_HOME` 全为空，`java` 不在 PATH，`rustup target list --installed` 只有 `aarch64-apple-darwin` / `x86_64-apple-darwin` / `x86_64-pc-windows-msvc` / `x86_64-unknown-linux-gnu`（无任何 Android target）→ `tauri android build` 必然失败 |
| Release 附件 | **只含 Windows 产物**（`Timing.exe` / 安装包）+ `SHA256SUMS.txt`；**不得出现任何 `.apk`** |
| Release 正文 | 必须明写「**安卓本轮无产物**」及原因（缺构建环境），并指向 §5.3 的手工迁移路径。**禁止**写「APK 已验证」「安卓版可用」之类无法兑现的话 |
| 安卓包名变更的性质 | **纸面正确、未经编译验证**：`src-tauri/gen/android/` 的 `com.timing.app` 只做了文本搬迁（含 Manifest 的 `@style/` 引用同步），**没有一次真实 `assembleDebug`**。所有相关文档必须标注「未编译验证」。`android-app/` **无任何改动**（归档，见 §5.7） |
| 归档工程版本 | `android-app/` 冻结 `9 / 0.3.6`；`archived-versions.json` 记录该冻结值，`check:version` 对它做**相等断言**（不是"与桌面一致"）。理由：冻结值才能被门禁校验「没被误动」，而一个永不发布的工程追版本号无收益。**整个目录的零改动口径见 §5.7** |
| 安卓延后发版 | 等有 Android SDK/NDK/Java 的环境后**单独发一版**，届时补 `VERIFY.md` 的「未验证项」 |

### 5.6 首次构建安卓产物时的注意事项（写给未来的自己，Hand-off）

1. **先装环境**：Android SDK（platform 36 / build-tools）+ NDK + JDK 17，`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`。
2. **`assets/` 不在库里**：`src-tauri/gen/android/app/src/main/assets/**` 已按 P0-6 出库，构建前必须先 `npm run build` 产出 `dist/`，由 CLI 拷入。
3. **包名目录要对得上（仅主线 `gen/android`）**：`namespace` / `applicationId` / `MainActivity.kt` 的 `package` 三处必须同为 `com.timing.app`，`git grep -in "com.tickbar" src-tauri/gen/android` 必须为空。**注意 `android-app/` 不在校验范围内**——它故意保留 `com.tickbar.droid`（归档，见 §5.7），在那里命中 `com.tickbar` 是**正确状态**，不是漏改。
4. **主题名（仅主线 `gen/android`）：`Theme.tickbar` → `Theme.timing`**，`AndroidManifest.xml` 的 `android:theme` 与两套 `themes.xml`（`values/`、`values-night/`）的 `<style name>` **三处必须同时改、同名**，漏一处 Android 会因找不到 parent style 直接构建失败。**归档工程 `android-app/` 保持 `Theme.TickBar`（大写 T）不动**——两个工程大小写本就不同，别顺手统一。
5. **签名**：当前主线 release 用 debug keystore 自签（沿袭 `android-app` 历史做法）；正式上架前必须换正式签名，且**签名一旦更换，后续版本必须沿用同一把**，否则同样会变成「无法覆盖升级」。
6. **首次装机的验收**：把 §4.5 的 M 系列用例在安卓上重跑一遍不适用（安卓无自动迁移），只需验证「能装、能开、悬浮条能显示、卸载后重装数据为空」符合 §5.2 预期。

### 5.7 `android-app/` 归档件代码零改动（已决）

**结论：`android-app/` 作为归档工程原样冻结，一个字符都不改**——含 `app_name`（仍为 `TickBar`）、包名（仍为 `com.tickbar.droid`）、主题名（仍为 `Theme.TickBar`）、45 个 `.kt` 的包路径（仍在 `com/tickbar/droid/`）、`versionCode 9 / versionName 0.3.6`。
**它保留 TickBar 旧名是归档的正确状态，不是遗漏。**（v2 曾要求一并改名，v3 撤回。）

**三条理由（QA 会把残留当"漏改"报上来，先在此备案）**

| # | 理由 | 说明 |
| --- | --- | --- |
| 1 | **无法验证的改动等于未知风险** | 本机 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `NDK_HOME` 全空、`java` 不在 PATH、rustup 无 android target → 改完**无法编译验证**。而改 `themes.xml` 的 `<style name>` 却漏改 `AndroidManifest.xml` 的 `@style/` 引用，该工程一旦重新启用就**直接编译失败**——一个"顺手改名"会变成一颗定时炸弹 |
| 2 | **它不影响用户看到的软件名** | 归档件不参与任何发布；`release/` 里的历史 apk 是既成事实，不该回改。改它对用户可见面收益为零 |
| 3 | **归档即保真** | 与 `docs/archive/v1/`、`docs/reviews/**` 同一口径：历史留档不该被追认为新名字。追认会让"当时到底是什么"变得不可考 |

**三项配套（缺一不可，否则"零改动"会退化成"没人管"）**

| # | 配套 | 具体要求 |
| --- | --- | --- |
| 1 | **`android-app/ARCHIVED.md`（必须写明交接清单）** | 内容至少含：① 本工程仍使用 `TickBar` 旧名，**这是归档状态、不是遗漏**；② **若重新启用，须先执行改名清单**（可执行、但现在不执行——这是交接，不是动手）：`app_name` → `Timing`；`namespace` / `applicationId` → `com.timing.droid`；`Theme.TickBar` → **`Theme.Timing`（保持大写 T）** 且 `AndroidManifest.xml` 的 `@style/` 同步；Kotlin 包路径 `/com/tickbar/droid/` → `/com/timing/droid/` 与 `java/com/tickbar/` 目录搬迁（`package` / `import` 全量替换）；`core/Prefs.kt` 的 SP 名与 `core/Db.kt` 的库名；③ 版本从 `9 / 0.3.6` 起算，不许直接跳到 0.5.0 造成"看起来比主线旧"的错觉 |
| 2 | **`brand-gate`（T05.9 / P2-3）显式白名单 + 必须打印跳过数** | 把 `android-app/**` 列入白名单，且脚本输出**必须包含「已跳过归档目录 N 处」**（N 为实际命中数）。**不许静默跳过**——静默跳过等于自欺，将来没人知道这里有残留，也没人知道白名单在替谁挡枪 |
| 3 | **版本冻结断言不变** | `archived-versions.json` 仍记录 `9 / 0.3.6`，`check:version` 做相等断言。注意它与"零改动"是两道独立的锁：前者锁版本号，后者锁**整个目录不得出现 diff** |

> **给 review 的一句话判定法**：如果 PR 里出现任何 `android-app/**` 的 diff（除新增 `ARCHIVED.md` 外），**直接打回**；如果 `git status` 里 `android-app/` 从未入库，那 P0-2 还没做完（入库 ≠ 改动）。

---

## 6. 优化需求池（P0 / P1 / P2）

> 每条四要素：**问题 — 证据 — 期望结果 — 验收方式**。⚠️ 标记的为本次调研**新发现**（不在上游清单内）。

### P0（改名必须顺带做，否则留下确定性缺陷）

| # | 问题 | 证据 | 期望结果 | 验收 |
| --- | --- | --- | --- | --- |
| P0-1 | `index.html` 有 `[TEMP-DIAG]` 临时诊断脚本，注释自述「定位完即删」，仍会向 `http://127.0.0.1:8787` 发图片打点 | `index.html:36-70`（`<script>` 整块） | 整段删除，`index.html` 只剩防白闪引导脚本 | `git grep -n "8787\|__diagSend\|TEMP-DIAG"` 零命中；页面加载无相关请求 |
| P0-2 ⚠️ | **独立安卓工程 `android-app/` 完全未纳入版本控制**（45 个 `.kt` + gradle 全部 untracked） | `git status` 输出 `?? android-app/`；`.gitignore` 未忽略它 | 入库（`git add android-app`）+ 补 `ARCHIVED.md`，**但内容一个字符都不改**（入库 ≠ 改动，见 §5.7）；确认 `local.properties`/`build/`/`.gradle/` 已在 `android-app/.gitignore` 内 | `git ls-files android-app \| wc -l` > 45；`git status` 无 `?? android-app/`；**`git diff --stat` 里 `android-app/` 只允许出现新增的 `ARCHIVED.md`** |
| P0-3 ⚠️ | **版本门禁不覆盖安卓**：`check:version` 只查桌面 6 处；安卓有多个独立版本源且在漂移 | `android-app/app/build.gradle.kts`（`versionCode 9 / versionName 0.3.6`）vs 桌面 `0.4.1`；`src-tauri/gen/android/app/build.gradle.kts:28-29` 从 `tauri.properties` 读、默认 `"1"/"1.0"` | `check:version` 扩展为「桌面 6 处同值」+「**归档冻结断言**」：新建 `scripts/archived-versions.json` 记录 `android-app` 的冻结值 `9 / 0.3.6`，脚本断言实际值 == 记录值。**不要求归档工程与桌面版本对齐**（它永不发布，追版本号无收益，且会长期红） | ① 把 `android-app` 的 `versionName` 改成 `0.5.0` → `npm run check:version` 必须非零退出并指名该文件；② 桌面 6 处任一不一致 → 退出非零（现状行为保持） |
| P0-4 ⚠️ | `check:version.mjs` 硬编码 crate 名 `name = "tickbar"` 解析 `Cargo.lock` | `scripts/check-version.mjs:8,36,39` | 改为常量/正则从 `Cargo.toml` 读取 crate 名，避免下次改名再断 | 改 crate 名后门禁仍能定位版本段；`npm run check:version` 输出 `0.5.0` |
| P0-5 ⚠️ | **`plugins/md-sync/plugin.json` 提交了作者本机绝对路径**（3 处 `%USERPROFILE%\OneDrive\...\Elio\1-MemeX\Diary`） | `plugins/md-sync/plugin.json:14,21,28` | 改为占位符（如 `%USERPROFILE%\Documents\Timing`）或空字符串 + README 说明；不泄露本机目录结构 | `git grep -n "OneDrive\|1-MemeX"` 零命中；首装插件不因路径不存在而报错 |
| P0-6 ⚠️ | **`src-tauri/gen/android/**/assets/` 提交了 457 KB 陈旧前端产物**（7 个文件，含旧 TickBar 字符串的 `index-Bb77-XgP.js`） | `git ls-files src-tauri/gen/android/app/src/main/assets/` 7 条；`du -sh` = 457K | 加 `.gitignore`（`src-tauri/gen/android/app/src/main/assets/`），`git rm -r --cached` | 仓库不再含 dist 类产物；APK 构建仍能从 `dist/` 取资源 |
| **P0-7** | **迁移可见性缺失**：迁移成功后用户完全无感，数据搬到了新目录却没有任何界面证据；一旦迁移被跳过（M-05）用户更无从发现"我的数据还在旧目录" | 现无任何相关 UI；诊断快照只写文件不留接口 | ① 设置 → 通用页签底部新增「数据迁移状态」卡片：数据来源（已从 TickBar 迁移 `<日期>` / 全新数据 / **旧数据待迁移** / **发现未采用的旧数据** / 开发模式已跳过）、行数摘要、**「打开旧数据目录」按钮**；② 两条 IPC：`get_migration_info` / `open_legacy_dir`（契约见 §1.5）；③ `open_legacy_dir` **必须重算路径**（`app_data_dir.parent()/com.tickbar.app`），**绝不使用 marker 里回传的路径**——否则改一行 JSON 就能让应用打开任意目录 | ① `npm run check:contract` 输出 `67/67/67 · 16/16 · 11/11`；② 四种 `source` 各截图一张（M-01/M-04/M-15/M-05）；③ 手工把 marker 里的 `legacyDir` 改成 `C://Windows`，点按钮仍只打开 `com.tickbar.app` |

### P1（本次一并处理，或明确排期）

| # | 问题 | 证据 | 期望结果 | 验收 |
| --- | --- | --- | --- | --- |
| P1-1 ⚠️ | **11 个文件贴着 300 行上限**（5 个满格 300 + 6 个 ≥290），零余量；改名与迁移一旦在其中加行，`check:size` 立刻红 | 实测清单见下方「**P1-1 附**」（`check:size` 当前 `OK — 扫描 412 个文件`） | **纪律（比清单重要，清单会过期、纪律不会）**：贴顶文件**只允许等长替换或缩短，本轮不得增长**；确实需要增长时，**先抽模块再改**，不允许临时加 allowlist。示例：迁移能力一律落在新建的 `infra/appdata_migrate/` 子模块里，不往 `services/timer.rs` 等满格文件加代码 | ① 改名开始前与结束后各跑一次 `npm run check:size`，两次均 `OK` 且 `size-allowlist.json` 无新增条目；② 对「必须增长」的那个文件（`ipc.ts`），验证它通过先抽后改回到 300 行以下并留有余量 |
| P1-2 ⚠️ | **localStorage 键名分隔符不一致**：4 个用 `.`，1 个用 `:` | `useWindowAutoFit.ts:44` `'tickbar:fit-offset'` vs `appearanceStore.ts:11` 等 `'tickbar.xxx.v1'` | 统一为 `timing.fit-offset`（带 `.v1` 后缀的保持 `timing<域>.v1` 结构） | 全仓 `localStorage` 键名扫描：无 `:` 分隔符 |
| P1-3 ⚠️ | **两套安卓工程并存**，历史上产出过两个不同包名的 APK，用户可同时装两个 App | `release/` 同时存在 `TickBar-android-0.3.6.apk`（独立工程）与 `TickBar-v0.4.1-android-arm64.apk`（Tauri mobile） | **已决**：`src-tauri/gen/android/`（Tauri mobile）为唯一主线；`android-app/` 入库后归档、**代码零改动**、版本冻结（§5.7）；本轮 Release 不发任何 APK | 发布清单（Release 附件）无 `.apk`；`android-app/ARCHIVED.md` 存在且含改名清单；`android-app/**` 除 `ARCHIVED.md` 外零 diff |
| P1-4 ⚠️ | `design-tokens-compat.css` 是 V0.1.0 过渡别名桥（113 行），注释自述部分别名「零消费方」 | `src/styles/design-tokens-compat.css:73`；`src/styles/tokens/04-aliases.css:23` | 用脚本扫描「声明了但无 `var()` 消费方」的别名，逐条删除或标注 ADR 保留理由 | 删后 `npm run build` + 视觉回归（深浅两主题主要面）通过 |
| P1-5 ⚠️ | `console.error` 前缀、测试夹具路径、mock 目录仍是旧品牌，散落 6 处 | `AppErrorBoundary.tsx:38,72`、`PluginsTab.test.tsx:27`、`browserMockPlugins.ts:23`、`md_file_test.rs:59,60` | 全部随 L2 改完并加一条 grep 门禁（可选，见 P2-3） | `npm test` 绿；`git grep -in "tickbar"` 只剩白名单（§2.3） |
| P1-6 | 体积：桌面 `dist` 525 KB（JS 426 KB / CSS 86.5 KB），其中 `index-*.js` 181 KB | `dist/assets/` 实测；`CHANGELOG.md` 记录桌面 CSS 已从 102 → 86.53 kB | 由架构师给一次「体积基线报告」：明确各 chunk 来源与可优化空间，**先测量再决定是否优化** | 产出一份 ≤1 页的基线表（chunk / gzip / 占比 / 可优化性判断），无实际削减承诺 |
| P1-7 ⚠️ | 「目标目录已存在」分支的产品行为已定为「不覆盖 + WARN + 卡片提示」（**不再做「选择数据源」交互**）；剩余动作只是发版前清理本机残留目录 | 本机 `%APPDATA%\com.timing.app` 已存在（2026-11-04 15:20 生成，内含 `timing.db` 81920 B、`diagnostics.txt` 显示 `Timing diagnostics / version 0.1.1`） | 发版前把它**改名**（不删）为 `com.timing.app.manual-test-bak`，再跑 M-01 拿干净基线 | M-01 与 M-05 均按预期通过，不互相污染 |

#### P1-1 附：行数贴顶清单（改名前实测基线）

> 类别：**满格** = 正好 300 行，多一行即红；**贴顶** = ≥290 行，余量 <10 行；**关注** = <290 但本次一定会被改（余量够，但要盯着）。
> 「本轮是否必须增长」是这张表的核心列：**它直接决定这个文件能不能碰**。

| 文件 | 行数 | 类别 | 本轮是否必须增长 | 处置 |
| --- | --- | --- | --- | --- |
| `src/components/menu/GlassMenu.tsx` | 300 | 满格 | 否（只改头注释） | 等长替换 |
| `src/components/todos/TodosPendingRow.test.tsx` | 300 | 满格 | 否 | 等长替换 |
| `src-tauri/src/services/timer.rs` | 300 | 满格 | 否（迁移不落这里） | 等长替换 |
| `src-tauri/src/services/md_sync/mod.rs` | 300 | 满格 | 否 | 等长替换 |
| `src-tauri/src/models/md_sync.rs` | 300 | 满格 | 否 | 等长替换 |
| `src/components/menu/ItemsPrefsMenu.tsx` | 299 | 贴顶 | 否 | 等长替换 |
| `src/components/todos/TodosPanel.tsx` | 298 | 贴顶 | 否 | 等长替换 |
| `src-tauri/src/tests/todo.rs` | 296 | 贴顶 | 否 | 等长替换（`TickBar` 注释） |
| **`src/services/ipc.ts`** | **295** | **贴顶** | **是：必须 +2 条命令的 `invoke` 与对象方法（约 +4 行）** | ⚠️ **与纪律直接冲突的唯一文件**：**先抽 `ipcError.ts`（`IpcError` + `normalizeError`，约 45 行）腾出约 24 行余量，再改**；`errorText()` **必须留在 `ipc.ts`**（`scripts/check-contract.mjs:183` 直接从该文件解析 `case '...'`，搬走会让错误码文案覆盖规则静默失效）；抽完保留 `export { IpcError } from './ipcError'`，使 5 个既有 import 点零改动 |
| `src-tauri/src/services/plugin.rs` | 295 | 贴顶 | 否（`open_dir` 抽走后由 `plugin_fs` 委托，本文件只等长替换） | 等长替换；若需增长先抽模块 |
| `src-tauri/src/tests/md_sync_edges.rs` | 292 | 贴顶 | 否 | 等长替换（**架构文档 N2 漏列本文件，以本表为准**） |
| `src/hooks/useWindowAutoFit.ts` | 262 | 关注 | 是：localStorage 双读兼容约 +8 行 | 允许增长，但**必须 ≤280**（留 20 行余量）；超出即先把键名常量抽到 `lib/storageKeys.ts` |
| `src/types/domain/ipc.ts` | 196 | 关注 | 是：`IpcApi` +2 个方法（约 +4 行） | 余量充足，直接改 |
| `src/components/settings/GeneralTab.tsx` | 145 | 关注 | 是：挂载「数据迁移状态」卡片（约 +2 行） | 余量充足，直接改 |
| `src-tauri/src/lib.rs` | 155 | 关注 | 是：preboot 调用 + 2 条命令注册（约 +8 行） | 余量充足，直接改 |
| `src-tauri/src/app/bootstrap.rs` | 113 | 关注 | 是：迁移结果补记日志（约 +12 行） | 余量充足，直接改 |

> 结论两条：① **满格 5 + 贴顶 6 全部只做等长替换**，唯一例外是 `ipc.ts`，它必须先抽后改；② 需要真正增长的文件（`useWindowAutoFit` / `types/domain/ipc.ts` / `GeneralTab` / `lib.rs` / `bootstrap`）全部 **<270 行**，有足够余量——**这正是「把能力放进新文件与新模块」的收益**，而不是靠豁免。

### P2（可做可不做，记录在案）

| # | 问题 | 证据 | 期望结果 | 验收 |
| --- | --- | --- | --- | --- |
| P2-1 | `vite.config.ts` 插件名 `'tickbar:platform-css'` 属内部标识，改名顺手统一 | `vite.config.ts:23` | `'timing:platform-css'` | 无行为变化（仅日志可读性） |
| P2-2 | `gen/android` 由 `tauri android init` 生成却整体入库，与「生成物不入库」惯例冲突 | `git ls-files src-tauri/gen/android` 多条 | 明确口径：保留工程骨架（便于无 Android Studio 环境构建），但排除 `assets/`、`build/` | 仓库内无构建产物 |
| P2-3 | 品牌残留可能再次混入 | 本次改名涉及 ~290 文件 | 加一条轻量 grep 门禁 `check:brand`：**一律用 `git grep -in`（大小写不敏感）**，命中集合必须等于白名单；`android-app/**` 在白名单内但**必须打印「已跳过归档目录 N 处」**（不许静默跳过） | ① 人为塞一处 `tickbar` 到 `src/` → 门禁红；② 输出里能看到跳过计数 N > 0 |
| P2-4 | 图标记号仍叫 TickBar 品牌图标 | `docs/design/BRAND-ICON.md` | 文档改名 + 说明「记号不变，名称归位」（视觉无意变更） | 文档评审通过 |

### 功能与体验优化（已拍板收敛）

| 方向 | 结论 | 落点 |
| --- | --- | --- |
| 迁移可见性 | **本轮做**（唯一的功能体验项） | P0-7：设置→通用「数据迁移状态」卡片 + `get_migration_info` / `open_legacy_dir` |
| 改名后的品牌引导 | **本轮不做**：桌面静默（成功迁移本就无感）、安卓只在 release notes 里说明，**不加首启弹窗** | — |
| 其余功能体验（主条交互 / 事项窗 / 记录视图 / 同步） | **本轮不做**，且无需求输入——不臆造。用户若后续提出，另开一轮需求 | — |

---

## 7. GitHub 侧交付

### 7.1 仓库 About（可直接粘贴）

- **Description（中文一句）**
  `Windows / Android 常驻悬浮计时条：按一下就开始记录，纯本地 SQLite。Tauri 2 + Rust + React（原 TickBar）。`
- **Description（英文备选）**
  `An always-on-top floating timer bar for Windows & Android — one click to start, fully local, built with Tauri 2 + Rust + React. Formerly TickBar.`
- **Website**：留空（无落地页，别填仓库自身）
- **Topics**：`tauri` `rust` `react` `sqlite` `time-tracker` `timer` `productivity` `windows` `android` `desktop-app`

### 7.2 tag / release 命名口径

| 项 | 口径 | 示例 |
| --- | --- | --- |
| 仓库名 | 已是 `Timing_Rust`，**不改** | `https://github.com/BigDog2712/Timing_Rust` |
| tag 格式 | `v<MAJOR>.<MINOR>.<PATCH>`，与 `package.json version` 完全一致 | `v0.5.0` |
| 首个 tag | `v0.5.0`（仓库当前 0 个 tag，这就是首个） | — |
| Release 标题 | `<显示名> v<版本> — <一句话主题>` | `Timing v0.5.0 — 品牌更名为 Timing（老数据自动迁移）` |
| 产物命名 | `Timing-v0.5.0-windows-x64-setup.exe`（NSIS）、`Timing-v0.5.0-windows-x64.msi`；**本轮无安卓产物**（§5.5）。若 `tauri build` 因缺 WiX/NSIS 失败，退化为「仅绿色单文件 `Timing.exe`」并在正文写明——**不写做不到的事** | 与 `归档说明.md §8` 的产物口径一致 |
| 是否 pre-release | **正式 release**（已决；内部先跑完 M 系列 smoke） | — |
| 附件 | 实际构建成功的 Windows 产物 + `SHA256SUMS.txt`（**不得出现 `.apk`**） | — |

### 7.3 Release 说明要点（结构）

1. **一句话**：产品名由 TickBar 变更为 Timing；这是品牌归位，数据格式与业务语义零变化。
2. **Windows 用户**：升级即用，**全部数据自动迁移**（记录 / 待办 / 便利贴 / 主题 / 窗口位置 / 插件），旧数据目录保留在 `%APPDATA%\com.tickbar.app` 可手动删除。
3. **安卓用户**：**本轮无安卓产物**（本机缺 Android SDK/NDK，未构建、未验证），包名变更与卸载重装的完整代价先读 §5（提示文案见 §5.4），等下一版。
4. **接口口径（必须逐字用这一句，不能抄 v1 的"零变化"）**：**命令 65 → 67**（新增 `get_migration_info` / `open_legacy_dir`，用于设置页显示数据来源与打开旧数据目录）；**事件 11 / 错误码 16 / DB schema v4 全部不变**。
5. **变更明细**：L1 品牌层（显示名 / 安装产物名 / 窗口标题 / 托盘）/ L2 标识符（identifier `com.tickbar.app` → `com.timing.app`、DB `tickbar.db` → `timing.db`、日志名、`TICKBAR_LOG` → `TIMING_LOG`、5 个 localStorage 键）。
6. **已知代价**：旧 TickBar 与 Timing 可并存（Windows 安装目录不同），建议先卸载旧版；安卓需卸载重装（本轮不涉及）。
7. **校验和**：`SHA256SUMS.txt` 附件 + 正文列各产物 sha256 前 8 位。
8. **回滚**：如遇问题，卸载 Timing 装回 TickBar 0.4.1，数据仍在老目录（§8.1 L3）。
9. 末行：`Full Changelog: v0.5.0`（首次 release 无上一 tag，写 `首个发布`）。

---

## 8. 风险与回滚

| # | 风险 | 触发条件 | 影响 | 预防 | 回滚/处置 |
| --- | --- | --- | --- | --- | --- |
| R1 | **迁移失败**（复制中断 / 磁盘满 / 权限 / WAL 占用） | 见 §4.5 M-06/M-07 | 用户以为在跑新版本，实则数据没过来 | 临时目录 + rename 原子化；`-wal`/`-shm` 一并复制；三重校验（size / integrity_check / 行数） | 失败即弹窗 + 不进入空库（§4.4）；老目录完好，可重试迁移 |
| R2 ⚠️ | **老用户升级后看不到数据（真实可复现场景）** | 新目录 `com.timing.app` **已存在**（本机就是：内含 0.1.1 时代 `timing.db`）→ 迁移被跳过 → 用户看到的是旧/空数据 | 最严重的信任损伤：用户认为"数据没了" | §4.1 入口（3）+ WARN + 诊断 + **设置页卡片「发现未采用的旧数据」**（P0-7 让这条从"静默"变"可见"）；QA 必测 M-05；发版前把本机残留目录改名备份后重测 M-01 | 卡片给「打开旧数据目录」；手工把老库复制进新目录（覆盖前先备份） |
| R2b | **只拷主库漏 `-wal`** | 老库 WAL 有未 checkpoint 数据 | 丢失最后一段记录（最坏是在跑的那个会话） | 迁移代码显式包含 `-wal`/`-shm`；M-08 用例 | 从老目录重新迁移（老目录未动） |
| R3 | **identifier 与安卓包名不同步导致双端不一致** | 桌面与安卓主线都改 `com.timing.app`，但**归档件 `android-app/` 故意保留 `com.tickbar.droid`**；若有人"顺手统一"就会同时撞碎归档件与 `Theme.*` 引用 | ① QA 把归档残留当漏改上报；② 顺手改名导致归档件重新启用时编译失败；③ 未来跨端同步时 device 身份口径混乱 | §2.1 一处定义、§5.7 一处豁免；`git grep -in` 大小写不敏感；P1-3 收敛单一主线 | 按 §2.1 表逐项对账；`android-app/**` 除 `ARCHIVED.md` 外出现 diff 即打回 |
| R4 ⚠️ | **开机自启残留** | 旧 `Run\TickBar` 指向已被卸载的旧 exe；且 `auto-launch` 还会写 `Explorer\StartupApproved\Run\<name>`（任务管理器启动项开关），**只删 `Run` 会留下永远的 TickBar 条目** | 每次登录静默失败；用户以为自启坏了；启动项列表里有僵尸条目 | L2-18：迁移后**双键清理**（`Run` + `StartupApproved`）、按原设置重挂 `Timing`；实现只用进程内 `windows-registry` API | **本机安全策略拦截 `reg.exe`，注册表状态无法脚本化验收** → 验收方式改为：设置页开关状态 + 后端日志中的自启行 + 人工 `regedit` /「设置 → 应用 → 启动」目视。**禁止**把注册表断言写进 `scripts/*` 或 `cargo test`（会稳定红） |
| R5 | **新旧版本并存（Windows）** | 用户未卸载 TickBar 直装 Timing | 安装目录不同（`%LOCALAPPDATA%\TickBar` vs `...\Timing`），托盘出现两个图标、单实例插件互不知情（identifier 不同）→ 可能双开计时 | release notes 明确"建议先卸载旧版"；安装包不做强制检测 | 卸载旧版即可；数据在各自目录，互不破坏 |
| R6 ⚠️ | **开发期误伤真实数据** | `tauri dev` 与正式版共用同一 identifier → 迁移逻辑一落地，第一次 `npm run tauri dev` 就会动真实 `%APPDATA%` | 开发者的真实数据被搬走/改名，事后难以分辨 | **机制化（已决）**：① **debug 构建默认跳过迁移**，需显式 `TIMING_FORCE_MIGRATE=1` 才执行；② `TIMING_SKIP_MIGRATE=1` 作显式跳过开关；③ `scripts/dev-desktop.cmd` 也带上；**release 行为零变化**。靠机制不靠记性 | 从老目录恢复（迁移是复制，源永远在） |
| R7 | **门禁静默失效（最隐蔽）** | `check-layers.mjs` L7 正则硬编码 `__TICKBAR_MOBILE__`；若只改 `platform.ts`/`vite.config.ts` 不改脚本，规则扫描一个不存在的符号 | 门禁**绿着**，但 L7 保护彻底消失；后续有人从组件里引 `@tauri-apps` 相关平台常量不再被拦 | L2-6 同批必改脚本；加分项 P2-3 grep 门禁 | 改完人工看 `check:layers` 是否仍报「7 条规则」且能对故意注入的违规报警 |
| R8 | **回滚不可用（数据结构未变但产品名变）** | 用户升级 0.5.0 后想退回 0.4.1 | 若 0.5.0 曾 **move** 老目录，回滚必失败 | §4.3：只复制不移动；老目录保留至少 1 个版本周期 | 卸 0.5.0 → 装 0.4.1 → 数据在老目录（M-12 用例守卫） |
| R9 | **文档/链接失效** | README、issue、用户笔记里的 `%APPDATA%\com.tickbar.app\plugins` 路径 | 用户按旧文档装插件"装了不生效" | §3.3.2 同步改 README/plugin README；release notes 给新路径 | 文档不改回，仅补"（0.4.x 及更早为 com.tickbar.app）" |
| R10 | **`check:version` 断链** | crate 名改了但脚本硬编码 `tickbar` | 门禁红（可见）或解析为空 | P0-4 改成从 `Cargo.toml` 读 crate 名 | 一次性修复，不改回 |
| **R11** ⚠️ | **空白启动把迁移永久锁死**（v1 的逻辑漏洞） | 用户在失败对话框选「以空白数据启动」→ 空白会话在新目录建出 `timing.db` → §4.1 入口（1）条件 2 永久为假 → 老数据再也不会被迁移，**且用户收不到任何提示** | 用户以为自己选了"稍后再试"，实际是"永远不再试"；最终发现时已过了好几个版本 | §4.1 入口（2）覆盖式迁移 + `pending-migrate.json` + 设置页卡片常驻「旧数据待迁移」；M-15/M-16/M-17 守卫 | 卡片提供「现在迁移」手动入口；留档目录（`premigrate-*`）永不删除 |
| **R12** ⚠️ | **契约口径在四处文档里不一致** | Release 正文、`IPC-CONTRACT-v2.md`、`CHANGELOG`、PRD 都在描述命令数；任何一处漏改（例如正文仍写"命令 65 不变"） | 用户/后续维护者按错误口径理解兼容性，等于给自己埋一次"以为没事"的升级 | 口径只有一句（§1.5 末段），四处逐字复用；`check:contract` 输出 `67/67/67 · 16/16 · 11/11` 作为唯一机器证据 | Release 正文人工 checklist 第 4 段核对（§7.3） |

### 8.1 回滚预案（分级）

| 级别 | 场景 | 动作 |
| --- | --- | --- |
| L1（发版前） | 迁移用例任一红 | 不回滚代码，修迁移；发布阻塞 |
| L2（发出后 24h 内） | 出现"看不到数据"报告 | 撤回 release 标记为 pre-release；发 0.5.1 修迁移；**不要求用户回滚**（老目录还在，可在 0.5.1 里补做迁移） |
| L3（结构性问题） | 迁移逻辑本身不可靠 | 指导用户：卸载 0.5.0 → 装 0.4.1（数据在老目录，M-12 保证）→ 等 0.5.x 修复版 |
| L0（代码回滚） | 需要 revert | 三个 commit（L1/L2/L3）分提交，`git revert` L2 即可回到可用的 0.4.x 行为；注意 identifier 回退会导致新目录被弃用（数据在新目录 → 需手工搬回，故 L0 是最后手段） |

---

## 9. 建议执行批次（给架构师排期用）

| 批次 | 内容 | 依赖 | 门禁 |
| --- | --- | --- | --- |
| B0 | 清理前置：P0-1 删 TEMP-DIAG；P0-2 安卓入库；P0-5 插件路径脱敏；P0-6 产物出库 | 无 | `npm run check` + `npm test` |
| B1 | L2 标识符 + 迁移内核（`infra/appdata_migrate/` 6 个子模块、`app/preboot.rs`、`app/autostart_takeover.rs`、`commands/migration_cmd.rs`、`models/migration.rs`）+ 2 条 IPC 四处对齐 + 迁移可见性卡片；同批改 L2-6 门禁脚本 | B0 | `check:layers` / `check:size` / `check:version`（改后）+ `check:contract` 输出 67 + 迁移用例 M-01..M-18 |
| B2 | L1 品牌层（配置、crate、**安卓主线** `gen/android` 包名与目录搬迁、产物命名）；**`android-app/` 只入库 + 补 `ARCHIVED.md`，代码零改动** | B1（identifier 与迁移先后不可颠倒） | `cargo build` 成功、`check:version` 0.5.0、桌面实机启动、`android-app/**` 无 diff（除 `ARCHIVED.md`） |
| B3 | L3 注释与文档 + `ADR-036` + `CHANGELOG` 追加 | B2 | `git grep -in tickbar` 命中 = §2.3 白名单 |
| B4 | 发布：tag `v0.5.0` + Release + About 描述 | B3 + 全部用例绿 | 人工 checklist |

> **顺序不可变**：先有迁移（B1）再换 identifier（B2）。反过来会先让用户数据"消失"，再靠补丁救。
>
> **本表只给批次与门禁，逐文件步骤见 `ARCHITECTURE.md §5`（T01–T05）**：B0→T01、B1→T02+T03、B2→T04、B3+B4→T05。两者冲突时以 ARCHITECTURE 的文件级步骤为准，需求口径以本 PRD 为准。

---

## 10. 决策表（v1 待确认项 → 已决）

> v1 的 8 条待确认，v2 已收敛其中 7 条：**所有「已决」项不再需要拍板**。剩下两条的性质变了——#2 是一个**执行期动作**（发版前把本机残留目录改名，一句话即可），#7 维持 v1 建议（不动图形），不需要额外决策。

| # | 事项 | 结论 | 落点 |
| --- | --- | --- | --- |
| 1 | 老目录 `%APPDATA%\com.tickbar.app` 保留多久 | **已决：永久保留，不自动删除**（它是回滚通道，也是 M-12 的唯一物理依据）；设置页给「打开旧数据目录」，清理交给用户 | §4.3、R8 |
| 2 ⚠️ | 本机 `%APPDATA%\com.timing.app` 已存在（2026-11-04 15:20 创建，含 81920 B `timing.db`、`diagnostics.txt` 写着 `Timing diagnostics / version 0.1.1`） | **已决：改名（不删）为 `com.timing.app.manual-test-bak`** —— 它可能是某人唯一的数据副本，删除风险高于收益。**执行期事项，需主理人动手一次** | P1-7、R2 |
| 3 | 是否本次就 tag + release | **已决：做完整 Release**——About + Topics + `tag v0.5.0` + Release 正文 + `SHA256SUMS.txt`；**但不含安卓产物**（§5.5） | §7 |
| 4 ⚠️ | 两套安卓工程哪套是主线 | **已决：`src-tauri/gen/android/`（Tauri 移动端，包名 `com.timing.app`）为唯一主线**；`android-app/` 入库后归档，**代码零改动**（含 `app_name` / `com.tickbar.droid` / `Theme.TickBar` / 45 个 kt 包路径），版本冻结 `9 / 0.3.6` | §5.7、§5.5、P1-3 |
| 5 | 「功能与体验」想改什么 | **已决：本轮只做「迁移可见性」一件事**（P0-7），其余不做、不臆造 | §6 末 |
| 6 | 是否在设置里展示数据来源 + 打开旧数据目录 | **已决：做**，且升为 P0-7（不再是"可选"） | P0-7 |
| 7 | 品牌视觉是否跟着动 | **未决（沿用 v1 建议）**：不动图形，只改文档措辞——`BRAND-ICON.md` 已把形状与名称解耦，换图形属于另一次视觉改版 | §2.3、P2-4 |
| 8 | 安卓「必须卸载重装」这个代价是否接受 | **已决：接受，且本轮不发安卓**（无构建环境），延到有 SDK/NDK 的环境单独发一版 | §5.5 |
| **9（v2 新增）** | debug 构建是否会误搬真实数据 | **已决：debug 默认跳过迁移**，需 `TIMING_FORCE_MIGRATE=1` 才执行；release 行为不变 | §4.1 条件 4、R6 |
| **10（v2 新增）** | 空白启动后老数据怎么办 | **已决：写 `pending-migrate.json`，下次启动走覆盖式迁移**（原目录改名留档，不删除） | §4.1 入口（2）、§4.3、M-15..M-17 |
| **11（v2 新增）** | IPC 命令数 65 → 67 是否接受 | **已决：接受**（§1.5 的两条否决依据；替代方案是"不做迁移可见性"，那要推翻 P0-7） | §1.5、ADR-037 |

---

## 附：本次调研新增发现汇总（相对上游任务清单）

1. **`infra/window_spec.rs` 有 4 个用户可见窗口标题**（`TickBar 设置/计时器/事项/便利贴`）—— 出现在任务栏与 Alt-Tab，上游清单未列。
2. **`src-tauri/gen/android/` 是第二套（Tauri 移动端）安卓工程且已入库**，含 `com.tickbar.app` 包名、`<style name="Theme.tickbar">`（**小写 t**）、`app_name`、`MainActivity.kt` 目录，以及 457 KB 被提交的前端产物。**v2 起它被定为唯一安卓主线**（原以为 `android-app/` 是主线）。**两个工程主题名大小写相反**（主线小写 `Theme.tickbar` / 归档大写 `Theme.TickBar`），均以各自文件为准。
3. **独立安卓工程 `android-app/` 完全未入库**（`git status` 显示 `?? android-app/`）—— 改名会改一批仓库里不存在的文件。**v3 口径：先入库，再归档，代码零改动、版本冻结**（只新增 `ARCHIVED.md`）。
4. **安卓版本号多源漂移**：`android-app` 是 `versionCode 9 / 0.3.6`（v2 起冻结），`gen/android` 从 `tauri.properties` 默认 `1 / 1.0`，桌面是 `0.4.1`；`check:version` 只管桌面 6 处。
5. **`check-version.mjs` 硬编码 crate 名** `name = "tickbar"`（3 处），第 4 次改名会再断一次。
6. **`check-layers.mjs` L7 正则硬编码 `__TICKBAR_MOBILE__`**：不同批改则门禁"绿着但失效"（最隐蔽的一类回归）。
7. **localStorage 键有 5 个不是 2 个**（`theme` / `appearance.v1` / `countdownArm.v1` / `countdownDuration.v1` / `fit-offset`），且 `fit-offset` 用了冒号分隔符，与其余不一致。
8. **`index.html` 的 `[TEMP-DIAG]` 与 CSP 冲突**：`tauri.conf.json` 的 CSP 是 `default-src 'self'`，向 `http://127.0.0.1:8787` 发 `<img>` 会被拦，说明这段"诊断"其实长期不生效 —— 删除是**零风险**，且能顺带消掉一批 CSP 违规噪声。
9. **本机已存在 `%APPDATA%\com.timing.app`**（`timing.db` 81920 B、`Timing diagnostics / version 0.1.1`），说明此前有人手工试跑过改名；这让「目标目录已存在」从理论边界变成**本机必踩**的分支，也让 M-01 与 M-05 的区分成为验收关键。
10. **`plugins/md-sync/plugin.json` 提交了作者本机绝对路径**（3 处 `OneDrive\...\1-MemeX\Diary`）。
11. **11 个文件贴着 300 行上限**：5 个满格 300（`GlassMenu.tsx` / `TodosPendingRow.test.tsx` / `services/timer.rs` / `md_sync/mod.rs` / `models/md_sync.rs`）+ 6 个 ≥290（`ItemsPrefsMenu.tsx` 299 / `TodosPanel.tsx` 298 / `tests/todo.rs` 296 / **`ipc.ts` 295** / `services/plugin.rs` 295 / `tests/md_sync_edges.rs` 292），零余量。其中 **`ipc.ts` 是唯一「本轮必须增长」的贴顶文件**（要加 2 条命令），必须先抽 `ipcError.ts` 再改——详见 §6 P1-1 附。
12. **WAL 迁移细节**：只拷 `tickbar.db` 会丢未 checkpoint 的事务，必须连 `-wal`/`-shm` 一起复制 —— 这是"看起来迁移成功、实际少了最后一段记录"的典型成因。
13. **`tauri dev` 与正式版共用 identifier**：迁移逻辑一落地，第一次 `tauri dev` 就会动真实数据 → v2 已定为「debug 构建默认跳过迁移，需 `TIMING_FORCE_MIGRATE=1` 才执行」，另保留 `TIMING_SKIP_MIGRATE=1` 显式跳过。
14. **`docs/mobile/DESIGN-ANDROID-V1.md:260` 有一条 QA 断言硬编码 `"identifier":"com.tickbar.app"`**，不改会让新版 APK 验收假失败。
15. **产品叙事依据**：`docs/timing-1.7.3-parity.md` + `docs/design/TIMING-DELTA-AUDIT.md` 证明 TickBar 是 Timing v1.7.x（C#/GDI）的 Rust 重写 —— 改名是"代号回归产品名"，不是起新名。
16. **两个安卓工程的主题名大小写相反且都正确**：`gen/android` = `Theme.tickbar`（小写，`values/`+`values-night/`+Manifest 三处一致）、`android-app` = `Theme.TickBar`（大写，`values/`+Manifest 两处一致）。v2 曾误判为"笔误"并要求统一，v3 已撤回——**并列存在不是不一致**，任何"统一大小写"的动作都会撞碎其中一个；配套纪律：品牌残留校验一律 `git grep -in`。
