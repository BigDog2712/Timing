# Timing

Windows 桌面常驻悬浮计时条：屏幕边缘一条 32px 的小药丸，按一下就开计时，不占工作区。纯本地（SQLite），无账号、无联网。

> 版本号只有一处出处：本文「## 版本」一节。标题不写版本，免得每次都漂。

形态可切换：**悬浮条**（默认）或 **小圆点**（44px 秒表图形：表盘细框 + 进度弧 + 指针，不写字，与手机端大环同一套弧语义）。
同一份源码还能编出安卓包（四页签 + 便利贴），见「平台」。

Tauri 2 + React 19 + TypeScript + Rust。

## 运行平台（先说清楚边界）

**只支持 Windows 10 / 11（x64）。** 这不是「暂时没测」，而是当前实现里有 Windows 专属能力，换平台等于重写：

| 能力 | 实现 | 跨平台可行性 |
| --- | --- | --- |
| 托盘菜单 | 原生 Win32 菜单（`src-tauri/src/infra/tray_menu.rs`） | 需按平台重写（macOS 用 `NSStatusItem`，Linux 依赖 `libayatana`） |
| 窗口点击穿透 | 用「把 OS 窗口收缩到内容包围盒」替代原生 layered window（ADR-014） | 思路可移植，但 `setSize/setPosition` 的合成器行为各平台不同 |
| 透明无边框小窗 | Tauri `transparent` + `skipTaskbar` + `alwaysOnTop` | Windows/macOS 可行；Linux 需合成器支持 |
| 开机自启 | `tauri-plugin-autostart`（注册表 `Run`） | 插件本身支持多平台，但 Linux 需 `~/.config/autostart` 写法验证 |
| 通知 | `tauri-plugin-notification`（WinRT Toast） | 插件支持多平台 |

因此：**不要假定它「天然跨平台」**。想要 macOS / Linux 版本，是一个独立的移植项目（托盘、几何钳制、DPI、窗口合成器四条线都要重做），不是加个 CI matrix 的事。

## 能做什么

| 能力 | 说明 |
|---|---|
| 小条 | 状态环（16×16 小米式圆角方形）+ 20px 计时数字 + 事项名 + 右侧**三形态手柄**（圆点 / 半手柄 / 手柄，各自可开关、各绑 5 个动作：左/右/中单击 + 左/右双击）；未悬停时只留内容、隐藏背板，悬停恢复药丸玻璃 |
| 悬浮形态 | 主界面 → 设置 → 悬浮条：悬浮条 / 小圆点 + 文字/背景不透明度。小圆点是 22px 纯图形钟面（表盘 / 进度弧 / 分针）：**外环一分钟一圈、分针一小时一圈**，暂停时环冻在当前位置；读数在悬停提示里（ADR-038 / ADR-040 / ADR-046）。小圆点形态下点一下临时展开成悬浮条，鼠标移开就收回；悬浮条形态不渲染任何圆点图形 |
| 正计时 / 倒计时 | 倒计时剩余 ≤60s 转 `#E5484D` 并 1s 闪烁（低于 WCAG 2.3.1 光敏阈值）；到点恒结束并保存（V0.3.4 起无开关） |
| 待办 / 记录 | 日 / 周视图、软删除、撤销条（3s）、内联编辑；低于「最短记录时长」（默认 30 秒，可调 5–300）的计时自动忽略 |
| 便利贴 | `note-{id}` 独立多窗，320×232 默认、160×120–900×900 硬钳，几何 300ms 防抖落盘，上限 20；**手机端**改为「便利贴」页签（列表 / 编辑 / 归属），数据与桌面同一张 `notes` 表（ADR-039） |
| 提醒铃 | 15s 查询式调度（`remind_at <= now AND reminded_at IS NULL`），抗休眠补偿，±60s 聚合、`reminded_at` 去重 |
| 摸鱼菜单 | 暂停态右键数字 / 左键事项名唤出：一键「换个事项 + 定长」开倒计时；「其他事项」打完名字用滚轮定长 |
| 插件 | `plugins/<id>/plugin.json` 是启动头，宿主只读不执行（声明式）；v1 贡献摸鱼菜单预设，v2 新增 `mdSync`；首个插件 `md-sync` 把计时 / 便利贴双向同步到 Markdown |
| Markdown 同步 | 主界面 → 设置 → 数据与同步：落点根目录 / 文件模板 / 标题可改；轮询间隔默认 15 分钟可调（1 分钟–24 小时）+「立即同步」；**Markdown 是第一优先级**，两边都改过时文件说了算（ADR-042）；只改目标标题下的区块 |
| 主题 | 深 / 浅 / 跟随系统 + 四色自定义（计时中 / 提醒 / 完成 / 小条底色），跨窗广播；控件唯一归属 = 主界面 → 设置 → 主题 |
| 系统集成 | 原生 Win32 托盘菜单、开机自启、单实例、窗口位置记忆；主窗与所有浮层窗口恒定置顶（V0.3.3 起不可切换） |
| 设置 | **只有一个家**：主界面（label `patina`）→ 设置，五组横排锚点（悬浮条 / 外观 / 计时与记录 / 数据与同步 / 通用与启动）。独立设置窗与药丸内联设置面板已于 0.12.1 下线 |
| 时间统计（Patina） | **0.12.0 起同一进程的第二扇窗**（label `patina`）：自动使用追踪 / 历史 / 番茄 / 使用上限提醒 / 分类映射。入口两处——托盘「时间统计…」与 主界面 → 设置 → 通用与启动 → 时间统计；**只有一个托盘图标**（Patina 自己的托盘已摘除）。数据并排独立：`<数据根>/patina/data/patina.db`（与 `timing.db` 同目录，互不迁移）。Patina 为 MIT 许可的 vendored 源码，来源与改动清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) |

## 技术栈

- 前端：React 19.3 · TypeScript 5.9 · Zustand 5 · Vite 8（rolldown 内核）· lucide-react
- 桌面壳：Tauri 2.12.4（`transparent` + `skipTaskbar` + `alwaysOnTop` 无边框小窗，V0.3.3 起所有窗口恒定置顶）
- 后端：Rust 1.90+ · sqlx 0.8（SQLite，WAL）· tauri-plugin-autostart / window-state / single-instance / notification / dialog（仅目录选择）
  （v0.3 起**移除** `plugin-sql` / `plugin-store`：前端从未引用，但 capability 曾放行，等于给前端留了一条绕过四层的直连数据库通道，见 ADR-015）
- 数据：`migrations/0001_init.sql`（v1）+ `0002_v020.sql`（v2）+ `0003_v030.sql`（v3）+ `0004_v0312.sql`（v4）+ `0005_v0113.sql`（v5，`todos.item_id`），`settings.schema.version` 记迁移版本

## 目录

```
.
├── index.html              # 宿主入口（多窗口共用同一 bundle，按 label 分流）
├── patina.html             # Patina 入口（0.12.0 起同进程的第二扇窗，独立 bundle）
├── src/                    # React 前端（宿主与第二窗共用一份源码，按 label 分流）
│   ├── components/         # pill / panel / menu / todos / note / records / reminder / settings / ui / mobile
│   ├── stores/             # zustand：timer / todo / note / item / plugin / theme / settings / ui
│   ├── services/           # ipc 封装 + 各域 action + api.ts 领域门面
│   ├── hooks/  lib/  types/
│   ├── styles/             # 自写 CSS；tokens/ 是设计令牌实体（design-tokens.css 为索引，@import 顺序不可调换）
│   ├── mocks/              # 浏览器降级 mock（无 Tauri 环境下 `npm run dev` 可跑）
│   └── app/  features/  platform/  shared/   # 第二窗（Patina）前端，0.12.0 归一后与宿主同层并列
├── src-tauri/              # Rust 后端（依赖只能向下，见 ADR-016）
│   ├── src/platform/       # 叶子层：clock（单调时钟）/ log / boot_timing
│   ├── src/infra/          # 平台适配：窗口 / 托盘菜单 / 通知 / 几何 / 迁移
│   ├── src/services/       # 业务：计时 / 事项 / 待办 / 便利贴 / 设置 / 主题 / md 同步 / 云端
│   ├── src/app/            # 装配：events / tray / bootstrap / diagnostics
│   ├── src/jobs/           # 调度：monitor / flusher / reminder / countdown / restore_notes
│   ├── src/commands/  src/repositories/  src/models/  src/tests/
│   ├── src/{app,commands,infra,models,services}/insight/  # 第二窗后端：按宿主同名层归位
│   ├── capabilities/       # Tauri 2 权限放行清单（只留实际用到的窗口/事件/自启）
│   └── tauri.conf.json
├── android-app/            # 已归档的 Kotlin 原生工程（冻结 0.3.6；check:version 盯着它，改版本会红）
├── scripts/                # 门禁八步（见「## 开发」）+ 出包（android-* / build-*）
├── plugins/                # 插件：一文件夹一插件，内含启动头 plugin.json（规格见 docs/plugin-spec.md）
│   └── md-sync/            # 首个 v2 插件：计时 / 便利贴 ↔ Markdown 双向同步
├── tests/fixtures/         # 双端黄金用例（timer-formula.json，Rust 与 TS 共用）
├── preview/                # 静态预览页（设计对照用，不参与构建）
├── docs/                   # 规格 / 架构 / 设计 / ADR / QA；历史版本在 docs/archive/
└── release/                # 构建产物落点（不入库，见 .gitignore）
```

**两套代码在一个仓里**：宿主（`src/` 的 components / stores / services… + `src-tauri/src/` 同名层）
与 0.12.0 并入的 Patina。Patina 是 vendored 第三方源码，**结构已归一**：前端
`app / features / platform / shared` 四个根与宿主目录同层并列（目录名互不冲突），后端收进各层的
`insight/` 命名空间（`src-tauri/src/{app,commands,infra,models,services}/insight/`）。
`check:size` 的 300 行豁免**不再是整棵豁免**，改为逐文件基线棘轮（`scripts/size-allowlist.json`，
只许减不许增）。改动清单见 `THIRD-PARTY-NOTICES.md`，与上游对账靠 `check:vendored`。

## 开发

```bash
npm install
npm run dev          # 前端单独跑（浏览器 mock 模式，端口 1420）
npm run tauri dev    # 完整桌面应用（前端 + Rust 侧联调）
npm run check        # 八步门禁：typecheck + contract + size + vendored + version + layers + brand + lint
npm run lint         # ESLint（只查正确性，不查代码风格）
npm test             # vitest（含双端时间公式黄金用例）
npm run build        # tsc + vite build
```

Windows 上跑桌面端的前提与差异：

- 需要 Rust（`stable-x86_64-pc-windows-msvc`）、VS Build Tools 的「使用 C++ 的桌面开发」、Windows SDK、WebView2 运行时。
- VS Build Tools **不会**把 `link.exe` 写进系统 PATH，直接 `npm run tauri dev` 会报 ``linker `link.exe` not found``。两种解法：
  - 用 `scripts/dev-desktop.cmd`（自动 `vcvars64` 后启动，双击或命令行均可）；
  - 或在「x64 Native Tools Command Prompt for VS」里执行 `npm run tauri dev`。
- 若 PowerShell 禁止运行脚本（`npm.ps1` 被 ExecutionPolicy 拦截），改用 `npm.cmd` 或 `cmd`。
- 只想看界面、不碰 Rust：`npm run dev` 后打开 <http://localhost:1420>，走 `src/mocks` 的 mock IPC（无托盘、无真实窗口）。

```bash
cd src-tauri
cargo test                                  # 后端测试（全绿为交付门槛；具体条数随用例增减，不在文档里钉死）
cargo clippy --all-targets -- -D warnings    # 0 warning，CI 里 warning 即失败
cargo fmt --check                            # 格式检查
```

打包（Windows，需 NSIS / WiX）：

```bash
npm run tauri build -- --no-bundle   # 只出 exe 本体
npm run tauri build                  # 出 nsis / msi 安装器
```

构建产物：`src-tauri/target/release/timing.exe`，仓库约定复制到 `release/Timing.exe`。

## 文档

| 文档 | 内容 |
|---|---|
| `docs/Spec-V0.2.0.md` | 现行 Spec 契约（§5 命令面锁定 52 项 + 实装增量 10 项 / §9 AC 验收 / §13 变更记录） |
| `docs/phase1/ARCHITECTURE-V0.2.0.md` | v0.2 架构（分层 / IPC / 多窗口 / 迁移）；v0.3 的分层变更见 ADR-016 |
| `docs/phase2/IPC-CONTRACT-v2.md` | 命令与错误码正本（§2 共 16 码，§12 登记 V0.3.0 / V0.3.3 / V0.3.4 / V0.4.0 增量与减量） |
| `docs/phase2/IPC-CONTRACT-v3.md` | 事件契约（名称 / 载荷 / 触发点 / 订阅窗 / 例外） |
| `docs/phase2/schema-V0.2.0.sql` | v0.2.0 目标 DDL；v0.3.0 仅新增 `notes.is_pinned`（迁移 `0003_v030.sql`，见 ADR-019） |
| `docs/design/DESIGN-V0.2.0.md` | 设计系统（令牌 / 组件规格 / 页面） |
| `docs/design/pages-V0.2.0/` | 各页面规格（小条 / 菜单 / 待办 / 便利贴 / 提醒 / 设置 / 主题） |
| `docs/decisions/ADR-001~033.md` | 架构决定记录（015 权限最小化 / 016 分层解环 / 017 门禁 / 018 第 17 错误码 / 019 便利贴置顶持久化 / 020 删除固定画布 / 021 允许同名事项 / 022 下架全局快捷键与窗口置顶开关 / 023 删除日记模块与记录阈值 / 033 插件 API v2 与 md-sync） |
| `docs/decisions/OPEN-DECISIONS.md` | 未决登记 |
| `docs/reviews/2026-10-18-ARCH-ASSESSMENT.md` | 架构评估报告（评估 / 优缺点 / 架构规划 / 任务分工 T01–T23） |
| `docs/reviews/2026-10-25-V0.4.0-ASSESSMENT.md` | v0.4.0 评估报告（9 维评分 / 13 项问题清单 / 本轮已落地的 4 项优化 / 复核命令） |
| `docs/overview-V0.2.0.md` | v0.2.0 交付概览（历史） |
| `docs/archive/v1/` | v1 阶段文档（已被 v0.2.0 取代，仅留存） |
| `docs/agents/` | 工程技能配置（issue tracker / 标签词汇 / 域文档） |

## 版本

当前桌面 **0.12.1**，手机 **0.12.0**。变更见 [CHANGELOG.md](CHANGELOG.md)，逐次改动见 [更新日志.md](更新日志.md)。

**0.12.0 的内容是「融合」**：Patina（自动使用追踪 / 番茄）作为第二入口并入同一个
安装包与同一个进程，宿主仍然是 Timing（悬浮条与安卓端一行代码没动）。第三方来源与
许可义务见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

**迭代规则**：每轮默认只递增末位（`0.11.2 → 0.11.3`）；升 `0.12.0` 或 `1.0.0` 须经用户同意。

版本号六处同步：`package.json` · `package-lock.json`（2 处）· `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` · `src-tauri/tauri.conf.json`。
**不需要人工核对**——`npm run check:version` 会断言，CI 里不一致即红。
