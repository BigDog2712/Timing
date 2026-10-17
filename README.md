# TickBar v0.2.1

Windows 桌面常驻悬浮计时条：屏幕边缘一条 32px 的小药丸，按一下就开计时，不占工作区。纯本地（SQLite），无账号、无联网。

Tauri 2 + React 19 + TypeScript + Rust。

## 能做什么

| 能力 | 说明 |
|---|---|
| 悬浮小条 | 状态环（⌀16）+ 20px 计时数字 + 事项名；未悬停时只留内容、隐藏背板，悬停恢复药丸玻璃 |
| 正计时 / 倒计时 | 倒计时剩余 ≤60s 转 `#E5484D` 并 1s 闪烁（低于 WCAG 2.3.1 光敏阈值）；到点默认「通知 + 视觉」 |
| 待办 / 记录 | 日 / 周视图、软删除、撤销条（3s）、内联编辑 |
| 便利贴 | `note-{id}` 独立多窗，320×232 默认、160×120–900×900 硬钳，几何 300ms 防抖落盘，上限 20 |
| 提醒铃 | 15s 查询式调度（`remind_at <= now AND reminded_at IS NULL`），抗休眠补偿，±60s 聚合、`reminded_at` 去重 |
| 常用事项 | `is_pinned` 置顶组 + 最近 5 项一键开计时 |
| 主题 | 深 / 浅 / 跟随系统 + 四色自定义（计时中 / 提醒 / 完成 / 小条底色），跨窗广播 |
| 系统集成 | 原生 Win32 托盘菜单、开机自启、单实例、窗口位置记忆；全局快捷键为 P1 特性，默认编译关闭 |

## 技术栈

- 前端：React 19.3 · TypeScript 5.9 · Zustand 5 · Vite 8（rolldown 内核）· lucide-react
- 桌面壳：Tauri 2.12.4（`transparent` + `skipTaskbar` + `alwaysOnTop` 无边框小窗）
- 后端：Rust 1.90+ · sqlx 0.8（SQLite，WAL）· tauri-plugin-sql / store / autostart / window-state / single-instance / notification
- 数据：`migrations/0001_init.sql`（v1）+ `0002_v020.sql`（v2，批2 前瞻建表加列），`settings.schema.version` 记迁移版本

## 目录

```
.
├── index.html              # 唯一入口（多窗口共用同一前端 bundle，按 label 分流）
├── src/                    # React 前端
│   ├── components/         # pill / panel / menu / todos / note / records / reminder / settings / ui
│   ├── stores/             # zustand：timer / todo / note / item / theme / settings / ui
│   ├── services/           # ipc 封装 + 各域 action
│   ├── hooks/  lib/  types/  styles/
│   └── mocks/              # 浏览器降级 mock（无 Tauri 环境下 `npm run dev` 可跑）
├── src-tauri/              # Rust 后端
│   ├── src/{commands,services,repositories,models,infra,migrations,tests}
│   ├── capabilities/       # Tauri 2 权限放行清单
│   └── tauri.conf.json
├── preview/pill-preview.html   # 小条静态预览（设计对照用，不参与构建）
├── docs/                   # 规格 / 架构 / 设计 / ADR / QA
└── release/                # 构建产物落点（不入库，见 .gitignore）
```

## 开发

```bash
npm install
npm run dev          # 前端单独跑（浏览器 mock 模式，端口 1420）
npm run tauri dev    # 完整桌面应用（前端 + Rust 侧联调）
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build
```

Windows 上跑桌面端的前提与差异：

- 需要 Rust（`stable-x86_64-pc-windows-msvc`）、VS Build Tools 的「使用 C++ 的桌面开发」、Windows SDK、WebView2 运行时。
- VS Build Tools **不会**把 `link.exe` 写进系统 PATH，直接 `npm run tauri dev` 会报 ``linker `link.exe` not found``。两种解法：
  - 用 `scripts/dev-desktop.cmd`（自动 `vcvars64` 后启动，双击或命令行均可）；
  - 或在「x64 Native Tools Command Prompt for VS」里执行 `npm run tauri dev`。
- 若 PowerShell 禁止运行脚本（`npm.ps1` 被 ExecutionPolicy 拦截），改用 `npm.cmd` 或 `cmd`。
- 只想看界面、不碰 Rust：`npm run dev` 后打开 <http://localhost:1420>，走 `src/mocks` 的 mock IPC（无托盘、无全局快捷键、无真实窗口）。

```bash
cd src-tauri
cargo test           # 后端测试（当前 164 项）
cargo clippy --all-targets
```

打包（Windows，需 NSIS / WiX）：

```bash
npm run tauri build -- --no-bundle   # 只出 exe 本体
npm run tauri build                  # 出 nsis / msi 安装器
```

构建产物：`src-tauri/target/release/tickbar.exe`，仓库约定复制到 `release/TickBar.exe`。

## 文档

| 文档 | 内容 |
|---|---|
| `docs/Spec-V0.2.0.md` | 现行 Spec 契约（§5 命令面 52 项 / §9 AC 验收 / §13 变更记录） |
| `docs/phase1/ARCHITECTURE-V0.2.0.md` | 现行架构（分层 / IPC / 多窗口 / 迁移） |
| `docs/phase2/IPC-CONTRACT-v2.md` | IPC 契约正本（命令 / 事件 / 错误码） |
| `docs/phase2/schema-V0.2.0.sql` | 目标 DDL |
| `docs/design/DESIGN-V0.2.0.md` | 设计系统（令牌 / 组件规格 / 页面） |
| `docs/design/pages-V0.2.0/` | 各页面规格（小条 / 菜单 / 待办 / 便利贴 / 提醒 / 设置 / 主题） |
| `docs/decisions/ADR-001~013.md` | 架构决定记录 |
| `docs/decisions/OPEN-DECISIONS.md` | 未决登记 |
| `docs/overview-V0.2.0.md` | v0.2.0 交付概览（历史） |
| `docs/archive/v1/` | v1 阶段文档（已被 v0.2.0 取代，仅留存） |
| `docs/agents/` | 工程技能配置（issue tracker / 标签词汇 / 域文档） |

## 版本

当前 **0.2.1**。变更见 [CHANGELOG.md](CHANGELOG.md)。
版本号五处同步：`package.json` · `package-lock.json` · `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` · `src-tauri/tauri.conf.json`。
