# TickBar V0.2.0 批1 交付与核验报告

> 日期：2026-10-16
> 批次：**批1「一眼就是 Timing」**（Wave A 视觉对齐 + Wave B 功能）
> 结论：**批1 完成，全部门禁通过（项目总监独立实测，非采信成员口头结论）**

---

## 一、交付范围（Spec §2 批1 锁定项）

| 编号 | 功能 | 落位 | 状态 |
|------|------|------|------|
| N-8 | 深浅双主题 + system 跟随 | 前端令牌层 + 后端 theme 命令 | 完成 |
| N-1 | 小条随事项名伸缩（宽 116–288，taskW ≤164） | 前端 surfaces.css | 完成 |
| N-9 | 四色可配 | 前端 theme-picker + 后端 accent 命令 | 完成 |
| N-2 | 待办事项（增/改/删/勾选） | 前端 todoStore + 后端 todo 五命令 | 完成 |
| N-10 | 自绘玻璃菜单（应用内 + 键盘导航） | 前端 GlassMenu / ContextMenu | 完成 |
| N-3 | 事项窗口（四状态 + 表头汇总 + 空态） | 前端 TodosWindow/TodosPanel + 后端 open_todos_window | 完成 |
| — | 已保留项视觉对齐（药丸条几何） | 前端 surfaces.css | 完成 |

**批次拆分**：Wave A（令牌 / 双主题 / 四色 / 几何对齐 / 设置面板三页签 / 设置独立窗）+ Wave B（待办 / 事项窗口 / 自绘菜单）。

---

## 二、交付清单

### Wave A · 前端（贾思敏）
- `src/styles/design-tokens.css`（重写，三层 Token 双主题）+ `design-tokens-compat.css`（V0.1.0 过渡别名桥）
- `src/lib/theme.ts` · `src/stores/themeStore.ts` · `src/services/themeActions.ts`
- `index.html`（防白闪内联引导脚本）
- `src/components/settings/{SettingsPanel,SegmentedTabs,GeneralTab,ExtensionsTab,ThemePicker,SwatchRow}.tsx`
- `src/lib/window.ts`（window label 路由 + `showCurrentWindowOnReady` + `closeCurrentWindow`）+ `src/components/settings/SettingsWindow.tsx`
- `src/mocks/browserMockV020.ts`（23 命令）

### Wave A · 后端（贝洛奇）
- `src/infra/migrate.rs`（`0001` → `ensure_column` PRAGMA 守卫 → `0002_v020.sql` → `schema.version=2`）
- `src/migrations/0002_v020.sql`（notes/todos 建表 + 索引 + seed，全 `IF NOT EXISTS`）
- `src/commands/theme_cmd.rs` + `src/services/theme.rs` + `src/models/theme.rs`（四色默认值收敛于 `models/constants.rs`）
- `src/infra/window_spec.rs` + `window.rs::open_settings_window`
- `src/infra/tray_menu.rs` + `tray.rs`（托盘菜单按状态裁剪，保留原生）
- D-03 修复：`models/settings.rs` ↔ `domain.ts` Settings 8 字段对齐
- `tauri-plugin-notification` 2.7.0 注册（仅注册）

### Wave B · 后端（贝洛奇）
- `src/models/todo.rs` · `src/repositories/todo.rs` · `src/services/todo.rs` · `src/commands/todo_cmd.rs` · `src/tests/todo.rs`（15 单测）
- `src/infra/window_spec.rs::TODOS`（336×(360–560)，仅高可调）+ `window.rs::open_todos_window`（抽出 `open_panel_window` 与设置窗共用）
- `capabilities/default.json` windows 追加 `"todos"`

### Wave B · 前端（贾思敏）
- `src/stores/todoStore.ts` · `src/services/todosActions.ts`（含 `openTodosWindow`）· `src/hooks/{useTodayRecords,useRowFocusNav}.ts`
- `src/components/todos/`（12 个组件：TodosWindow/TodosPanel/TodosHeader/TodosEmpty/TodosFooter/TodosRecordRow/TodosPendingRow/TodosTodoSection/TodoMark/TodosItemMenu/InlineEditBar/InlineConfirmBar）
- `src/components/menu/GlassMenu.tsx`（210）+ `ContextMenu.tsx` 重写（玻璃 + 键盘导航 + 「事项窗口」入口）
- `src/styles/{todos-panel,todos-pending,todos-inline,menu}.css`
- `src/App.tsx` 追加 `kind === 'todos'` 分支

---

## 三、独立核验结果（我亲自执行，不采信转述）

| 核验项 | 方法 | 结果 |
|--------|------|------|
| 后端单元/集成测试 | `cargo test -j 2` | **122 passed / 0 failed / EXIT=0** |
| 后端格式 | `cargo fmt --check` | EXIT=0 |
| 后端 lint | `cargo clippy -j 2 --all-targets` | **0 warning** |
| 后端全目标编译 | `cargo check -j 2 --all-targets` | EXIT=0 |
| 前端类型 | `npx tsc --noEmit` | EXIT=0 |
| 前端构建 | `npm run build` | EXIT=0（2009 modules，js 315 kB / gzip 97 kB，css 46 kB） |
| ⛔ P0 emoji | 正则扫 `src` + `index.html` | **0 命中** |
| ⛔ 裸色值 | 扫 7 个组件 CSS（除 2 个令牌文件） | **0 处** |
| ⛔ 紫粉渐变 / 靛蓝 / 弹跳缓动 | 正则扫 `src` | **0 命中** |
| 迁移幂等 | 读源码 + 实跑（v1 库就地升级 + 二次执行不报错） | 通过 |
| IPC 命令注册 | `lib.rs` 计数 | **40 项**（= v1 的 29 + 批1 新增 11） |
| capabilities | `default.json` | `["main","settings","todos"]` |
| 分层纪律 | lucide 直引（除 icons.ts）/ `invoke(`（除 ipc.ts） | 各 **0** |
| 单文件 ≤300 行 | 全量扫描 | 仅 `design-tokens.css`(427 令牌数据) 与 `domain.ts`(596 既有) 超限，均属令牌/类型数据文件 |

---

## 四、裁定记录（每条均核过依据，非拍脑袋）

| # | 事项 | 裁定 | 依据 |
|---|------|------|------|
| 1 | 设置窗 `×` 语义 | **hide**（不销毁） | 读 Tauri 2.12.4 `src/window/mod.rs:1890`：`close()` 先发可拦截的 `CloseRequested` → 后端全局拦截 `prevent_close()+hide()` |
| 2 | 托盘菜单 IA 16 项裁剪 | 只实现已具备能力项，**不生成死 UI** | P0「禁空洞占位」 |
| 3 | 设置入口指向 | 改调 `openSettingsWindow()`（主窗 384×360 放不下 392×660） | `tauri.conf.json` 主窗尺寸 |
| 4 | 删 `windowActions.ts` | **准**（死代码；通用窗口模块破坏 `{domain}Actions.ts` 约定） | 全仓无引用 |
| 5 | `todoDelete` 幂等（不存在静默成功） | **准**（我 brief 措辞错） | `ARCHITECTURE-V0.2.0.md:291` 明文 + REST DELETE 语义 |
| 6 | `title` 超长复用 `ITEM_NAME_EMPTY` | **准**（union 闭合，不得加第 17 码） | `domain.ts:159-176`（11+5=16）+ Spec §5 只授权新增 5 个；已登记 OPEN-DECISIONS |
| 7 | `todoToggle` 显式 `done`（非盲翻转） | **准** | `domain-v020.ts:153` + 防双击竞态 |
| 8 | 事项窗 336×(360–560)、仅高可调 | **准** | ADR-009 / ARCHITECTURE §6.a 登记值优先 |
| 9 | 前端 `try/catch` 兜底（优于 fire-and-forget） | **准** | capabilities 未放行时静默无反应 |

---

## 五、与设计的偏差（已记录，待确认）

### 偏差 P-1：「待进行」态的分区归属
- **设计稿** `pages-V0.2.0/todos-panel.md` §1 把「已完成 / 进行中 / **待进行**」同列为**今日计时区**的时间轴行（待进行行带铃铛 + 计划时刻）。
- **实现**：今日计时区 = 今日 `time_records`（已完成）+ `timerStore` 活动会话（进行中）；待办事项区 = `todos`（三级语气 `已逾期 / 未设时间 / 计划时刻`）+ 已完成。
- **原因**：`time_records` 无 `planned_at`（TickBar 的「计划」载体是 `todos.planned_at`），设计稿设想的「计划中的今日记录」在本数据模型下不成立。
- **影响**：四状态的**语义**均可达且视觉可区分（有时间 / 未设时间 / 已逾期 / 已完成），但「待进行」行的**分区位置**与设计稿不同（落在待办事项区而非今日计时区）。
- **处置**：登记 `OPEN-DECISIONS.md`（`design-decision-to-evaluate`），请用户/设计师确认是「保持现状」还是「把今日计划内的 todo 上提进今日计时区」。

---

## 五点五、批1 回归 QA + 定向复验（严过关）

**首轮批1 回归 QA 结论：fail（有条件放行）** —— 名义报 2 条 P0（AC-32 删除无 undo / AC-53 浅色对比度），另 6 条「部分通过」属纯 GUI/真机依赖。

**team-lead 顺链深挖后**，实际修复 **3 条 P0 级 AC + 1 项保真失真**（详见 `docs/phase4/QA-REPORT-V0.2.0-BATCH1.md` 复验终版 + `QA-V0.2.0-BATCH1-REVERIFY.md`）：

| AC | 首轮判定 | 修复 | 复验判定 |
|----|----------|------|----------|
| **AC-32** 删除待办无 undo | ❌不通过 | 改「直接软删 + 3s 撤销条」（乐观删除 + 延迟提交；**不新增 `todoRestore`**，守 Spec §5 五命令锁） | ✅ **通过（改判）** |
| **AC-53** 对比度 | ⚠️部分通过 | 浅色 `ink-4`→`#656E7D`、语义色保色相加深；**新增深色缺口修复** `--danger-solid`（深 `#E1292F` / 浅 `#D02C33`） | ✅ **通过（改判）** |
| **AC-54** 提醒色可配 | ✅（**误判**） | ★ 首轮只验「注入变量」漏验「**被消费**」——`--color-warn` 实为**零消费者** ⇒ 用户改提醒色不生效。修：`--todo-overdue`（令牌）+ 提醒铃（组件）接 `var(--color-warn)`，消费者 **0→2** | ✅ **通过** |
| 保真 | — | `applyAccents` 原「默认态也派生」→ 出厂像素 ≠ 审计值。修：「值==出厂默认 → 不写内联、回落分主题令牌」 | ✅ 通过 |

**复验门禁（QA 独立执行）**：`cargo test -j 2` **122 passed / 0 failed**；`fmt`/`clippy`/`tsc`/`build` 全 EXIT=0；P0 扫描全 0；回归率 **0**；测试完整性反作弊通过（断言 321 未弱化、无 skip/ignore/only）。
**QA 独立复算对比度**（自写脚本）：浅色 `ink-4` 4.636 / `warn` 4.618 / `danger` 4.624 / `ok` 4.623（对最坏底 `--bg-plate`）；深色 `--danger-solid` 白字 4.606。

**复验结论：pass**。批1 由「fail（有条件放行）」→「**通过（含真机待验项）**」；P0 缺陷归零。生产就绪仍 **Bronze**（短板：前端零自动化测试 / 无 CI），故「通过」≠「可上商业生产」。

**Spec 口径修订（team-lead 亲自改）**：`Spec-V0.2.0.md` §9 加口径块 + §13 变更记录 —— AC-56 收窄（仅小条/事项两处自绘，托盘保留原生，依 ADR-013）、AC-53 覆盖 hover 等可达态、AC-32 落地方式；并订正 `OPEN-DECISIONS` P-1 为 RESOLVED、登记新项 D-B1-07。

---

## 六、结论与下一步

**结论**：批1 达「一眼就是 Timing」——令牌 / 几何 / 双主题 / 四色全部对齐，待办与事项窗口、自绘玻璃菜单齐备。**机械门禁 + 批1 回归 QA 复验全部通过，3 条 P0 级 AC 归零。**

**下一步（待用户拍板）**：
1. **真机验收**：批1 可整机跑 —— 建议受控启动确认小条可见（AC-01）+ 双主题无白闪 + 事项窗/设置窗开合 + **四色点色即时生效**（AC-54，需先造带 planned/remind 的待办，见 D-B1-07）。
2. **批2 开工**：便利贴（多窗口）/ 倒计时 / 提醒铃 / 常用事项 + 托盘 IA 扩展 —— 同时凭「排期/提醒入口」闭合 D-B1-07。
3. 批2 验收时处理 P2 项：`timer.rs` 拆文件、`ITEM_NAME_TOO_LONG` 错误码（v0.3）、前端自动化测试 + CI（冲 Silver）。
