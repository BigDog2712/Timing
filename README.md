# TickBar v0.1.1

[![CI](https://github.com/BigDog2712/timing/actions/workflows/ci.yml/badge.svg)](https://github.com/BigDog2712/timing/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/BigDog2712/timing?label=release)](https://github.com/BigDog2712/timing/releases)

Windows 桌面常驻悬浮计时条 + 安卓悬浮计时器：屏幕边缘一条 32px 的小药丸，按一下就开计时，不占工作区。
纯本地（SQLite），无账号、无联网。

- **桌面**：Tauri 2 + React 19 + TypeScript + Rust
- **安卓**：原生 Kotlin（`android-app/`，系统级悬浮窗 + 前台服务）

## 装哪个包

下载入口：**[Releases · v0.1.1](https://github.com/BigDog2712/timing/releases/tag/v0.1.1)**

| 平台 | 产物 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | [`TickBar-0.1.1-portable.exe`](https://github.com/BigDog2712/timing/releases/download/v0.1.1/TickBar-0.1.1-portable.exe) | 绿色版：双击即用，不写注册表。**当前唯一可下载的包** |
| Windows 10/11 x64 | `TickBar_0.1.1_x64-setup.exe` | NSIS 安装器：可选安装目录、开始菜单 / 桌面快捷方式、卸载项。未出包 |
| Android 8.0+ | `TickBar-android-0.1.1.apk` | 原生 Kotlin 版：悬浮条 + 前台服务 + Obsidian 同步。未出包 |

> **0.1.1 现状**：绿色版已产出并上传 Release（6.16 MB，日志有 `boot[first_frame]`）。
> 安装器与安卓包还没出——本机拉不到 NSIS 工具链（`tauri build --bundles nsis` 下载 502），
> 也没有 Android SDK / JDK。出包后按上表命名并补传到同一个 Release 即可。

> 安装包按用户装到 `%LOCALAPPDATA%\Programs\TickBar`，免管理员；**卸载只删程序，`%APPDATA%\com.tickbar.app` 里的数据保留**。
> 插件目录在程序目录里（`<exe 同级>\plugins`），卸载会连它一起删掉——自己写的插件请先备份。
> WebView2 只检测不内嵌：缺失时安装器会提示，Win11 与已更新的 Win10 自带。
> 安卓包用 debug keystore 签名，**能装能跑，不可上架**（正式分发请自备 keystore，见 `docs/mobile/`）。
> 需要 MSI 时在能访问 GitHub 的机器上跑 `npm run tauri build`；本仓库额外提供
> `scripts/build-installer.cmd`（本地 NSIS 出安装包，无需联网下载工具链）。
> 安卓端**只有原生 Kotlin 版一套**（`android-app/`）。同源的 Tauri WebView 壳包不再出：它拿不到
> 系统级悬浮窗、进后台会被冻结，作为手机端产品是退化的，只保留工程备用。

## 双端是什么关系

两套代码共享**同一份数据契约**（SQLite 表结构同构 + Obsidian Markdown 日记区块三方向合并），但实现独立：

| | 桌面（`src/` + `src-tauri/`） | 安卓（`android-app/`，原生） |
| --- | --- | --- |
| 形态 | 无边框透明小窗 + Win32 托盘菜单 | 系统级悬浮窗（`TYPE_APPLICATION_OVERLAY`）+ 常驻通知 |
| 计时 | Rust 侧单调时钟，15s 轮询落库 | Kotlin `TimerCore` + 前台服务 |
| 记录 / 待办 | 日 / 周视图、软删除、撤销、内联编辑 | 页签式：计时 / 待办 / 记录 / 设置 |
| 便利贴 / 插件 | 有（多窗 + 声明式插件） | 无（系统窗口模型不同） |
| Markdown 同步 | md-sync 插件，路径落点 | SAF 选目录，双向合并 |

`src-tauri/gen/android` 是 Tauri 官方安卓壳工程（WebView 方案），**不随版发布**：手机端只有
`android-app/` 一套，桌面能力在手机上要靠原生实现补齐，WebView 壳做不到悬浮层与后台常驻。
该目录保留原因：将来若要在移动端复用桌面 UI（例如大屏平板上的只读视图），它是现成起点；
确认不需要可直接删，不影响任何构建与发布流程。

## 桌面能做什么

| 能力 | 说明 |
|---|---|
| 小条 | 状态环（16×16 小米式圆角方形）+ 20px 计时数字 + 事项名；未悬停时只留内容、隐藏背板，悬停恢复药丸玻璃 |
| 正计时 / 倒计时 | 倒计时剩余 ≤60s 转 `#E5484D` 并 1s 闪烁（低于 WCAG 2.3.1 光敏阈值）；到点恒结束并保存 |
| 待办 / 记录 | 日 / 周视图、软删除、撤销条（3s）、内联编辑；低于「最短记录时长」（默认 30 秒，可调 5–300）的计时自动忽略 |
| 便利贴 | `note-{id}` 独立多窗，320×232 默认、160×120–900×900 硬钳，几何 300ms 防抖落盘，上限 20 |
| 提醒铃 | 15s 查询式调度（`remind_at <= now AND reminded_at IS NULL`），抗休眠补偿，±60s 聚合、`reminded_at` 去重 |
| 摸鱼菜单 | 暂停态右键数字 / 左键事项名唤出：一键「换个事项 + 定长」开倒计时；「其他事项」打完名字用滚轮定长 |
| 插件 | `<exe 同级>/plugins/<id>/plugin.json` 是启动头，宿主只读不执行（声明式）；v1 贡献摸鱼菜单预设，v3 新增声明式面板 `panels`（数据块 + 白名单动作） |
| Markdown 同步 | 设置 → 同步：落点根目录 / 文件模板 / 标题可改；SQL 与 Markdown 任一侧改动 2 秒内对齐；冲突最后写入者胜 |
| 主题 | 深 / 浅 / 跟随系统 + 四色自定义（计时中 / 提醒 / 完成 / 小条底色），跨窗广播 |
| 系统集成 | 原生 Win32 托盘菜单、开机自启、单实例、窗口位置记忆；主窗与所有浮层窗口恒定置顶 |

## 运行平台（先说清楚边界）

**桌面只支持 Windows 10 / 11（x64）。** 这不是「暂时没测」，而是当前实现里有 Windows 专属能力：

| 能力 | 实现 | 跨平台可行性 |
| --- | --- | --- |
| 托盘菜单 | 原生 Win32 菜单（`src-tauri/src/infra/tray_menu.rs`） | 需按平台重写（macOS 用 `NSStatusItem`，Linux 依赖 `libayatana`） |
| 窗口点击穿透 | 用「把 OS 窗口收缩到内容包围盒」替代原生 layered window（ADR-014） | 思路可移植，但 `setSize/setPosition` 的合成器行为各平台不同 |
| 透明无边框小窗 | Tauri `transparent` + `skipTaskbar` + `alwaysOnTop` | Windows/macOS 可行；Linux 需合成器支持 |
| 开机自启 | `tauri-plugin-autostart`（注册表 `Run`） | 插件本身支持多平台，但 Linux 需 `~/.config/autostart` 写法验证 |
| 通知 | `tauri-plugin-notification`（WinRT Toast） | 插件支持多平台 |

macOS / Linux 版本是一个独立的移植项目（托盘、几何钳制、DPI、窗口合成器四条线都要重做），不是加个 CI matrix 的事。

## 技术栈

- 前端：React 19.3 · TypeScript 5.9 · Zustand 5 · Vite 8（rolldown 内核）· lucide-react
- 桌面壳：Tauri 2.12.4（`transparent` + `skipTaskbar` + `alwaysOnTop` 无边框小窗）
- 后端：Rust 1.90+ · sqlx 0.8（SQLite，WAL）· tauri-plugin-autostart / window-state / single-instance / notification / dialog（仅目录选择）
  （v0.3 起**移除** `plugin-sql` / `plugin-store`：前端从未引用，但 capability 曾放行，等于给前端留了一条绕过四层的直连数据库通道，见 ADR-015）
- 数据：`migrations/0001_init.sql`（v1）+ `0002_v020.sql`（v2）+ `0003_v030.sql`（v3）+ `0004_v0312.sql`（v4），`settings.schema.version` 记迁移版本
- 安卓：Kotlin 2.x · Gradle 8/9 · minSdk 26 / targetSdk 35 · 零运行时依赖（不引 AndroidX / Compose）

## 目录

```
.
├── index.html              # 唯一入口（多窗口共用同一前端 bundle，按 label 分流）
├── src/                    # React 前端（桌面 + Tauri 移动端共用）
│   ├── components/         # pill / panel / menu / todos / note / records / reminder / settings / mobile / ui
│   ├── stores/             # zustand：timer / todo / note / item / plugin / theme / settings / ui / mobileUi
│   ├── services/           # ipc 封装 + 各域 action + api.ts 领域门面
│   ├── hooks/  lib/  types/  styles/
│   ├── styles/tokens/      # 设计令牌实体（design-tokens.css 是索引，@import 顺序不可调换）
│   └── mocks/              # 浏览器降级 mock（无 Tauri 环境下 `npm run dev` 可跑）
├── src-tauri/              # Rust 后端（依赖只能向下，见 ADR-016）
│   ├── src/platform/       # 叶子层：clock（单调时钟）/ log / boot_timing / host / duration
│   ├── src/infra/          # 平台适配：窗口 / 托盘菜单 / 通知 / 几何 / 迁移
│   ├── src/services/       # 业务：计时 / 事项 / 待办 / 便利贴 / 设置 / 主题 / md 同步
│   ├── src/app/            # 装配：events / tray / bootstrap / diagnostics
│   ├── src/jobs/           # 调度：monitor / flusher / reminder / countdown / restore_notes
│   ├── src/commands/  src/repositories/  src/models/  src/tests/
│   ├── capabilities/       # Tauri 2 权限放行清单（只留实际用到的窗口/事件/自启/目录选择）
│   ├── gen/android/        # Tauri 官方安卓壳工程（保留备用，不随版发布，可删）
│   └── tauri.conf.json
├── android-app/            # 原生 Kotlin 安卓端（悬浮条 / 前台服务 / SQLite / Obsidian 同步）
├── scripts/                # dev-desktop.cmd / build-release.cmd + 五道机械门禁
├── plugins/                # 插件：一文件夹一插件，内含启动头 plugin.json（规格见 docs/plugin-spec.md）
│   └── md-sync/            # 首个 v2 插件：计时 / 便利贴 ↔ Markdown 双向同步
├── tests/fixtures/         # 双端黄金用例（timer-formula.json，Rust 与 TS 共用）
├── preview/pill-preview.html   # 小条静态预览（设计对照用，不参与构建）
├── docs/                   # 契约正本 / ADR / 设计 / 移动端 / 同步 / 归档
└── release/                # 构建产物落点（不入库，见 .gitignore）
```

## 开发

```bash
npm install
npm run dev              # 前端单独跑（浏览器 mock 模式，端口 1420）
scripts\dev-desktop.cmd  # 完整桌面应用（自动 vcvars64 后 tauri dev，双击或命令行均可）
npm run check            # 全部门禁：typecheck + contract + size + version + layers + lint
npm test                 # vitest（含双端时间公式黄金用例）
npm run build            # tsc + vite build
```

Windows 上跑桌面端的前提与差异：

- 需要 Rust（`stable-x86_64-pc-windows-msvc`）、VS Build Tools 的「使用 C++ 的桌面开发」、Windows SDK、WebView2 运行时。
- VS Build Tools **不会**把 `link.exe` 写进系统 PATH，直接 `npm run tauri dev` 会报 ``linker `link.exe` not found``。两种解法：
  - 用 `scripts/dev-desktop.cmd`（自动 `vcvars64` 后启动）；
  - 或在「x64 Native Tools Command Prompt for VS」里执行 `npm run tauri dev`。
- 若 PowerShell 禁止运行脚本（`npm.ps1` 被 ExecutionPolicy 拦截），改用 `npm.cmd` 或 `cmd`。
- 只想看界面、不碰 Rust：`npm run dev` 后打开 <http://localhost:1420>，走 `src/mocks` 的 mock IPC（无托盘、无真实窗口）。

```bash
cd src-tauri
cargo test                                  # 后端测试（全绿为交付门槛）
cargo clippy --all-targets -- -D warnings    # 0 warning，CI 里 warning 即失败
cargo fmt --check                            # 格式检查
```

打包：

```bash
npm run tauri build -- --no-bundle   # 只出 exe 本体
npm run tauri build                  # 出 nsis / msi 安装器（需能访问 GitHub 下载工具链）
scripts\build-release.cmd            # 出 exe 并复制到 release\（自动 vcvars64）
scripts\build-installer.cmd          # 出安装包：本地 NSIS 编译，不联网（本版产物即由它生成）
```

安卓出包（原生端，需 `JAVA_HOME` 指向 JDK17、`ANDROID_HOME` 指向 SDK）：

```bash
cd android-app
./gradlew.bat assembleRelease        # 产物 app/build/outputs/apk/release/
```

## 文档

| 文档 | 内容 |
|---|---|
| `docs/phase2/IPC-CONTRACT-v2.md` | 命令与错误码正本（§2 共 16 码，§12 逐版本增量与减量，§12.8 移动端） |
| `docs/phase2/IPC-CONTRACT-v3.md` | 事件契约（名称 / 载荷 / 触发点 / 订阅窗 / 例外） |
| `docs/phase2/schema-V0.2.0.sql` | v0.2.0 目标 DDL；后续迁移见 `src-tauri/src/migrations/` |
| `docs/plugin-spec.md` | 插件规格与字段全表（v1 quickTimers / v2 mdSync） |
| `docs/mobile/PRD-ANDROID-V1.md` · `DESIGN-ANDROID-V1.md` | 安卓端需求与设计（悬浮窗 / 前台服务 / 与桌面的能力对照） |
| `docs/sync/OBSIDIAN-SYNC.md` | 两端数据落点与 Markdown 区块格式契约 |
| `docs/design/BRAND-ICON.md` | 图标规范与生成口径 |
| `docs/decisions/ADR-001~035.md` | 架构决定记录（015 权限最小化 / 016 分层解环 / 017 门禁 / 033 插件 API v2 …） |
| `docs/decisions/OPEN-DECISIONS.md` | 未决登记 |
| `docs/reviews/` | 架构评估（2026-10-18）与 v0.4 评估报告（2026-10-25，13 项问题清单） |
| `docs/archive/v0.2/` · `docs/archive/v1/` | 历史阶段文档（v0.2.0 与 v1），只作留档，不作实现依据 |
| `docs/agents/` | 工程技能配置（issue tracker / 标签词汇 / 域文档） |
| `RELEASE-NOTES-v0.1.1.md` | **本版**发布说明：产物现状 / 改动 / 验收记录 / 人工验收清单 |
| `RELEASE-NOTES-v0.1.0.md` | 上一版发布说明（首次对外发布，含卸载与安装的原始验收记录） |
| `docs/NEXT-STEPS.md` | 后续完善建议（P0 发布阻断 → P3 维护小项，每条带验收口径） |
| `整理说明.md` | 本次整理做了什么、删了什么、还缺什么验证 |

## 版本

当前 **0.1.1**，是 0.1.0 之后的**第一轮功能迭代**：Markdown 同步从插件体系收回内建（ADR-036），
插件补上声明式面板与受限动作目录（ADR-037，`apiVersion 3`）。变更见 [CHANGELOG.md](CHANGELOG.md)。

> 版本口径说明：0.1.0 之前的 `0.2.x ~ 0.4.1` 是内部迭代号（从未对外发布）。
> 首个发布版按产品发布口径重新编号为 `0.1.0`，代码与契约与内部 `0.4.1` 完全一致，仅版本号不同。

版本号六处同步：`package.json` · `package-lock.json`（2 处）· `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` · `src-tauri/tauri.conf.json`。
**不需要人工核对**——`npm run check:version` 会断言，CI 里不一致即红。
安卓端版本在 `android-app/app/build.gradle.kts`（`versionName` / `versionCode`），随发版手动对齐。
