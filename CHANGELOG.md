# Changelog

本文件记录本仓库的版本变更。版本语义 `MAJOR.MINOR.PATCH`，与 `src-tauri/tauri.conf.json` 的 `version` 同步。

## [0.2.1] — 2026-10-17

仓库整理与升版。功能面与 0.2.0 一致（零命令 / 事件 / 错误码变更，零数据库迁移）。

### 变更

- **仓库结构**：应用源码从 `Timing_Rustv0.2.0/tickbar/` 平铺到仓库根（`src/`、`src-tauri/`、`package.json` 等），与既有 `docs/agents/` 合并成单一文档树。
- **版本号**：五处同步升到 `0.2.1` —— `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。此前三处填的是占位值 `1.0.0`，与产品版本号（V0.2.0）脱节。
- **文档归档**：v1 阶段文档（`Spec-v1` / `PRD-v1` / `ARCHITECTURE-v1` / `UIUX-v1` / `DESIGN.md` / `design/pages/*` / v1 令牌 / `schema.sql` / `QA-REPORT.md`）移入 `docs/archive/v1/`，现行 v0.2.0 文档留在原位。
- **`.gitignore` 重写**：原文件是 GBK 编码（UTF-8 下为乱码）且规则与布局不符（`**/target/` 未生效、产物路径缺失）。改为 UTF-8，按根布局覆盖 `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/`、`release/*.exe` 等。
- **文档内路径**：`tickbar/src/...` 一类旧前缀统一改为 `src/...`，与平铺后的布局一致。

### 移除（未纳入本仓库）

- `release/TickBar.exe`、`release/TickBar.new.exe`：构建产物；两者字节数相同（6,192,640 B），可重新构建。
- `src-tauri/gen/schemas/*.json`（`acl-manifests` / `desktop-schema` / `windows-schema`，共 375 KB）：Tauri 构建期生成，已入 `.gitignore`。
- `docs/design/_archive/`、`_ac53_*.mjs`、`_contrast_check.py`：一次性自检脚本。
- `.workbuddy/memory/`：团队工作记忆，不属于仓库内容（源目录仍保留）。

### 新增

- `README.md`：项目说明、技术栈、目录、开发 / 打包命令、文档索引。
- `CHANGELOG.md`：本文件。
- `docs/archive/v1/README.md`：归档说明与「归档 → 现行」对照表。

## [0.2.0] — 2026-10-16

批 2「重功能」+ 小条 UI 统一 + Timing 全面对齐优化轮。交付常用事项、倒计时、便利贴、提醒铃四组功能与托盘 IA 扩展；IPC 命令 29 → 52，事件 +6，错误码 +5；零新增迁移（`0002_v020.sql` 已前瞻建好）。QA verdict = PASS，`cargo test` 164 绿。详见 `docs/overview-V0.2.0.md`。
