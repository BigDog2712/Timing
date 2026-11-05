# Timing v0.11.0

Windows 桌面常驻悬浮计时条：屏幕边缘一条 32px 的小药丸，按一下就开计时，不占工作区。纯本地（SQLite），无账号、无联网。

形态可切换：**悬浮条**（默认）或 **小圆点**（76px，环 + 时分读数，与手机端大环同一套语言）。
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
| 小条 | 状态环（16×16 小米式圆角方形）+ 20px 计时数字 + 事项名；未悬停时只留内容、隐藏背板，悬停恢复药丸玻璃 |
| 悬浮形态 | 设置 → 外观：悬浮条 / 小圆点。小圆点是 76px 环 + `MM:SS`，弧语义与悬浮条、手机端大环同一套（ADR-038） |
| 正计时 / 倒计时 | 倒计时剩余 ≤60s 转 `#E5484D` 并 1s 闪烁（低于 WCAG 2.3.1 光敏阈值）；到点恒结束并保存（V0.3.4 起无开关） |
| 待办 / 记录 | 日 / 周视图、软删除、撤销条（3s）、内联编辑；低于「最短记录时长」（默认 30 秒，可调 5–300）的计时自动忽略 |
| 便利贴 | `note-{id}` 独立多窗，320×232 默认、160×120–900×900 硬钳，几何 300ms 防抖落盘，上限 20；**手机端**改为「便利贴」页签（列表 / 编辑 / 归属），数据与桌面同一张 `notes` 表（ADR-039） |
| 提醒铃 | 15s 查询式调度（`remind_at <= now AND reminded_at IS NULL`），抗休眠补偿，±60s 聚合、`reminded_at` 去重 |
| 摸鱼菜单 | 暂停态右键数字 / 左键事项名唤出：一键「换个事项 + 定长」开倒计时；「其他事项」打完名字用滚轮定长 |
| 插件 | `plugins/<id>/plugin.json` 是启动头，宿主只读不执行（声明式）；v1 贡献摸鱼菜单预设，v2 新增 `mdSync`；首个插件 `md-sync` 把计时 / 便利贴双向同步到 Markdown |
| Markdown 同步 | 设置 → 同步：落点根目录 / 文件模板 / 标题可改；SQL 与 Markdown 任一侧改动 2 秒内对齐；冲突最后写入者胜；只改目标标题下的区块 |
| 主题 | 深 / 浅 / 跟随系统 + 四色自定义（计时中 / 提醒 / 完成 / 小条底色），跨窗广播 |
| 系统集成 | 原生 Win32 托盘菜单、开机自启、单实例、窗口位置记忆；主窗与所有浮层窗口恒定置顶（V0.3.3 起不可切换） |

## 技术栈

- 前端：React 19.3 · TypeScript 5.9 · Zustand 5 · Vite 8（rolldown 内核）· lucide-react
- 桌面壳：Tauri 2.12.4（`transparent` + `skipTaskbar` + `alwaysOnTop` 无边框小窗，V0.3.3 起所有窗口恒定置顶）
- 后端：Rust 1.90+ · sqlx 0.8（SQLite，WAL）· tauri-plugin-autostart / window-state / single-instance / notification / dialog（仅目录选择）
  （v0.3 起**移除** `plugin-sql` / `plugin-store`：前端从未引用，但 capability 曾放行，等于给前端留了一条绕过四层的直连数据库通道，见 ADR-015）
- 数据：`migrations/0001_init.sql`（v1）+ `0002_v020.sql`（v2）+ `0003_v030.sql`（v3）+ `0004_v0312.sql`（v4），`settings.schema.version` 记迁移版本

## 目录

```
.
├── index.html              # 唯一入口（多窗口共用同一前端 bundle，按 label 分流）
├── src/                    # React 前端
│   ├── components/         # pill / panel / menu / todos / note / records / reminder / settings / ui
│   ├── stores/             # zustand：timer / todo / note / item / plugin / theme / settings / ui
│   ├── services/           # ipc 封装 + 各域 action + api.ts 领域门面
│   ├── hooks/  lib/  types/  styles/
│   ├── styles/tokens/      # 设计令牌实体（design-tokens.css 是索引，@import 顺序不可调换）
│   └── mocks/              # 浏览器降级 mock（无 Tauri 环境下 `npm run dev` 可跑）
├── src-tauri/              # Rust 后端（依赖只能向下，见 ADR-016）
│   ├── src/platform/       # 叶子层：clock（单调时钟）/ log / boot_timing
│   ├── src/infra/          # 平台适配：窗口 / 托盘菜单 / 通知 / 几何 / 迁移
│   ├── src/services/       # 业务：计时 / 事项 / 待办 / 便利贴 / 设置 / 主题
│   ├── src/app/            # 装配：events / tray / bootstrap / diagnostics
│   ├── src/jobs/           # 调度：monitor / flusher / reminder / countdown / restore_notes
│   ├── src/commands/  src/repositories/  src/models/  src/tests/
│   ├── capabilities/       # Tauri 2 权限放行清单（只留实际用到的窗口/事件/自启）
│   └── tauri.conf.json
├── scripts/                # 五道机械门禁（size / version / layers / contract / build）
├── plugins/                # 插件：一文件夹一插件，内含启动头 plugin.json（规格见 docs/plugin-spec.md）
│   └── md-sync/            # 首个 v2 插件：计时 / 便利贴 ↔ Markdown 双向同步
├── tests/fixtures/         # 双端黄金用例（timer-formula.json，Rust 与 TS 共用）
├── preview/pill-preview.html   # 小条静态预览（设计对照用，不参与构建）
├── docs/                   # 规格 / 架构 / 设计 / ADR / QA
└── release/                # 构建产物落点（不入库，见 .gitignore）
```

## 开发

```bash
npm install
npm run dev          # 前端单独跑（浏览器 mock 模式，端口 1420）
npm run tauri dev    # 完整桌面应用（前端 + Rust 侧联调）
npm run check        # 全部门禁：typecheck + contract + size + version + layers + lint
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

当前 **0.11.0**。变更见 [CHANGELOG.md](CHANGELOG.md)，逐次改动见 [更新日志.md](更新日志.md)。

**迭代规则**：每轮默认只递增末位（`0.11.0 → 0.11.1`）；升 `0.12.0` 或 `1.0.0` 须经用户同意。

版本号六处同步：`package.json` · `package-lock.json`（2 处）· `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` · `src-tauri/tauri.conf.json`。
**不需要人工核对**——`npm run check:version` 会断言，CI 里不一致即红。
