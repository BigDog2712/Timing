# AGENTS.md

Timing（Windows 桌面悬浮计时条 + 安卓同一份源码，Tauri 2 + React 19 + Rust）· 双轨版号：桌面 0.12.1 / 手机 0.12.0。
本文件是给编码代理的入口约定。

## 版本规则（先看这条）

- 产品名 **Timing**；每轮迭代**默认只递增末位**（`0.11.3 → 0.11.4`）。
- 升 `0.12.0` 或 `1.0.0` **必须先经用户同意**，不得自行进位。
- **双轨（V0.11.33 起）**：桌面与手机各走各的号，真源是 `scripts/platform-versions.json`。
  - `desktop` → `package.json` / `package-lock.json`（2 处）/ `src-tauri/Cargo.toml` / `Cargo.lock` / `tauri.conf.json` 六处必须等于它；
  - `mobile` → 安卓包自己的 `versionName` + `versionCode`，`scripts/android-apk.mjs` 只读它。
  - 两边**互不牵连**：发手机包不动桌面号，发改桌面号不动手机包。
  - 为什么分开：桌面最后一次出包是 0.11.27，手机已到 0.11.32，共抢一份号的结果是「手机每发一版就替桌面预支一个号」，下次桌面包会直接跳号。
  - `versionCode` 只许增不许减（Android 拒绝降级覆盖安装），门禁会扫 `release/` 已发出的 APK 名来挡。
- 版本变更写 `CHANGELOG.md`；每次改动的流水写 `更新日志.md`（只追加）。
- 长期规则与技术脉络的权威副本在 ForgeX：`3-ForgeX/Active/Timing/00-规则/`，
  本文件只保留与编码直接相关的那部分。

## 项目速览

- 一个前端 bundle 服务所有窗口：`index.html` → `src/windows/timing/entry/main.tsx`，按 `window.location` / window label 分流（主条 `main`、设置、事项、便利贴 `note-{id}`）。
- 前端 `src/**`（React + zustand + 自写 CSS，无 UI 框架）。
- **双窗边界（2026-11-12 重排后）**：`src/windows/` 下两个窗各占一棵子树，互不 import，只经 IPC 命令/事件交互；唯一例外是 `src/windows/timing/lib/windowApi.ts`（零业务依赖的窗口 API 薄壳）与 `src-tauri/icons/**` 静态资源。由 L9 机械执行。
  - 主窗：`src/windows/timing/{entry,components,hooks,lib,mocks,services,stores,styles,types}`
  - 分析窗：`src/windows/patina/{shell,features,platform,shared}`（`shell` = 原 `src/app`，即 Patina 的壳）
- 入口两个：`index.html` → `windows/timing/entry/main.tsx`；`patina.html` → `windows/patina/shell/main.tsx`。**不要再把 `shell` 当应用入口。**
- `src/vite-env.d.ts` 留在 `src/` 根，两窗共用。
- 后端 `src-tauri/src/**` 六层，依赖**只能向下**（ADR-016）：
  `platform`（叶子：clock / log / boot_timing）→ `infra`（窗口 / 托盘菜单 / 通知 / 几何 / 迁移）→ `services`（业务）→ `app`（装配：events / tray / bootstrap / diagnostics）与 `jobs`（调度）→ `commands`（IPC 入口）。
  其中 `models` / `infra` / `services` / `app` / `commands` 五层各带一个 `insight/` 命名空间（Patina 归一，见 `docs/refactor/patina-structural-merge.md` §2.2）：`models/insight ← infra/insight ← services/insight ← app/insight ← commands/insight`，方向与宿主层序一致。`insight` 是命名空间，不是第 7 层。
- 数据库 SQLite：`src-tauri/src/migrations/0001_init.sql` … `0007_v01127.sql` 共七支，当前 **schema v7**，`settings.schema.version` 记录迁移版本；改表必须新增迁移，不改历史文件。**0007 是重建表，不吃重跑**，必须由版本门 `< 7` 只放行一次（见 `infra/migrate.rs` 注释）。
- **数据目录迁移（V0.5.0）**：`infra/appdata_migrate/`（`paths` / `decide` / `copy` / `verify` / `marker` / `mod`）是 **headless** 的——不依赖 services、不依赖 tauri，所以能用两个临时目录直接跑测试（`run_at(&Paths, skip)`）。编排在 `app/preboot.rs`（桌面独占，跑在 `Builder::run` 之前、`log::init` 之前，故模块内不写日志），两条 IPC 命令在 `commands/migration_cmd.rs`。老库名 `tickbar.db` 与新库名 `timing.db` 的映射只认三种后缀（`""` / `-wal` / `-shm`），定义在 `paths.rs`。
- IPC 契约：宿主命令 **83** 条 + Patina **117** 条（仅桌面，`#[cfg(desktop)]`），一张表写在 `src-tauri/src/ipc_commands.rs`（`docs/phase2/IPC-CONTRACT-v2.md`）；事件 11 个（`docs/phase2/IPC-CONTRACT-v3.md`）。
- 插件：`plugins/<id>/plugin.json` 是**启动头**，宿主只读不执行（声明式）。目录三处合并扫描
  （dev → exe → user，同 id 先到先得）。v1 贡献点 `quickTimers`（摸鱼菜单预设）；
  **v2 新增 `mdSync`**（Markdown 双向同步落点，宿主实现同步，插件只声明）。
  首个 v2 插件是仓库内 `plugins/md-sync`（设置 → 同步页签）。
  规格与字段全表 `docs/plugin-spec.md`；改贡献点必须同时升 `apiVersion` 并补该文档一节。

## 命令

```bash
npm run dev          # 前端 + 浏览器 mock（1420）
npm run tauri dev    # 完整桌面应用
npm run check        # 全部门禁：typecheck + contract + size + vendored + version + layers + brand + lint
npm run typecheck    # tsc --noEmit，必须 0 错
npm run lint         # ESLint（只查正确性，不查风格）
npm test             # vitest（含双端时间公式黄金用例）
npm run build        # tsc + vite build
cd src-tauri && cargo test                 # 后端测试，必须全绿
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo fmt --check
```

## 硬约束（全部由 CI 机械执行，不靠记性）

- **单文件 ≤300 行**（前后端一致）→ `npm run check:size`
  超限文件登记在 `scripts/size-allowlist.json` 的**冻结基线**（150 条，由 `--freeze` 扫描生成，禁止手写）。它是**棘轮**：只许减不许增——行数超过冻结值、或出现不在基线里的新超限文件，一律红。拆分后跑 `node scripts/check-size.mjs --freeze` 收紧。
  **硬目标（2026-11-12 拍板）**：每版至少 **−10 条**，0.15.0 前压到 **100 条以内**；未达标不提交出包。门禁摘要会打印「超限行数 / 总行数」占比，当前 **94,115 / 288,153 = 32.7%**，别只看条数。
- **分层只能向下** → `npm run check:layers`（9 条 grep 规则）
  L1 `components`（含 `patina/{shell,features,shared}` 下的 `components/`）不 `invoke`；L2 `stores`（含 `*Store.ts`、`features/**/stores`）不碰 `ipc.`；L3 只有 `windows/timing/lib/windowApi.ts` 引窗口 API 包（`api/window` 与 `api/webviewWindow`）；L4 `infra` 不 `use crate::services`；L5 `commands` 不 `use crate::repositories`；L6 无 `eprintln!`（走 `log_*!`）；L7 编译期平台常量 `__TIMING_MOBILE__` 只许出现在 `windows/timing/lib/platform.ts`（带哨兵，防「绿着空转」）；L8 业务写入信号 `dirty::mark(` 只许出现在 `src-tauri/src/commands/`，`jobs/` 与 `services/` 0 命中（带 `pub fn mark(` 定义哨兵，防改名后绿着空转）；L9 双窗隔离——主窗与分析窗不得互相 import，**例外表已清空**：原 5 条共享模块（windowApi / handleCatalog / handleBindings / pillAppearance / pillPrefsGateway）已整体下沉到 `src/windows/shared/`，两侧直接引它，跨窗引用在物理上消失（带哨兵：两条路径集合必须非空；例外表非空时每条必须真实存在，防薄壳改名后绿着空转）；**L10 分层方向**——`patina/platform/**` 不得 import `features/**` 或 `shell/**`，`patina/shared/**` 不得 import `features/**`、`shell/**`、`platform/**`，`windows/shared/**` 不得 import `timing/**` 或 `patina/**`（带哨兵：每层路径集合非空且至少解析出 1 条相对 import，防路径前缀写错后绿着空转；`*.test.*` 不参与——测试站在最上层验收接缝；CSS 等资源说明符不参与——它们没有模块语义）。
- **IPC 契约** → `npm run check:contract`
  命令 4 处一致（`generate_handler!` / `IpcApi` / `ipc.ts` / `browserMock`）、错误码 2 处一致、事件三方一致（后端常量 / `IPC_EVENTS` / emit 点）、禁止事件名字面量、**每个错误码必须在 `errorText()` 里有 case**（否则静默落到通用兜底）。
- **Patina 改动必须登记** → `npm run check:vendored`
  Patina 已按层并入（无独立子树）：前端 `src/windows/patina/**`，后端 `src-tauri/src/{app,commands,infra,models,services}/insight/**`。基线按前后端分锚（`7bc7bd7` / `9a7772f`，机械改写批次见 `_reanchor`），改一处就要在 `scripts/vendored-allowlist.json` 写一条 `path + change + reason + owner`（**owner 必填**），否则红。`node scripts/check-vendored-diff.mjs --upstream <patina-main>` 按 `UPSTREAM_MAP` + `TEXT_MAP` 反推回上游坐标系，报「同 / 实质差异 / 仅上游 / 仅本地」。**这是为了保住「能 diff 上游、按需同步」**——顺手的颜色调整攒上十轮，上游发版时全是逐行冲突。
- **双轨版号** → `npm run check:version`
  真源 `scripts/platform-versions.json`。桌面六处（`package.json` · `package-lock.json` 2 处 · `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` · `src-tauri/tauri.conf.json`）必须等于 `desktop`；手机 `versionCode` 必须与 `versionName` 同源（`major*1_000_000 + minor*1_000 + patch`）且**不低于 `release/` 已发出的最大号**。另含归档冻结表。**不再需要人工核对**；变更记录写 `CHANGELOG.md`。
  ⚠️ 安卓出包**只能走** `node scripts/android-apk.mjs`：`npm run tauri android build` 会读 `tauri.conf.json` 的桌面号，出来的包版号是错的。
- CSS 只用 `var(--*)` 令牌，零字面量色值、零 emoji、零紫粉渐变；令牌定义在 `src/windows/timing/styles/design-tokens.css`（索引，实体在 `src/windows/timing/styles/tokens/*.css`，**@import 顺序不可调换**）。
- 错误码只在 `src-tauri/src/error.rs` 定义（`as_str`），前端镜像**两处**：联合类型 `src/windows/timing/types/domain/models.ts::ErrorCode` 与文案 `src/windows/timing/services/ipc.ts::errorText()`。三者逐字一致，由 `check:contract` 断言。当前 **18** 个；**加码与下架都必须走契约评审**（同步改 union / 文案 / 契约文档 §2，并写一份 ADR 说明为什么现有码表达不了——或为什么该码不再有触发点，见 ADR-018 / ADR-021 / ADR-022）。
- 文档目录：现行文档在 `docs/`；`docs/archive/v1/` 只作历史，不作为实现依据。

## 权限面

`src-tauri/capabilities/default.json` 只放行实际用到的窗口 / 事件 / 开机自启 / 文件夹选择能力。
V0.4.0 只新增 `dialog:allow-open`（原生目录选择，用于 md-sync 落点配置）；**不是**通用文件读写授权。
**禁止**加回 `sql:allow-*`、`store:allow-*`——那等于给前端一条绕过四层的直连数据库通道（ADR-015）。数据访问一律 `commands → services → repositories`。

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`BigDog2712/Timing_Rust`), driven by the `gh` CLI (panel flows prefer the `deck_` tools). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five triage roles, label string equal to role name (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`), plus the `wayfinder:*` ticket-type labels. See `docs/agents/triage-labels.md`.

### Domain docs

single-context. See `docs/agents/domain.md`.
