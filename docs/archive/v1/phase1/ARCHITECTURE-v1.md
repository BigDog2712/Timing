# Timing 架构设计 v1（Phase 1）

- Document ID: ARCH-v1
- Status: Draft for Phase 2 review
- Owner: 高见远（首席架构师，mvp-dev-expert-team-architect）
- Date: 2026-10-16
- Upstream: 产品简报《Windows 桌面悬浮轻量计时小工具 Timing》（暂定名）
- Downstream: Phase 2 API 契约 / 前端实现 / 后端实现 / Phase 3 测试

---

## 0. 一句话结论

Timing 是一个**纯本地、免登录、常驻托盘的 Windows 桌面计时小工具**。架构结论：**Tauri 2（Rust）+ React 19 + TypeScript + SQLite**，前端只做表现，Rust 侧承载计时状态机、数据持久化与全部 OS 集成（托盘 / 全局快捷键 / 开机自启 / 窗口状态）。安装包体积目标 < 8MB，空闲内存目标 < 60MB（在 Windows 11 WebView2 环境）。

---

## 1. 范围（Scope）

### 1.1 本期覆盖（In scope）

> 优先级对齐 PRD v1：`[MVP]` = PRD P0，必须交付；`[P1]` = PRD P1，本架构预置能力，按排期交付。

- [MVP] 深色药丸（pill）悬浮条：无边框、置顶、不占任务栏、可拖动、紧凑不遮挡；多显示器定位与位置记忆。
- [MVP] 核心闭环：左键开始计时 -> 左键暂停（仅冻结，**不结束记录**）-> 再次左键从暂停值继续 -> 右键结束并走收尾浮层保存；随时「新建事项」。
- [MVP] 按事项（item）归类的时间记录（time_record），无事项时以系统事项「未归类」承接。
- [MVP] 本地 SQLite 持久化 + 崩溃恢复（active/draft 会话处理，运行中每 15s 落盘）。
- [MVP] 轻量记录面板：今天/本周按事项聚合 + 明细列表。
- [MVP] 单实例（防重复计时）、高 DPI/多显示器适配、无管理员权限可用。
- [P1] 系统托盘图标 + 菜单 + 单击显隐。
- [P1] 全局快捷键（显示/隐藏、开始/暂停、结束、新建事项）。
- [P1] 开机自启（可在设置中开关）。
- [P1] 记录补记与手动编辑、周/月汇总与 CSV 导出、悬浮条外观设置（透明度/尺寸/停靠）。
- [P1] Windows 打包（NSIS installer + MSI，按需代码签名）。

### 1.2 本期不做（Out of scope，硬约束，禁止镀金）
- 账号体系、云同步、多端、团队协作（明确无后端、无网络请求）。
- 除 Windows 以外的平台（macOS/Linux 明确不投入，代码保留 Tauri 跨平台能力但不过度适配）。
- 番茄钟 / 目标 / 提醒 / 通知 / 声音提示等衍生功能（本期不做）。
- 图表统计看板（本期仅做最小统计：今日/本周合计，明细列表）。
- 自动更新（updater）、多语言 i18n（本期仅简体中文）。
- 主题商店 / 皮肤系统（本期仅一套深色主题）。
- 富文本笔记、任务优先级、子任务、标签体系。

> 任何超出上述 In-scope 的需求，必须回到 Phase 2 重新评审，不得在本期实现。

---

## 2. 技术选型对比矩阵

### 2.1 桌面框架对比（4 方案）

评分口径：5 分最优。数据来源见文末「参考来源」，为公开基准与官方文档口径，非厂商宣传值。

| 维度（权重） | Tauri 2 (Rust + 系统 WebView) | Electron | .NET 8 (WPF/WinUI 3) | Flutter Desktop |
|---|---|---|---|---|
| 安装包体积（高） | 5（约 3.8MB 起步，本项目中位预估 6-8MB） | 2（约 130MB+） | 4（约 15-40MB，依赖 .NET 运行时或 self-contained 更大） | 3（约 16-30MB） |
| 空闲内存（高） | 5（约 45-90MB） | 2（约 210-310MB） | 4（约 60-120MB） | 3（约 85-210MB） |
| 冷启动（高） | 4（约 120-150ms） | 2（约 400-890ms） | 5（原生，最快） | 3（约 290-340ms） |
| 无边框+置顶+不占任务栏（高） | 5（`decorations:false` + `alwaysOnTop` + `skipTaskbar` 一等支持） | 5 | 5（需 Win32 `SetWindowPos`/`WS_EX_TOOLWINDOW`） | 4 |
| 全局热键（高） | 5（官方 `tauri-plugin-global-shortcut`） | 4（`globalShortcut` 模块） | 4（`RegisterHotKey` + 消息循环，需手写） | 3（需第三方包） |
| 系统托盘（高） | 5（内建 `tauri::tray`） | 5 | 4（`NotifyIcon`/H.NotifyIcon） | 3（需第三方） |
| 开机自启（中） | 5（官方 `tauri-plugin-autostart`） | 3（需手写注册表） | 4（可写注册表） | 3 |
| SQLite 支持（高） | 5（官方 `tauri-plugin-sql` + sqlx + 迁移） | 5 | 5（`Microsoft.Data.Sqlite`） | 4 |
| 代码签名/打包成本（中） | 4（单 exe/NSIS/MSI，签名流程简单） | 3（产物大，签名体积成本高） | 4 | 3 |
| 开发迭代效率（高） | 5（Web 技术栈 + HMR） | 5 | 3（XAML 迭代慢，UI 代码量大） | 4 |
| Windows 生态契合度（中） | 4（WebView2 为系统组件，弱依赖 .NET） | 3 | 5（纯原生） | 3 |
| 加权合计 | 4.72 | 3.36 | 4.18 | 3.32 |

评分明细（加权分 = Σ 权重×分数 / Σ 权重；高=3、中=2 权）：Tauri 2 = (3×5+3×5+3×4+3×5+3×5+3×5+2×5+3×5+2×4+3×5+2×4)/31 = 146/31 ≈ 4.71；Electron = 104/31 ≈ 3.35；.NET = 130/31 ≈ 4.19；Flutter = 102/31 ≈ 3.29。

**结论：选 Tauri 2。** 决定性因素：
1. 产品第一诉求是「轻量、常驻、低占用」，Tauri 2 的体积/内存/冷启动全面优于 Electron，与「低内存低占用」目标直接对齐。
2. 本项目 5 项 OS 集成（托盘 / 全局热键 / 开机自启 / 窗口状态 / SQLite）**全部有 Tauri 官方插件一等支持**，无需手写 Win32 P/Invoke（.NET 路线的主要成本项）。
3. 团队为 Web 技术栈，前端迭代效率与 UI 还原度最优；pill 形态的大量 CSS 细节（圆角、半透明、等宽数字）用 Web 实现成本最低。
4. 不选 .NET：虽然生态契合度与冷启动最佳，但 XAML 迭代慢、无边框自定义窗口与热键需手写 Win32，MVP 速度与团队熟悉度不利。不选 Electron：体积/内存与产品定位冲突。不选 Flutter：桌面生态与插件成熟度在托盘/热键场景仍需第三方兜底。

### 2.2 前端框架与状态管理对比

| 方案 | 体积 | 生态 | MVP 速度 | 结论 |
|---|---|---|---|---|
| React 19 + TypeScript + Zustand | 极小（按需） | 最成熟 | 最快 | 选定 |
| Vue 3 + Pinia | 极小 | 成熟 | 快 | 备选（团队若更熟 Vue 可替换，不影响分层） |
| Svelte 5 | 极小 | 中 | 快 | 备选（生态与模板较少） |

选定 **React 19 + TypeScript + Zustand**：组件化与生态最成熟，Zustand 体积极小（约 1KB）满足「低占用」诉求，且官方 `create-tauri-app` 模板原生支持。

### 2.3 本地存储方案对比

| 方案 | 适合度 | 说明 | 结论 |
|---|---|---|---|
| SQLite（`tauri-plugin-sql` + sqlx） | 高 | 结构化查询、索引、迁移、事务，事件量增长后仍稳 | 选定 |
| `tauri-plugin-store`（JSON KV） | 中 | 适合配置，不适合时间记录的关系查询 | 仅用于设置项 |
| 纯 JSON 文件自管理 | 低 | 需自行处理并发/损坏/迁移 | 不用 |

选定 **SQLite 存业务数据 + `tauri-plugin-store` 存轻量设置**（双轨，见 ADR-003）。

### 2.4 锁定的完整技术栈与版本（已联网核实，2026-10-16）

| 层 | 技术 | 锁定版本 | 核实来源 |
|---|---|---|---|
| 桌面框架 | Tauri（Rust crate `tauri`） | **2.12.4**（稳定版；3.0 仍为 alpha，不用） | crates.io |
| 桌面框架 CLI | `@tauri-apps/cli` | **2.12.x**（与 core 同步） | npm |
| 前端 JS API | `@tauri-apps/api` | **2.12.4** | registry.npmjs.org |
| 前端 | React / React DOM | **19.3.0** | react.dev / npm |
| 语言 | TypeScript | **5.9.x**（Tauri 脚手架同期）| 见风险 R-7，装包时以脚手架为准 |
| 构建 | Vite | **8.3.4** | registry.npmjs.org |
| Vite React 插件 | `@vitejs/plugin-react` | **^6.1.2** | npm |
| 状态管理 | Zustand | **^5.0.0**（装包时锁定实际小版本） | npm |
| 图标库（锁定） | `lucide-react` | **1.57.0** | registry.npmjs.org |
| 数据持久化 | `tauri-plugin-sql`（features=["sqlite"]） | **2.5.0**（crate）/ `@tauri-apps/plugin-sql` **2.4.1**（npm） | crates.io / npm |
| 设置存储 | `tauri-plugin-store` | **^2.0.0** | npm |
| 全局热键 | `tauri-plugin-global-shortcut` | **^2.0.0** | Tauri 官方插件 |
| 系统托盘 | 内建 `tauri::tray`（crate feature `tray-icon`） | 随 core 2.12.4 | Tauri 官方 |
| 开机自启 | `tauri-plugin-autostart` | **^2.0.0** | Tauri 官方插件 |
| 窗口状态 | `tauri-plugin-window-state` | **^2.0.0** | Tauri 官方插件 |
| 单实例 | `tauri-plugin-single-instance` | **^2.0.0** | Tauri 官方插件 |
| Rust 工具链 | rustc / cargo | **≥ 1.90**（tauri 2.12.4 MSRV，edition 2024） | crates.io |
| Node.js | Node | **^20.19 或 ≥ 22.12**（Vite 8 engines） | npm |

> 版本锚定纪律：以上版本为 Phase 2 起始基线。开发时以 `package.json` / `Cargo.toml` 实际解析结果为准，**禁止按「通用印象」写 API**（见 §9 已知坑 K-12）。

---

## 3. 分层架构

### 3.1 分层依赖图（依赖只能向下）

```
┌──────────────────────────────────────────────────────────────────────┐
│  表现层 (src/, React 19 + TS)                                          │
│  - PillBar / ItemPicker / SettingsPanel / RecordList 组件              │
│  - stores/  (Zustand，仅 UI 状态)                                      │
│  - 只调用 services/ipc.ts 封装，禁止在组件里直接写 invoke/listen         │
└───────────────────────────┬──────────────────────────────────────────┘
                            │  IPC：@tauri-apps/api invoke / listen
                            │  （受 capabilities 白名单管控）
┌───────────────────────────▼──────────────────────────────────────────┐
│  命令层 (src-tauri/src/commands/*)  = 后端「控制器」                    │
│  - 参数反序列化与校验(serde) -> 调 service -> 返回 DTO                    │
│  - 禁止业务规则，禁止直接写 SQL                                         │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  业务层 (src-tauri/src/services/*)                                     │
│  - TimerService    计时状态机：开始/暂停/结束/恢复、时长计算、单条运行约束 │
│  - ItemService     事项增改查/归档                                      │
│  - RecordService   记录查询、汇总统计                                   │
│  - SettingsService 设置读写、快捷键注册、自启联动                        │
│  - 事务编排、业务异常                                                   │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  数据层 (src-tauri/src/repositories/*)                                 │
│  - ItemRepository / RecordRepository / SettingsRepository              │
│  - 仅 SQL 读写 + 行->模型映射，禁止业务逻辑                              │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  基础设施 (SQLite 文件 / OS API)                                        │
│  - SQLite：%APPDATA%\com.timing.app\timing.db（WAL）                  │
│  - Tray / GlobalShortcut / Autostart / WindowState / SingleInstance     │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键架构决策：计时状态机归属 Rust

计时状态机（当前事项、运行状态、开始时间）是**单一事实来源**，放在 Rust 业务层，而非前端。理由：

- UI 可能被隐藏、重载（WebView 刷新）时，状态机不受影响；全局热键直接驱动 Rust，无需等前端就绪。
- 崩溃恢复（未闭合记录）在 Rust 启动时即可判定，不依赖前端。
- 前端退化为「渲染 + 发指令」，PillBar 数字每 tick 由前端基于 `started_at` 本地推算，避免高频 IPC。

前端与后端的职责边界：**Rust 拥有领域与持久化，React 只拥有表现。**

### 3.3 目录结构（落地为可执行约束）

```

├── package.json / vite.config.ts / tsconfig.json / index.html
├── src/                                  # 前端（表现层）
│   ├── main.tsx                          # 入口：只挂载 App，无业务
│   ├── App.tsx                           # 根组件：路由/窗口模式分发，薄
│   ├── components/
│   │   ├── pill/
│   │   │   ├── PillBar.tsx               # 药丸条整体（组合以下子件）
│   │   │   ├── MainButton.tsx            # 左侧圆形按钮（开始/暂停图标切换）
│   │   │   ├── TimerDisplay.tsx          # 中间等宽计时数字 00:00
│   │   │   └── NewItemEntry.tsx          # 右侧「新建事项」入口
│   │   ├── item/ItemPicker.tsx           # 事项选择浮层
│   │   ├── settings/SettingsPanel.tsx    # 设置面板
│   │   ├── records/RecordList.tsx        # 记录明细列表
│   │   └── ui/                           # 无业务纯展示件（Button/Icon/Dialog）
│   ├── hooks/
│   │   ├── useTimerTick.ts               # 基于 started_at 的前端 tick
│   │   └── useTauriEvent.ts              # 事件订阅封装
│   ├── stores/
│   │   ├── timerStore.ts                 # 计时 UI 状态
│   │   ├── itemStore.ts                  # 事项 UI 状态
│   │   └── settingsStore.ts              # 设置 UI 状态
│   ├── services/
│   │   └── ipc.ts                        # 唯一 invoke/listen 出口（禁散落 invoke）
│   ├── lib/
│   │   ├── format.ts                     # 秒->mm:ss/hh:mm:ss 纯函数
│   │   └── icons.ts                      # lucide 图标集中导出与尺寸约定
│   ├── types/
│   │   └── domain.ts                     # Item/TimeRecord/Settings 类型（与 Rust DTO 对齐）
│   └── styles/                           # 深色主题 token、等宽数字字体设定
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json         # 权限白名单（窗口/tray/shortcut/sql...）
    ├── icons/                            # 托盘 + 应用图标（png/ico）
    └── src/
        ├── main.rs                       # 进程入口：仅调用 lib::run()
        ├── lib.rs                        # 装配：只注册插件/命令/托盘/热键，无业务
        ├── state.rs                      # 共享 AppState（Mutex<TimerState> 等）
        ├── error.rs                      # 统一错误类型 -> 可序列化错误码
        ├── commands/
        │   ├── mod.rs
        │   ├── item_cmd.rs
        │   ├── timer_cmd.rs
        │   ├── record_cmd.rs
        │   ├── settings_cmd.rs
        │   └── system_cmd.rs             # 托盘/自启/窗口操作
        ├── services/
        │   ├── mod.rs
        │   ├── timer_service.rs
        │   ├── item_service.rs
        │   ├── record_service.rs
        │   └── settings_service.rs
        ├── repositories/
        │   ├── mod.rs
        │   ├── item_repo.rs
        │   ├── record_repo.rs
        │   └── settings_repo.rs
        ├── models/
        │   └── *.rs                      # 领域模型 + DTO（serde Serialize/Deserialize）
        ├── infra/
        │   ├── db.rs                     # 连接/迁移/PRAGMA
        │   ├── tray.rs                   # 托盘图标+菜单
        │   ├── shortcuts.rs              # 全局快捷键注册/冲突处理
        │   └── window.rs                 # 窗口定位/置顶/拖动/多显示器钳制
        └── migrations/
            └── 0001_init.sql
```

### 3.4 文件组织硬规则（出现即不合格）

| # | 规则 | 不合格表现 |
|---|---|---|
| 1 | 单一职责，一文件一主导出 | 一文件同时放命令+业务+SQL |
| 2 | 单文件 ≤ 300 行（不含空行注释），超限按子功能拆文件 | `lib.rs` 或 `timer_service.rs` 超 300 行 |
| 3 | 按资源分包：一资源 = 命令 + 服务 + 仓库三件套 | 所有命令堆进 `commands.rs` |
| 4 | 入口只装配：`lib.rs` 只挂插件/命令/托盘/热键，无业务逻辑，< 120 行 | 入口里写计时逻辑 |
| 5 | 业务逻辑不进命令处理器：命令只反序列化->调 service->序列化 | `#[tauri::command]` 里几十行 SQL/业务 |
| 6 | 前端禁止组件内直接 `invoke`：统一经 `services/ipc.ts` | 组件里散落 `invoke('start_timer')` |
| 7 | 类型/DTO 独立成文件，不混进逻辑文件 | 模型定义散在 service 里 |
| 8 | 依赖只向下、不反向、不跨层 | 命令层直接 `sqlx::query`；仓库层 import service |

门禁命令（Phase 3 前必跑，任一超限即退回）：

```bash
find src src-tauri/src -name '*.ts' -o -name '*.tsx' -o -name '*.rs' \
  | xargs wc -l | sort -rn | awk '$1>300 && $2!="total" {print "OVER LIMIT:", $0}'
wc -l src-tauri/src/lib.rs src/main.tsx
```

---

## 4. 锁定的 SVG 图标库（P0 强制）

### 4.1 选型结论

**锁定 `lucide-react`，版本 `1.57.0`**（属于 Lucide 图标集，MIT/ISC 许可）。

选型理由：
- **纯 SVG、非字体、非 emoji**：每个图标是独立 SVG 组件，符合团队 P0 规则（禁止 emoji 作为功能图标）。
- **Tree-shakable**：只打包被 import 的图标，对「低占用」目标友好（每图标约 1KB，DeepWiki/npm 口径）。
- **统一设计语言**：24×24 viewBox、默认 2px stroke、`currentColor` 描边，天然适配深色药丸主题，可通过 `size` / `color` / `strokeWidth` 统一控制。
- **TypeScript 一等支持**，与 React 19 兼容（peerDeps 含 `^19.0.0`）。
- 生态默认（shadcn/ui 默认图标集），团队迁移成本低。
- 备选（未锁定，勿混用）：Heroicons、Phosphor、Radix Icons。**全项目只允许 Lucide，禁止混用其它图标库或 emoji。**

### 4.2 图标清单（前端必须按此映射，禁止自造 emoji 替代）

| 用途 | Lucide 图标名 | 说明 |
|---|---|---|
| 开始计时 | `Play` | MainButton 空闲态 |
| 暂停 | `Pause` | MainButton 运行态 |
| 结束记录 | `Square` | 右键/结束动作 |
| 新建事项 | `Plus` | 右侧入口 |
| 事项列表选择 | `ChevronDown` / `List` | ItemPicker 触发/展开 |
| 设置 | `Settings` | 设置入口 |
| 拖动把手 | `GripVertical` | 若需显式把手（否则整条拖动） |
| 计时标识 | `Timer` | 计时区前缀 |
| 归档 | `Archive` | 事项归档 |
| 删除 | `Trash2` | 删除（软删除） |
| 关闭 | `X` | 面板关闭 |
| 托盘菜单：显示/隐藏 | `Eye` / `EyeOff` | 托盘菜单 |
| 托盘菜单：退出 | `LogOut` | 托盘菜单 |
| 完成/确认 | `Check` | 表单确认 |
| 列表更多 | `MoreHorizontal` | 记录项操作 |
| 固定/置顶 | `Pin` | 设置项 |

### 4.3 依赖清单（必须写入前端 `package.json`）

```jsonc
// 前端依赖（节选，图标库为 P0 锁定项）
"dependencies": {
  "react": "19.3.0",
  "react-dom": "19.3.0",
  "@tauri-apps/api": "2.12.4",
  "@tauri-apps/plugin-sql": "2.4.1",
  "@tauri-apps/plugin-store": "^2.0.0",
  "@tauri-apps/plugin-global-shortcut": "^2.0.0",
  "@tauri-apps/plugin-autostart": "^2.0.0",
  "@tauri-apps/plugin-window-state": "^2.0.0",
  "@tauri-apps/plugin-single-instance": "^2.0.0",
  "zustand": "^5.0.0",
  "lucide-react": "1.57.0"        // <-- P0 锁定的 SVG 图标库
},
"devDependencies": {
  "@tauri-apps/cli": "^2.12.0",
  "@vitejs/plugin-react": "^6.1.2",
  "vite": "8.3.4",
  "typescript": "^5.9.0"
}
```

```toml
# src-tauri/Cargo.toml（节选）
[dependencies]
tauri = { version = "2.12.4", features = ["tray-icon", "image-png", "image-ico"] }
tauri-plugin-sql = { version = "2.5.0", features = ["sqlite"] }
tauri-plugin-store = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-autostart = "2"
tauri-plugin-window-state = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
chrono = { version = "0.4", features = ["serde"] }
```

---

## 5. 核心技术可行性验证（逐项结论）

> 优先级对齐 PRD v1：`[MVP]` = PRD 的 P0（P0-1..P0-4），必须在 MVP 交付；`[P1]` = PRD 的 P1，架构已预置能力，按 PRD 排期交付（不阻塞 MVP 闭环）。
> 注意：团队简报把「全局快捷键 / 系统托盘 / 开机自启 / 多显示器」列为关键技术诉求，而 PRD 将其排在 P1。本架构对全部能力做**预置设计**，MVP 是否纳入由 team-lead 与 PM 最终裁定（见 §11 待裁决项 A-1）。

| # | 技术点 | 优先级 | 结论 | 实现路径 | 风险/备注 |
|---|---|---|---|---|---|
| F-1 | 无边框 + 始终置顶 + 任务栏不显示的悬浮窗 | [MVP] | **可行（一等支持）** | `tauri.conf.json` 窗口配置：`decorations:false`、`alwaysOnTop:true`、`transparent:true`、`skipTaskbar:true`、`resizable:false`、`shadow:false`、`visible:false`（就绪后再 show）。Windows 透明窗口建议启用 `noRedirectionBitmap` 消除白闪 | 需 `visible:false` 首帧规避闪烁（K-1） |
| F-2 | 全局快捷键（显示/隐藏、开始/暂停、结束、新建） | [P1] | **可行（官方插件）** | `tauri-plugin-global-shortcut`，在 Rust `.setup()` 中预注册（不受前端刷新影响）；`Shortcut::new` + `register`，`with_handler` 分发 | **注册可能静默失败**（被占用），必须 match Err 并提示+可配置（K-4） |
| F-3 | 系统托盘图标 + 菜单 + 单击显隐 | [P1] | **可行（内建）** | 启用 `tray-icon` feature，`TrayIconBuilder` + `MenuBuilder`（显示/隐藏、新建事项、设置、退出）；`on_tray_icon_event` 处理左键单击显隐；`show_menu_on_left_click(false)` | 关闭窗口需拦截为「隐藏」，否则退出应用（K-6） |
| F-4 | 开机自启 | [P1] | **可行（官方插件）** | `tauri-plugin-autostart`（Windows 写 HKCU Run 注册表项）；`enable()/disable()/is_enabled()`；作为设置项暴露 | 需在 `capabilities` 放行 `autostart:allow-*`（K-5） |
| F-5 | 多显示器 / 记住窗口位置 | [MVP 基础 / P1 外观] | **可行（官方插件 + 钳制逻辑）** | `tauri-plugin-window-state`（`StateFlags` 存位置/尺寸）；自定义钳制：恢复时按显示器 work_area 校验，越界回落到主屏 | **DPI 陷阱**：move/resize 事件为物理像素，逻辑坐标需除 `scaleFactor`；跨 DPI 移动会被系统异步缩放（K-7） |
| F-6 | 本地数据持久化（SQLite） | [MVP] | **可行（官方插件）** | `tauri-plugin-sql`（sqlx）+ 迁移（`Migration`/`MigrationKind::Up`）；启用 WAL；DB 落在 `AppConfig`/`AppData` 目录 | 需在 `capabilities` 放行 `sql:allow-*`；注意迁移幂等（K-5、K-9） |
| F-7 | 窗口拖动（自定义标题栏拖拽） | [MVP] | **可行** | pill 容器加 `data-tauri-drag-region`，并在 `capabilities/default.json` 授予 `core:window:allow-start-dragging` | 忘授权则拖动失效（K-3） |
| F-8 | 崩溃恢复（未闭合/待确认记录） | [MVP] | **可行** | 启动时查询 `status IN ('active','draft')` 的记录：提示用户「继续 / 现在结束 / 丢弃」；运行中每 15s 落盘 `accumulated_sec`，保证丢失时长 ≤ 30s | 需在 DB 索引上支持快速定位（见 §6.3） |
| F-9 | 单实例（防多开重复计时） | [MVP] | **可行（官方插件）** | `tauri-plugin-single-instance`：二次启动时聚焦已有实例 | 多开会导致重复计时与热键注册冲突 |
| F-10 | 低内存低占用 | [MVP] | **可行** | Tauri 系统 WebView2（无内置 Chromium）；前端仅按需 import 图标/组件；计时 tick 用 `requestAnimationFrame` 节流到秒级 | 需实测确认（见 §8 验证） |

### 5.1 不可行警告 / 降级替代

| 警告 | 影响 | 降级/替代方案 |
|---|---|---|
| W-1 **依赖 WebView2 运行时**：Windows 10 早期版本可能未预装 WebView2 | 首次启动白屏/失败 | 打包时使用 `bundle.windows.webviewInstallMode` 内嵌 bootstrapper（`embedBootstrapper` 或离线 `offlineInstaller`，体积略增）；安装时检测并引导安装 |
| W-2 **全局快捷键可能被系统/他应用占用** | 该热键注册失败，功能不可用 | 不静默失败：注册失败即提示并回退到默认备用键；设置面板允许自定义（K-4） |
| W-3 **未签名 exe 触发 SmartScreen「未知发布者」** | 用户安装有心理阻力 | MVP 可先不签名（内测）；正式分发建议 OV 证书（约 ¥1200-2800/年）或 EV（约 ¥2000-6600/年，立获 SmartScreen 信任） |
| W-4 **透明窗口在部分显卡/远程桌面下渲染异常** | 药丸可能显示为黑底或锯齿 | 提供「关闭透明度」降级开关（设置项），回落到纯色圆角矩形 |

> 上述 W-1..W-4 均**不影响主链路可行性**，但必须在 Phase 2 的实现要求中显式处理，不得忽略。

---

## 6. 数据模型设计

### 6.1 ER 图

```
┌────────────────────────┐            ┌──────────────────────────────┐
│        items           │            │         time_records          │
│  事项（归类主体）        │ 1        n │  时间记录（一次计时会话）        │
├────────────────────────┤◄───────────├──────────────────────────────┤
│ id            INTEGER  │            │ id            INTEGER        │
│ name          TEXT     │            │ item_id       INTEGER  (FK)  │
│ color         TEXT     │            │ status        TEXT           │
│ status        TEXT     │            │ started_at    INTEGER        │
│ is_system     INTEGER  │            │ ended_at      INTEGER NULL   │
│ sort_order    INTEGER  │            │ accumulated_sec INTEGER      │
│ created_at    INTEGER  │            │ running_since INTEGER NULL   │
│ updated_at    INTEGER  │            │ note          TEXT NULL      │
│ deleted_at    INTEGER  │            │ created_at    INTEGER        │
└────────────────────────┘            │ updated_at    INTEGER        │
                                      │ deleted_at    INTEGER        │
                                      └──────────────────────────────┘

┌────────────────────────┐
│       settings         │   键值配置（快捷键、自启、透明度、显示器等）
├────────────────────────┤
│ key           TEXT PK  │
│ value         TEXT     │   -- JSON 文本
│ updated_at    INTEGER  │
└────────────────────────┘
```

关系：`items 1 ── n time_records`（一个事项下多条时间记录）。

**关键语义（对齐 PRD v1 §5 / §9）**：

1. `items.is_system = 1` 表示系统内置事项。首启迁移时插入一条固定记录 **`未归类`**（`id=1, is_system=1`），用于 PRD P0-2「无事项时以未归类承接」。系统事项**不可删除、不可归档**，但可改名。
2. `time_records.status` 取值 `'active' | 'draft' | 'saved'`，表示一次计时会话的生命周期：
   - `active`：会话进行中（`ended_at` 为 NULL）。`running_since` 非 NULL = 正在计时；为 NULL = **已暂停但会话未结束**（PRD P0-1 #3/#4：左键暂停只冻结数字，不产生记录）。
   - `draft`：用户右键触发「结束」后进入的**待确认收尾**态（`ended_at` 已填），等待收尾浮层确认（PRD P0-1 #5）。
   - `saved`：收尾浮层确认后落盘为正式记录（可被汇总/列表查询）。
3. `accumulated_sec` 为本次会话累计已计时秒数（暂停/结束时写入）；`running_since` 为当前这一段的起点时间戳（NULL 表示非运行中）。**前端展示的实时数字 = `accumulated_sec` + (now - `running_since`)**，Rust 侧在运行中每 15s 落盘一次 `accumulated_sec` 以满足「崩溃丢失 ≤ 30s」（PRD P0-3 #13）。
4. **全局最多允许一条非 `saved` 的会话**（`active` 或 `draft`），由 TimerService 保证，DB 层用部分唯一索引兜底（索引 I-4）。

### 6.2 表结构

#### 表 `items`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | 主键（未归类固定为 1） |
| name | TEXT | NOT NULL, 长度 1-100 | 事项名称 |
| color | TEXT | NULL | 标签色（如 `#4F7DF3`），NULL 表示用主题默认 |
| status | TEXT | NOT NULL DEFAULT `'active'`, CHECK in ('active','archived') | 状态 |
| is_system | INTEGER | NOT NULL DEFAULT 0, CHECK in (0,1) | 1=系统内置（未归类），不可删除/归档 |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | 排序权重（手动排序用） |
| created_at | INTEGER | NOT NULL | epoch 毫秒 |
| updated_at | INTEGER | NOT NULL | epoch 毫秒 |
| deleted_at | INTEGER | NULL | 软删除时间戳，NULL=未删 |

#### 表 `time_records`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | 主键 |
| item_id | INTEGER | NOT NULL, FK -> items(id) | 归属事项（未归类=1） |
| status | TEXT | NOT NULL DEFAULT `'active'`, CHECK in ('active','draft','saved') | 会话状态（见 §6.1） |
| started_at | INTEGER | NOT NULL | 会话首次开始时间 epoch 毫秒 |
| ended_at | INTEGER | NULL | 会话结束时间；`active` 时为 NULL |
| accumulated_sec | INTEGER | NOT NULL DEFAULT 0, CHECK (>=0) | 累计已计时秒数（暂停/结束时写入） |
| running_since | INTEGER | NULL | 当前计时段起点；NULL=非运行中（暂停态） |
| note | TEXT | NULL, 长度 ≤ 500 | 可选备注 |
| created_at | INTEGER | NOT NULL | |
| updated_at | INTEGER | NOT NULL | |
| deleted_at | INTEGER | NULL | 软删除 |

约束（业务/DB 双重保障）：
- 时间不变式：`ended_at IS NULL OR ended_at >= started_at`。
- 状态与字段一致性：`status = 'active'` <=> `ended_at IS NULL`；`status <> 'active'` <=> `ended_at IS NOT NULL`。
- 单条会话：应用层保证同时最多一条 `status IN ('active','draft')` 的记录；DB 层用部分唯一索引兜底（见索引 I-4）。

#### 表 `settings`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| key | TEXT | PK | 配置键（如 `shortcut.toggle`） |
| value | TEXT | NOT NULL | 值（JSON 编码） |
| updated_at | INTEGER | NOT NULL | |

预置键：`shortcut.toggle` / `shortcut.start_pause` / `shortcut.stop` / `shortcut.new_item` / `autostart.enabled` / `ui.opacity` / `ui.last_display_id` / `ui.panel_expanded` / `schema.version`。

### 6.3 索引清单

| # | 索引 | 定义 | 用途 |
|---|---|---|---|
| I-1 | `idx_items_status` | `(status)` | 过滤 active/archived 事项列表 |
| I-2 | `idx_records_item_id` | `(item_id)` | 按事项查记录（外键查询） |
| I-3 | `idx_records_started_at` | `(started_at)` | 按时间范围查询/统计（今日、本周） |
| I-4 | `uq_records_open` | `UNIQUE (status) WHERE status IN ('active','draft')` | 兜底「同时仅一条非 saved 会话」 |
| I-5 | `idx_records_item_started` | `(item_id, started_at)` | 事项维度时间区间查询 |
| I-6 | `idx_records_status` | `(status)` | 崩溃恢复时快速定位 `active/draft` 会话 |

> MVP 阶段不建冗长复合索引；I-5 用于「单事项统计」热点，先建。

### 6.4 初始化迁移（`migrations/0001_init.sql` 摘要）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  color       TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

-- 系统内置「未归类」事项（PRD P0-2 承接用）
INSERT OR IGNORE INTO items (id, name, color, status, is_system, sort_order, created_at, updated_at)
VALUES (1, '未归类', NULL, 'active', 1, 0, CAST(strftime('%s','now') AS INTEGER)*1000, CAST(strftime('%s','now') AS INTEGER)*1000);

CREATE TABLE IF NOT EXISTS time_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES items(id),
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','saved')),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  accumulated_sec INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_sec >= 0),
  running_since   INTEGER,
  note            TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((status = 'active') = (ended_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_records_item_id      ON time_records(item_id);
CREATE INDEX IF NOT EXISTS idx_records_started_at   ON time_records(started_at);
CREATE INDEX IF NOT EXISTS idx_records_item_started ON time_records(item_id, started_at);
CREATE INDEX IF NOT EXISTS idx_records_status       ON time_records(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_open   ON time_records(status) WHERE status IN ('active','draft');

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 7. 接口契约（Tauri IPC Command Contract）

> 本项目**无 HTTP 后端、无 REST**。前后端契约 = Tauri `invoke` 命令入参/出参 + Rust `emit` 事件。此节即本项目的「API 文档」，是 Phase 2 前后端联调的唯一依据；Phase 2 需据此产出对应的 TypeScript 类型定义（`src/types/domain.ts`）。

### 7.1 统一返回格式

所有命令返回 `Result<T, AppError>`。错误序列化为：

```jsonc
// 失败
{ "code": "ITEM_NAME_EMPTY", "message": "事项名称不能为空" }
```

错误码清单：

| code | 触发条件 | 前端处理 |
|---|---|---|
| `DB_ERROR` | 数据库读写失败 | 提示「数据保存失败」，记录日志 |
| `ITEM_NOT_FOUND` | 事项不存在/已删除 | 刷新列表 |
| `ITEM_NAME_EMPTY` | 名称为空 | 表单内联提示 |
| `ITEM_NAME_DUPLICATE` | 名称重复（同 active 状态） | 表单内联提示，并提供「直接使用该事项」 |
| `ITEM_SYSTEM_PROTECTED` | 尝试删除/归档系统事项（未归类） | 置灰对应操作，提示不可删除 |
| `TIMER_ALREADY_RUNNING` | 已有非 saved 会话仍尝试开始 | 忽略/提示先结束 |
| `TIMER_NOT_RUNNING` | 无 active 会话却调暂停/继续 | 忽略并同步状态 |
| `TIMER_NO_DRAFT` | 无 draft 会话却调确认/取消收尾 | 忽略并同步状态 |
| `SHORTCUT_REGISTER_FAILED` | 热键被占用注册失败 | 提示并允许改键 |
| `INVALID_DURATION` | 结束时间早于开始时间 | 兜底丢弃该记录 |
| `IO_ERROR` | 文件/系统调用失败 | 通用错误提示 |

### 7.2 命令清单（Rust `#[tauri::command]`）

| 命令 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `list_items` | `{ includeArchived: boolean }` | `Item[]` | 事项列表（按 sort_order, name） |
| `create_item` | `{ name: string, color?: string }` | `Item` | 新建事项 |
| `update_item` | `{ id, patch: { name?, color?, sortOrder? } }` | `Item` | 部分更新 |
| `archive_item` | `{ id }` | `Item` | 归档 |
| `unarchive_item` | `{ id }` | `Item` | 取消归档 |
| `delete_item` | `{ id }` | `void` | 软删除（保留其记录） |
| `start_timer` | `{ itemId }` | `TimeRecord` | 开始一次新会话（无事项时传 1=未归类）。要求当前无非 saved 会话 |
| `pause_timer` | `{}` | `TimeRecord` | 暂停：`accumulated_sec += now - running_since`，`running_since = null`；会话仍为 `active`，**不产生记录** |
| `resume_timer` | `{}` | `TimeRecord` | 继续：`running_since = now`（对暂停中的 active 会话） |
| `stop_timer` | `{}` | `TimeRecord` | 右键结束：会话置 `draft`，`ended_at = now`，冻结 `accumulated_sec`，触发收尾浮层 |
| `confirm_stop` | `{ itemId?: number, note?: string }` | `TimeRecord` | 收尾浮层「保存」：置 `saved`，可改事项/备注（PRD P0-1 #5） |
| `cancel_stop` | `{}` | `TimeRecord` | 收尾浮层「取消」：会话回到 `active`（暂停态），保留会话不丢数据（PRD P0-1 #6） |
| `get_timer_state` | `{}` | `TimerState` | 当前状态（含 active/draft 会话与实时累计时长） |
| `switch_item` | `{ itemId, mode: 'end_and_start' \| 'just_switch' }` | `TimerState` | 计时中换事项：按分段（结束当前并开新）或仅改归属（PRD P0-2 #9） |
| `create_manual_record` | `{ itemId, startedAt, endedAt, note? }` | `TimeRecord` | [P1] 补录一条被忘记的记录（PRD P1-2） |
| `update_record` | `{ id, patch: { itemId?, startedAt?, endedAt?, note? } }` | `TimeRecord` | [P1] 编辑记录事项/时长/备注 |
| `delete_record` | `{ id }` | `void` | 软删除单条记录 |
| `list_records` | `{ itemId?, from?, to?, page, limit }` | `Paginated<TimeRecord>` | 记录明细分页（仅 `saved`） |
| `stats_summary` | `{ itemId?, from?, to? }` | `StatsSummary` | 合计时长/条数（仅 `saved`） |
| `export_records_csv` | `{ itemId?, from?, to? }` | `{ path: string }` | [P1] 导出 CSV 到用户选择路径（PRD P1-5） |
| `resolve_open_record` | `{ action: 'resume'\|'close'\|'discard', endAt? }` | `TimeRecord \| null` | 崩溃恢复：处理启动时发现的 active/draft 会话（PRD P0-3 #13） |
| `get_settings` | `{}` | `Settings` | 读取全部设置 |
| `update_settings` | `{ patch: Partial<Settings> }` | `Settings` | 更新设置（含联动注册热键/自启） |
| `set_autostart` | `{ enabled: boolean }` | `boolean` | 开关开机自启，返回实际状态 |
| `get_autostart` | `{}` | `boolean` | 查询自启状态 |
| `register_shortcut` | `{ action: ShortcutAction, accelerator: string }` | `boolean` | 注册/改键，失败返回 false |
| `show_window` / `hide_window` / `toggle_window` | `{}` | `void` | 悬浮条显隐 |
| `set_always_on_top` | `{ enabled: boolean }` | `void` | 置顶开关 |
| `save_window_position` | `{ x: number, y: number }` | `void` | 记录位置（逻辑像素） |
| `quit_app` | `{}` | `void` | 退出（托盘菜单用） |

### 7.3 DTO 形状（JSON Schema 摘要）

```jsonc
// Item
{ "id": 1, "name": "写方案", "color": "#4F7DF3", "status": "active",
  "isSystem": false, "sortOrder": 0, "createdAt": 1760000000000, "updatedAt": 1760000000000 }

// TimeRecord（含会话字段）
{ "id": 10, "itemId": 1, "status": "saved",          // "active" | "draft" | "saved"
  "startedAt": 1760000000000, "endedAt": 1760000180000,
  "accumulatedSec": 180, "runningSince": null, "note": null }

// TimerState
{ "status": "idle",             // "idle" | "running" | "paused" | "draft"
  "session": null,              // TimeRecord | null（active/draft 时非空）
  "lastItemId": 1 }

// Paginated<T>
{ "items": [], "total": 100, "page": 1, "limit": 20, "hasMore": true }

// StatsSummary
{ "totalSec": 5400, "recordCount": 12, "byItem": [ { "itemId": 1, "totalSec": 3600 } ] }
```

> 契约一致性：前端 `src/types/domain.ts` 的字段名（camelCase）必须与 Rust DTO 通过 serde `#[serde(rename_all = "camelCase")]` 严格对齐；任何字段增删改必须先改本契约再改两端代码（规格即契约）。

### 7.4 事件（Rust -> 前端 `emit`）

| 事件名 | Payload | 触发时机 |
|---|---|---|
| `timer:state-changed` | `TimerState` | 开始/暂停/恢复/结束/恢复处理 |
| `shortcut:triggered` | `{ action: ShortcutAction }` | 全局热键按下 |
| `tray:toggle-visibility` | `{}` | 托盘点击显隐 |
| `app:open-settings` | `{}` | 托盘/热键要求打开设置 |
| `app:open-new-item` | `{}` | 托盘/热键要求新建事项 |

`ShortcutAction` 枚举：`toggle_window` | `start_pause` | `stop` | `new_item`。

### 7.5 默认全局快捷键（可配置，需处理冲突）

| 动作 | 默认加速键 | 备注 |
|---|---|---|
| 显示/隐藏悬浮条 | `CommandOrControl+Alt+T` | 避开系统保留键 |
| 开始/暂停 | `CommandOrControl+Alt+S` | |
| 结束当前记录 | `CommandOrControl+Alt+E` | |
| 新建事项 | `CommandOrControl+Alt+N` | |

> 加速键字符串大小写敏感：修饰键小写（`CommandOrControl` / `Control` / `Alt` / `Shift` / `Super`），主键按文档规范（注意 `Code::` 枚举）。禁止使用 `Ctrl+Alt+Delete` 等系统保留组合。

---

## 8. 端到端验证步骤（Phase 3 验收用）

环境：Windows 11 23H2，WebView2 已安装，Rust ≥1.90，Node ≥22.12。

```bash
# 1. 构建
cd timing
npm install
npm run tauri build          # 产出 NSIS/MSI 安装包
# 或开发态：npm run tauri dev

# 2. 启动并核验窗口形态
#   - 启动后出现深色药丸条，无边框、无标题栏，始终置顶
#   - 任务栏不出现该应用图标（skipTaskbar 生效）
#   - 系统托盘出现图标

# 3. 核心闭环（成功流）
#   - 点「新建事项」输入「写方案」-> 事项出现在选择器并成为当前事项
#   - 左键 MainButton -> 数字开始跳动（00:00 -> 递增，等宽字体不抖动），按钮变暂停图标
#   - 再次左键 -> 暂停：数字停住，按钮回到播放图标（此时【不生成记录】，会话仍 active）
#   - 再次左键 -> 从暂停值继续累加（PRD P0-1 #4）
#   - 右键计时区 -> 结束并弹出收尾浮层（默认归属「写方案」），点「保存」-> 生成一条 saved 记录
#   - 打开记录列表 -> 见到「写方案」的记录，时长 = 实际累计时长（误差 ≤1s）

# 3b. 未归类与收尾取消（PRD P0-2 #10 / P0-1 #6）
#   - 无任何事项时直接开始计时 -> 归属自动落到系统事项「未归类」(id=1)
#   - 右键结束 -> 收尾浮层点「取消」-> 会话保留为暂停态，数字不丢，可继续
#   - 收尾浮层点「保存」前把事项改为「写方案」-> 记录正确归到新事项

# 4. 关键错误/边界流
#   - 无 active/draft 会话时按「结束」-> 不报错崩溃，状态保持 idle
#   - 新建空名称事项 -> 内联错误提示 ITEM_NAME_EMPTY，不写入
#   - 尝试删除系统事项「未归类」-> 被拒（ITEM_SYSTEM_PROTECTED），不删除
#   - 手动占用 CommandOrControl+Alt+T（用他程序注册）后启动 -> 提示注册失败，可改键

# 5. 系统集成
#   - 关闭窗口（若存在关闭路径）-> 应用退到托盘而非退出
#   - 托盘左键单击 -> 悬浮条显隐切换
#   - 设置中开启开机自启 -> 注册表 HKCU\...\Run 出现条目；重启后自动启动

# 6. 多显示器 / DPI
#   - 拖动药丸到副屏 -> 重启应用 -> 位置恢复到副屏
#   - 100% 与 150% 缩放显示器间移动 -> 药丸尺寸与位置无异常放大/偏移

# 7. 崩溃恢复
#   - 计时运行中强杀进程 -> 重启 -> 弹出「恢复/结束/丢弃」三选一，行为正确

# 8. 资源占用
#   - 空闲态任务管理器核验：内存 < 60MB 目标；冷启动 < 1s
```

通过判据：以上 1-8 全部通过 + 文件组织门禁（§3.4）无超限 + 无回归。

---

## 9. 已知坑（内嵌为硬约束，Phase 2 必须遵守）

| # | 坑 | 硬约束 |
|---|---|---|
| K-1 | 透明+无边框窗口创建瞬间白闪 | 窗口配置 `visible:false`，等前端首帧渲染完成后再 `show()`；Windows 可加 `noRedirectionBitmap:true` |
| K-2 | `data-tauri-drag-region` 不生效 | `capabilities/default.json` 必须含 `core:window:allow-start-dragging` |
| K-3 | 全局热键注册**静默失败**（被占用无报错） | 必须 `match ... { Err(e) => 提示并回退 + 允许改键 }`，禁止 `unwrap()` |
| K-4 | 忘记在 capabilities 放行插件命令 -> 运行时被拒 | 所有用到的插件（sql/global-shortcut/autostart/window-state/store/single-instance）逐项放行 |
| K-5 | 关闭主窗口导致进程退出（托盘失效） | 拦截 `CloseRequested` -> `hide()`；仅在托盘「退出」时 `app.exit(0)` |
| K-6 | 多显示器 DPI 换算错误导致位置漂移 | move/resize 事件是**物理像素**，存逻辑坐标需除 `scaleFactor`；恢复时按显示器 work_area 钳制，越界回落主屏 |
| K-7 | 迁移非幂等导致重复建表报错 | 迁移 SQL 全部 `IF NOT EXISTS`；`schema.version` 记录版本，按序执行 |
| K-8 | 事件订阅泄漏（WebView 重载后旧监听残留） | `listen()` 返回的 unlisten 必须在 `useEffect` 清理函数中调用 |
| K-9 | WebView2 未安装导致白屏 | 打包内嵌 WebView2 bootstrapper |
| K-10 | Rust MSRV 不符导致编译失败 | 锁定 rustc ≥ 1.90（tauri 2.12.4 edition 2024 要求） |
| K-11 | 前端散落 `invoke` 难维护/漏错误处理 | 统一经 `src/services/ipc.ts`，集中 try/catch 与错误码映射 |
| K-12 | 按「通用印象」写 API 签名（幻觉） | 一切以锁定版本（§2.4）官方文档为准；改依赖必须同步更新本文档 |

---

## 10. 技术约束清单（汇总）

1. 平台：Windows 优先（Win10 1903+ / Win11）；依赖 WebView2 运行时。
2. 网络：**零网络请求**，全离线；不得引入任何远程调用。
3. 存储：单机 SQLite 文件，路径 `%APPDATA%\com.timing.app\`；启用 WAL、`foreign_keys=ON`；首启种入系统事项「未归类」(id=1, is_system=1)，不可删除/归档。
4. 单实例运行：由 `single-instance` 插件保证。
5. 图标：**唯一使用 `lucide-react@1.57.0`**；禁止 emoji 图标、禁止混用其它图标库。
6. 体积/占用目标：安装包 < 8MB；空闲内存 < 60MB；冷启动 < 1s。
7. 安全：`capabilities` 最小权限白名单；CSP 收紧（`default-src 'self'`）。
8. 代码组织：单文件 ≤ 300 行；入口只装配；按资源分包；依赖只向下（§3.4）。
9. 版本锚定：所有依赖按 §2.4 实际版本写，不按印象写。
10. 分发：NSIS/MSI 安装包；未签名会触发 SmartScreen 提示（可选 OV/EV 证书）。

---

## 11. 交付物与下一步

### 11.1 待裁决项（需 team-lead / PM 确认，不阻塞 Phase 2 启动）

| # | 待裁决问题 | 冲突点 | 架构侧建议 |
|---|---|---|---|
| A-1 | 全局快捷键 / 系统托盘 / 开机自启 是否纳入 MVP | 团队简报列为关键技术诉求；PRD v1 将其排在 P1 | 三项均已在架构预置且实现成本低（F-2/F-3/F-4），建议至少把「系统托盘 + 开机自启」纳入 MVP（P1-1 RICE=6.00 最高，且无托盘的常驻应用体验缺失明显）；全局快捷键可放 P1 |
| A-2 | 计时数字展示格式跨小时 | PRD §10 要求 >00:59:59 进 HH:MM:SS | 前端 `format.ts` 统一：<1h 用 MM:SS，≥1h 用 HH:MM:SS，pill 宽度自适应 |
| A-3 | 收尾浮层是否可省略（一键保存） | PRD §12 Open Decision | 建议 MVP 默认「保存 = 当前事项 + 无备注」一键完成，仅在用户主动展开时才改归属；降低摩擦（对齐「操作摩擦=1 次点击」指标） |
| A-4 | 悬浮条默认停靠位置与尺寸 | PRD §12 Open Decision | 建议默认右下角（贴边，距边 24px），尺寸约 168x44px（含 padding），由设计师给定最终值 |
| A-5 | 本地统计事件是否在 MVP 落地 | PRD 第 11 节标记 P1，默认关闭 | 建议 P1 再实现，MVP 不采集（保持零遥测叙事干净） |

### 11.2 本 Phase 1 产出物

- `docs/phase1/ARCHITECTURE-v1.md`（本文档）
- `docs/decisions/ADR-001.md` 桌面框架选型
- `docs/decisions/ADR-002.md` 前端框架与状态管理
- `docs/decisions/ADR-003.md` 本地数据存储方案
- `docs/decisions/ADR-004.md` 图标库选型
- `docs/decisions/ADR-005.md` 系统集成（托盘/热键/自启/窗口状态）
- `docs/decisions/ADR-006.md` 打包与代码签名策略

Phase 2 需要做的：
1. 依据 §7 生成 `src/types/domain.ts`（前端 TS 类型）与 Rust DTO（serde），确保字段名一致（camelCase vs snake_case 需在 serde 上统一 `rename_all`）。
2. 依据 §6 落实迁移文件与 repository。
3. 实现 §5 的 F-1..F-10，逐项满足 §9 硬约束。
4. 用 §8 端到端步骤做验收。

---

## 参考来源（联网核实，2026-10-16）

- Tauri 官方 v2 文档与配置 Schema：https://v2.tauri.app/ 、https://schema.tauri.app/config/2
- Tauri Core Releases（版本历史）：https://v2.tauri.app/release/core
- tauri crate 版本：crates.io/api/v1/crates/tauri（稳定版 2.12.4）
- Tauri 全局快捷键插件：https://tauri.app/plugin/global-shortcut/ 、https://tauri-v2.netlify.app/plugin/global-shortcut/
- Tauri 开机自启插件：https://v2.tauri.app/plugin/autostart/
- Tauri SQL 插件：https://crates.io/crates/tauri-plugin-sql（2.5.0）、@tauri-apps/plugin-sql（2.4.1）
- Tauri 窗口状态插件说明：https://v2.tauri.app/plugin/window-state/
- 托盘定时器实战（Tauri 2 menu-bar timer）：https://www.codegiz.com/blog/tauri-patterns-episode-10-build-a-menu-bar-timer-in-tauri-2
- Tauri 多窗口与托盘指南：https://www.oflight.co.jp/en/columns/tauri-v2-multi-window-system-tray
- 全局快捷键正确用法：https://dev.to/hiyoyok/global-keyboard-shortcuts-in-tauri-v2-the-right-way-and-the-wrong-way-2h6d
- 桌面框架体积/内存基准：https://johal.in/bundle-size-benchmark-tauri-20-vs-electron-32
- Lucide 图标库：https://lucide.dev 、lucide-react@1.57.0（registry.npmjs.org）
- React 19.3 发布说明：https://react.dev/blog/2026/09/09/react-19-3
- Vite 8.3.4（registry.npmjs.org）、@vitejs/plugin-react ^6.1.2
- Windows 代码签名证书价格参考（OV/EV）：行业公开报价汇总（Certum/GlobalSign/DigiCert）
- .NET WPF/WinUI 置顶与全局热键实践：https://juejin.cn/post/7467200003524067354 、https://deepwiki.com/jayfunc/BetterLyrics/4.5-system-tray-and-global-controls

---

## 12. 决议记录（2026-10-16）

> 本节为文件末尾**追加**记录（不修改上文本正），汇总 Phase 1 列出、经用户于 2026-10-16 确认三文档时裁决的待裁决项 A-1..A-5 最终结论，以及由此产生的对 §6 数据模型 / §7 接口契约的偏离说明。**权威以 `docs/Spec-v1.md` §13 变更记录、`docs/phase2/IPC-CONTRACT-v2.md`、`docs/phase2/schema.sql`、`ADR-007`、`ADR-008` 为准。**

### 12.1 A-1..A-5 最终结论

| 编号 | 议题 | 最终结论 | 主要影响 |
|---|---|---|---|
| A-1 | 全局快捷键 / 系统托盘 / 开机自启 是否纳入 MVP | **系统托盘 + 开机自启纳入 MVP（P0-5 / P0-6）**；全局快捷键**仍留 P1** | 新增 §5 F-3/F-4 为 MVP；命令 `set_autostart`/`get_autostart` 属 MVP，`register_shortcut` 标 [P1]；见 ADR-008 |
| A-2 | 计时数字展示格式跨小时 | **`<1h` 用 `MM:SS`；`≥1h` 用 `HH:MM:SS`**（`min-width` 切 8ch，上限 `99:59:59`） | 前端 `lib/format.ts` 统一实现；药丸宽度自适应 |
| A-3 | 收尾浮层是否可省略（一键保存） | **一键保存**：右键单击 → 立即 `saved` + 3 秒撤销条；**移除 `draft` 态与收尾浮层** | 数据模型去 `draft`；契约删 `confirm_stop`/`cancel_stop`、增 `undo_stop`；AC-05/06/07 重写；见 ADR-007 |
| A-4 | 悬浮条默认停靠位置与尺寸 | **默认右下角，距屏幕边 16 DIP**；吸附阈值 16 DIP；绘制于固定 384×360 DIP 透明置顶层内 | §10 平台特化；AC-23；与设计 §9 口径统一 |
| A-5 | 本地匿名统计是否在 MVP 落地 | **维持 P1，MVP 不采集任何统计**（保持零遥测叙事干净） | AC-26 标 P1；不引入采集代码 |

### 12.2 对 §6 / §7 正文的偏离说明（均已由 Spec §13 覆盖）

> 下列偏离是 A-3 的直接结果。§6 / §7 正文保留原样以留痕，**实现与联调一律以标注的权威替代物为准**。

| 正文位置 | 原内容 | 变更后（锁定） |
|---|---|---|
| §6.1 关键语义 #2 | `status` 取值 `'active' \| 'draft' \| 'saved'` | `'active' \| 'saved'`（去 `draft`） |
| §6.2 `time_records.status` 约束 | `CHECK in ('active','draft','saved')` | `CHECK in ('active','saved')` |
| §6.3 索引 I-4 `uq_records_open` | `UNIQUE(status) WHERE status IN ('active','draft')` | `UNIQUE(status) WHERE status='active'` |
| §6.4 迁移 SQL `0001_init.sql` | 含 `draft` 的 CHECK 与索引 | 见 `docs/phase2/schema.sql`（权威） |
| §7.2 命令 `stop_timer` | 置 `draft`，触发收尾浮层 | 立即置 `saved`，开启撤销窗口 |
| §7.2 命令 `confirm_stop` / `cancel_stop` | 存在 | **删除** |
| §7.2 命令（新增） | — | **`undo_stop({ recordId })`**：`saved` 回滚为 `active` |
| §7.1 错误码 `TIMER_NO_DRAFT` | 存在 | 替换为 **`TIMER_NO_UNDO`** |
| §7.3 `TimerState.status` | `'idle' \| 'running' \| 'paused' \| 'draft'` | `'idle' \| 'running' \| 'paused'`（去 `draft`） |
| §7.3 `TimerState` 字段 | 无实时时长字段 | 新增 `liveDurationSec`（服务端快照，见 IPC-CONTRACT-v2 §5.3） |
| §7.2 `create_manual_record` / `export_records_csv` | 混在主命令表 | 移入「P1 预留」，不属 MVP 契约 |

### 12.3 Phase 2 权威产出物

- `docs/phase2/IPC-CONTRACT-v2.md`：修订后完整 IPC 契约（全部命令 / 11 错误码 / 事件 / DTO）——Phase 3 前后端联调**唯一依据**。
- `docs/phase2/schema.sql`：可直接执行的 SQLite 迁移脚本（幂等，无 `draft` 残留）。
- `src/types/domain.ts`：前端 TS 类型，与 IPC 契约 DTO 严格一一对应。
- `docs/decisions/ADR-007.md`：一键结束并保存 + 撤销机制。
- `docs/decisions/ADR-008.md`：托盘 + 开机自启纳入 MVP。

> §6 / §7 正文的修订（去 `draft`）不再回写本文档正文，以避免历史留痕丢失；以上述权威产出物为准（规格即契约：实现冲突先改 Spec，再改契约，再改代码）。

