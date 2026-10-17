# AGENTS.md

TickBar（Windows 桌面悬浮计时条，Tauri 2 + React 19 + Rust）· 当前版本 0.2.1。
本文件是给编码代理的入口约定。

## 项目速览

- 一个前端 bundle 服务所有窗口：`index.html` → `src/main.tsx`，按 `window.location` / window label 分流（主条 `main`、设置、事项、便利贴 `note-{id}`）。
- 前端 `src/**`（React + zustand + 自写 CSS，无 UI 框架）；后端 `src-tauri/src/**`（commands / services / repositories / models / infra，分层严格）。
- 数据库 SQLite：`src-tauri/src/migrations/0001_init.sql`（v1）+ `0002_v020.sql`（v2），`settings.schema.version` 记录迁移版本；改表必须新增迁移，不改历史文件。
- IPC 契约正本：`docs/phase2/IPC-CONTRACT-v2.md`；命令总数 52，四方必须一致（Spec §5 = `src/types/domain.ts` 的 `IpcApi` = `src-tauri/src/lib.rs` = `src/services/ipc.ts`）。

## 命令

```bash
npm run dev          # 前端 + 浏览器 mock（1420）
npm run tauri dev    # 完整桌面应用
npm run typecheck    # tsc --noEmit，必须 0 错
npm run build        # tsc + vite build
cd src-tauri && cargo test      # 后端测试，必须全绿
cd src-tauri && cargo clippy --all-targets
```

## 硬约束

- 单文件 ≤300 行（前后端一致，超出即拆）。
- CSS 只用 `var(--*)` 令牌，零字面量色值、零 emoji、零紫粉渐变；令牌定义在 `src/styles/design-tokens.css`。
- 错误码只在 `src-tauri/src/error.rs` 定义，前端只在 `src/types/domain.ts` 镜像，两侧字面值必须逐字一致。
- 文档目录：现行文档在 `docs/`（Spec-V0.2.0 / ARCHITECTURE-V0.2.0 / DESIGN-V0.2.0 / decisions / pages-V0.2.0）；`docs/archive/v1/` 只作历史，不作为实现依据。
- 版本号五处同步：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`；变更记录写 `CHANGELOG.md`。

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`BigDog2712/Timing_Rust`), driven by the `gh` CLI (panel flows prefer the `deck_` tools). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five triage roles, label string equal to role name (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`), plus the `wayfinder:*` ticket-type labels. See `docs/agents/triage-labels.md`.

### Domain docs

single-context. See `docs/agents/domain.md`.
