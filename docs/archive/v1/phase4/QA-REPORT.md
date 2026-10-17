# QA 报告 — TickBar V0.1.0（MVP）

- 文档 ID：`docs/phase4/QA-REPORT.md`
- 验证人：严过关（测试工程师，mvp-dev-expert-team-qa）
- 初版日期：2026-10-16 ｜ **复验更新：2026-10-16（D-01/D-02/D-06 修复后）**
- 唯一验收依据：`docs/Spec-v1.md`（§5 契约 / §6 数据 / §9 AC-01~AC-27 / §10 边界 / §11 已知坑 / §12 端到端）
- 辅助依据：`docs/phase1/ARCHITECTURE-v1.md`、`docs/phase2/IPC-CONTRACT-v2.md`、`docs/phase2/schema.sql`
- 环境：Windows / node v22.22.2 / npm 10.9.7 / cargo 1.99.0 / rustc 1.99.0

---

## 0. 结论摘要（TL;DR）

| 项 | 初版 | **复验后** |
|----|------|-----------|
| 后端测试 | 58 passed / 0 failed | **68 passed / 0 failed / 0 ignored**（`-j 2`，退出码 0） |
| 前端类型检查 | 退出码 0 | 退出码 0 |
| 前端构建 | 退出码 0 | 退出码 0 |
| AC 统计 | 通过 21 / 不通过 2 / 无法验证 4 | **通过 21 / 不通过 0 / 无法验证 6** |
| P0 缺陷 | 1（未归零） | **0（已修复并代码级复验通过）** |
| P1 / P2 缺陷 | 3 / 2 | **1 残余风险（advisory）/ 2 归属 V0.2.0** |
| 生产就绪档 | Bronze | **Bronze**（各维最低） |
| 上线建议 | 不通过 | **条件通过**（可进入真机验收 / MVP 内测） |

> **复验结论：** 初版唯一 P0 缺陷 **D-01（冷启动药丸不可见）已修复**——前端补上 `show_window` 唯一调用点，且未回归白闪（`visible:false` 保持不变）。D-02（多显示器回落）与 D-06（记录行时长档位）亦已修复并纳入自动化测试。**P0 已归零，不再构成上线阻断。** 但 AC-01 / AC-16 / AC-19 / AC-21 / AC-22 / AC-23 共 6 条依赖真实桌面/注册表/多显示器，本（无头）轮次无法观测结果，**待团队与用户的真机验收**；其中 AC-01 存在 1 项运行时残余风险（隐藏窗口下 `requestAnimationFrame` 可能被节流，见 D-07），已给出低成本兜底建议。

---

## 1. 测试执行记录（真实命令 / 输出摘要 / 退出码）

### 1.1 复验轮次（D-01/D-02/D-06 修复后）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `cd src-tauri && cargo test --message-format short -j 2` | **0** | **`68 passed; 0 failed; 0 ignored`** |
| `cd tickbar && npx tsc --noEmit` | **0** | 无类型错误 |
| （初版）`cd tickbar && npm run build` | **0** | `✓ 1971 modules`；gzip 83.66 kB |
| （初版）`cargo build -j 2` | **0** | `Finished dev profile` |

> 复验轮次测试数 58 → **68**：新增 `src/tests/window_geometry.rs` **10 个**纯函数单测（多显示器工作区钳制）。
> ⚠️ 必须带 `-j 2`：首轮默认并行 `cargo test --no-run` 曾触发 rustc 编译 `tokio-stream` 崩溃（`STATUS_ACCESS_VIOLATION`）；`-j 2` 稳定通过（见 §8.4 E-01）。复验时另见若干 `error deleting lock file ... os error 5` 告警——沙箱下 incremental 锁文件清理失败，**不影响编译与测试结果**。

### 1.2 测试分布（全部新增，`#[tokio::test]` / `#[test]`）

| 模块 | 文件 | 用例数 |
|---|---|---|
| 计时状态机 | `src-tauri/src/tests/timer.rs` | 27 |
| 事项业务 | `src-tauri/src/tests/item.rs` | 11 |
| 记录域 | `src-tauri/src/tests/record.rs` | 11 |
| 迁移与约束 | `src-tauri/src/tests/migration.rs` | 9 |
| 多显示器几何 | `src-tauri/src/tests/window_geometry.rs` | 10 |
| **合计** | | **68** |

测试文件绝对路径：
- `D:/401-Agent/WorkBuddy/2026-10-16-08-38-29/src-tauri/src/tests/{mod,support,timer,item,record,migration,window_geometry}.rs`

> 说明：`window_geometry.rs` 由后端同学随 D-02 交付；其余 5 个为 QA 于初版新增。全部走真实 `infra::db::init_pool`（0001 迁移 + WAL + 外键）+ 每用例独立临时库；断言取自契约（错误码 / DTO 形状 / 状态迁移），不绑定实现内部（黑盒优先）。

### 1.3 未执行（诚实声明）
- **未跑 GUI / `tauri dev`**（按 team-lead 指示，真机肉眼验证另行安排）→ 见 §2「无法验证」6 条。
- **未做变异注入**：遵守「不修改业务代码」纪律，以强断言清单替代（见 §9.3）。

---

## 2. AC-01 ~ AC-27 逐条核验表（复验后）

判定口径：**通过** = 代码级可完全判定满足（后端有测试 或 前端确定性代码）；**不通过** = 代码级可判定违反；**无法验证** = 结果依赖真实 GUI/OS/注册表，无头环境不可观测（如实标注，不假装通过）。

| 编号 | 功能 | 判定 | 依据 / 证据（复验） |
|---|---|---|---|
| AC-01 | 常驻形态（启动即见药丸） | **无法验证 ⚠️（P0 缺陷已消除）** | **D-01 已修**：`useAppBootstrap.ts:56-71` 新增独立 `useEffect`，双 `requestAnimationFrame` 后 `void ipc.showWindow().catch(()=>undefined)`；`windowShown`（:24）防 StrictMode 双执行；cleanup 取消 rAF。`tauri.conf.json:31` `visible:false` **未改动**（防白闪保留）。→ **静态缺陷（无调用点）已消除**；但「启动即见」结果需 GUI 实测；存在运行时残余风险 **D-07**（隐藏窗口下 rAF 可能被节流） |
| AC-02 | 开始计时 | 通过 ✅ | 后端 `start_*`；前端 `PillBar→togglePause→ipc.startTimer` |
| AC-03 | 暂停（不产生记录） | 通过 ✅ | `pause_freezes_accumulated_and_creates_no_record` 等 |
| AC-04 | 恢复 | 通过 ✅ | `resume_sets_running_since` / `resume_when_running_is_idempotent` |
| AC-05 | 结束并保存（右键立即 saved + 撤销条） | 通过 ✅ | `stop_saves_and_freezes_accumulated`；`PillBar` 右键单击→`stop()`；`UndoBar` |
| AC-06 | 撤销结束 | 通过 ✅ | `undo_within_window_reactivates_and_continues` |
| AC-07 | 撤销条过期 | 通过 ✅ | `undo_expired_rejected`；`UndoBar` 到期 `clearUndo()` |
| AC-08 | 事项创建 | 通过 ✅ | `create_trims_name_and_assigns_sort_order`；`ItemPicker` |
| AC-09 | 未归类兜底 | 通过 ✅ | `start_creates_running_active_session`（item_id=1） |
| AC-10 | 重名提示 | 通过 ✅ | `create_duplicate_...`；「直接使用该事项」按钮 |
| AC-11 | 系统事项保护 | 通过 ✅ | `system_item_is_protected` |
| AC-12 | 计时中换事项 | 通过 ✅ | `switch_just_switch_...` / `switch_end_and_start_segments` |
| AC-13 | 本地持久化 | 通过 ✅ | 文件库；`migration_is_idempotent` 同一目录二次打开仍读种子 |
| AC-14 | 崩溃恢复（≤30s） | 通过 ✅ | `resolve_*` 三选一 + `FLUSH_INTERVAL_SECS=15`；`RecoverDialog` |
| AC-15 | 全离线 | 通过 ✅ | 前端无网络 API；后端无 http；CSP `default-src 'self'` |
| AC-16 | 今日/本周 **300ms 内** | **无法验证 ⚠️** | 链路存在；「300ms」性能指标需真机实测 |
| AC-17 | 记录明细 + 改归属/删除 | 通过 ✅ | `update_record`/`delete_record` 测试；`RecordRow` |
| AC-18 | 空状态引导文案 | 通过 ✅ | `RecordsPanel` 空态「点左侧圆钮开始第一次计时」 |
| AC-19 | 托盘常驻 + 左键显隐 + 菜单 | **无法验证 ⚠️** | `infra/tray.rs` 代码存在；需真实桌面观测 |
| AC-20 | 关闭转隐藏（不退出） | 通过 ✅（代码级） | `window.rs::on_window_event`：`CloseRequested→prevent_close()+hide()`（K-5） |
| AC-21 | 开机自启（回归可移除） | **无法验证 ⚠️** | `autostart::set_enabled`（插件 enable/disable，返回实际状态）；需真实注册表 + 重启 |
| AC-22 | 单实例 | **无法验证 ⚠️** | `tauri-plugin-single-instance` 已注册；需真实多启动观测 |
| AC-23 | 高 DPI / 多显示器 | **无法验证 ⚠️（P1 实现已补齐）** | **D-02 已修**：新增 `infra/geometry.rs`（`clamp_to_workarea` 纯函数）+ `infra/monitor.rs`（3s 轮询签名变化）+ `window.rs::reclamp_main/current_rect/available_work_areas` + `setup.rs` 启动钳制一次并启监视。**子句②**（拔屏回落可见区）代码级完整且纯函数 **10 单测**覆盖（越界/部分重叠/收缩/主屏优先后备/无显示器/幂等）→ 代码级已实现；**子句①**（跨 DPI 移位尺寸正确）与真实拔屏仍需真机实测 |
| AC-24 | 等宽数字零抖动 | 通过 ✅ | `.timer-digits`：`tabular-nums`+`min-width:5ch`(≥1h→8ch)+右对齐+`nowrap`；`TimerDisplay`/`ItemGroup`/`RecordRow` 均统一经 `format.ts` |
| AC-25 | 无 emoji 图标（用 lucide） | 通过 ✅ | emoji 正则扫描前后端 **零命中**（复验再核）；图标全经 `lib/icons.ts` |
| AC-26 | 本地统计（默认关闭） | 通过 ✅（P1 未实现） | 无采集、无网络 |
| AC-27 | 全局快捷键 | 通过 ✅（P1 未实现，符合范围） | `shortcuts::register` 恒 `false`；capabilities 未放行 |

**复验后统计：通过 21 / 不通过 0 / 无法验证 6（AC-01、AC-16、AC-19、AC-21、AC-22、AC-23）** —— 共 27。

> AC-01、AC-23 由初版「不通过」升为「无法验证」：**静态可判定的缺陷已被修复**，剩余为运行时观测项。

---

## 3. 契约一致性核验结论

| 核验项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| Rust `invoke_handler` 命令数 | 29（Spec §5） | **29** | ✅ |
| `IpcApi` 方法数（domain.ts） | ≥29 | **52**（29 + 23 V0.2.0） | ✅ V0.1.0 全含 |
| `ipc.ts` 实现方法数 | = IpcApi | **52** | ✅ 全覆盖 |
| 错误码（Rust `error.rs`） | 11 | **11** | ✅ |
| 错误码（domain.ts） | ≥11 | **16**（11 + 5 V0.2.0） | ✅ |
| 组件内裸 `invoke` | 0（K-11） | **0** | ✅ |
| `draft`/`confirm_stop`/`cancel_stop` 残留 | 0 | 仅注释解释「已移除」；无代码残留 | ✅ |
| `uq_records_open` | `UNIQUE(status) WHERE status='active'` | 一致 | ✅ |
| 迁移 `0001_init.sql` vs `schema.sql` | 一致 | 忽略注释后仅差 1 行末尾空行 | ✅ |

**V0.2.0 增量偏差（不阻断 V0.1.0）**：D-03（Settings DTO 前后端不一致）、D-04（browserMock 缺 23 个 V0.2.0 命令）——均见 §8.3。

---

## 4. P0 门禁扫描结果（复验再核）

| 扫描项 | 结果 |
|---|---|
| **emoji 作功能图标（P0）** | **零命中 ✅**（`src/` 与 `src-tauri/src/`） |
| 紫→粉渐变 / `7C3AED`/`A855F7`/`EC4899` | 零命中 ✅ |
| 弹跳缓动 `cubic-bezier(0.68,-0.55,0.265,1.55)` | 零命中 ✅ |
| 空洞占位文案（`Welcome to`/`Lorem ipsum`/`Sign up today`） | 零命中 ✅ |
| `#6366F1` 靛蓝默认强调色 | 零命中 ✅ |
| 裸色值（令牌层外） | 仅 D-05（`settingsStore.ts`/`mockSeed.ts` accents 默认，V0.2.0）——见 §8.3 |

> 复验对**本次改动的文件**（`useAppBootstrap.ts`、`RecordRow.tsx`、`infra/geometry.rs|monitor.rs|window.rs|setup.rs`、`tests/window_geometry.rs`）单独跑过门禁，**均无新违规**。

---

## 5. 代码组织纪律（Spec §4.2，复验）

| 规则 | 判定 |
|---|---|
| 单文件有效行 ≤ 300 | ✅ 全局最大 `types/domain.ts` **299**；本次新增最大 `tests/window_geometry.rs` **77**、`infra/window.rs` **74** |
| 入口只装配 <120 行 | ✅ `lib.rs` 55、`main.tsx` 18 |
| 前端禁组件内 `invoke` | ✅ 仅 `services/ipc.ts` |
| 依赖只向下 | ✅ 命令层无业务/SQL；业务层经 repositories |
| 类型/DTO 独立成文件 | ✅ |

---

## 6. 改动影响分析（复验轮 · 针对三处修复）

### 本次改动范围（由前端/后端同学实施，QA 只读复核）
- **D-01**：`src/hooks/useAppBootstrap.ts`（+独立 effect + `windowShown` 护栏 + 注释）
- **D-06**：`src/components/records/RecordRow.tsx`（`data-hours` 改由 `hasHours()` 计算）
- **D-02**：`src-tauri/src/infra/geometry.rs`（新）、`monitor.rs`（新）、`window.rs`（+3 函数）、`setup.rs`（+钳制+监视）、`infra/mod.rs`（+2 mod）、`src/tests/window_geometry.rs`（新 10 单测）、`src/tests/mod.rs`（+1 mod）

### 下游影响面与回归验证
- **D-01 effect 隔离性**：新 `useEffect` 与「事件订阅」（`useTauriEvent`）及「首帧加载」effect **相互独立**；加载失败仅进 catch 提示，不阻断显示（注释明确「初始化异常→应用永久不可见」的规避）。`windowShown` 幂等 + cleanup 取消 rAF。
- **未破坏既有行为**：全量后端测试复跑 **68/68 绿**（含初版 58 例）→ 计时/事项/记录/迁移**零回归**。
- **D-02 纯函数化**：`clamp_to_workarea` 无副作用、不依赖 Tauri，便于单测；`reclamp_main` 仅在越界时移动（返回 `false` 表示未动），不干扰正常窗口。
- **静态门禁**：`tsc` 0、emoji/渐变/占位扫描 0、单文件行数合规。

### 回归测试优先级
1. 计时状态机（高风险）→ 必测（27 例）✅
2. 事项/记录（中风险）→ 应测（22 例）✅
3. 迁移/约束/几何（低-中）→ 抽测（19 例）✅

---

## 7. 失效模式核对（生成式代码 6 类 · 复验）

| 失效模式 | 结果 | 说明 |
|---|---|---|
| Happy-path 偏差 | ✅ 未见 | 错误/边界分支有测试；前端 Error/Empty/Loading 态齐 |
| **沉默逻辑错误** | ✅ **已消除** | 初版 D-01（不报错但结果错）已修复 |
| 幻觉依赖/接口 | ✅ 未见 | 版本锚定；`cargo build`/`tsc` 全绿 |
| 缺失系统上下文 | ⚠️ 已补 | 多显示器回落已实现（D-02）；权限/离线本就满足 |
| 性能盲区 | ⚠️ 未测 | 查询走索引、无 N+1；cold-start/panel/内存目标未实测 |
| 静默缺失（import/未用） | ✅ 未见 | `tsc`/`cargo build` 门全绿；无新告警 |

---

## 8. 缺陷清单（复验后）

### 8.1 P0（致命）—— **0 个（已归零）**

| ID | 描述 | 复验结论 |
|----|------|---------|
| **D-01** | 冷启动药丸不可见（前端缺 `show_window` 调用） | ✅ **已修复**：`useAppBootstrap.ts:56-71` 双 rAF 后调 `ipc.showWindow()`，`windowShown` 护栏 + cleanup；`visible:false` 保留（不回归白闪）。静态缺陷消除 → AC-01 由「不通过」升「无法验证（待 GUI）」 |

### 8.2 P1（严重）

| ID | 描述 | 状态 |
|----|------|------|
| **D-02** | 多显示器断开回落未实现（AC-23） | ✅ **已修复**：`geometry.rs` 钳制纯函数 + `monitor.rs` 3s 轮询 + `setup.rs` 启动钳制；含 10 单测。代码级完成，待真机实测 |
| **D-07**（新·残余风险） | **D-01 修复的运行时残余风险（advisory）**：双 `requestAnimationFrame` 依赖「隐藏窗口仍会渲染/触发 rAF」。WebView2 在窗口不可见时**可能暂停 rAF**，若如此则 `show_window` 不触发、P0 复现。**无头环境无法确证**。建议（低成本兜底）：在 rAF 之外并联一个 `window.setTimeout(..., 50)` 兜底调用（`windowShown` 护栏已保证幂等，重复调用无害），彻底消除「显示依赖绘制」的死锁 | 建议加固 |

### 8.3 归属 V0.2.0 的未决项（不阻断 V0.1.0）

| ID | 描述 | 归属 |
|----|------|------|
| **D-03** | `Settings` DTO 前后端不一致（Rust 5 字段 vs domain.ts 8 字段）→ 前端 `reload` 静默重置 V0.2.0 字段 | V0.2.0（V0.2.0 阻塞项） |
| **D-04** | `browserMock` 未实现 23 个 V0.2.0 命令 → 浏览器 dev 走查受限 | V0.2.0 |
| **D-05** | TS 源裸色值（`settingsStore.ts:20` / `mockSeed.ts:44` accents 默认）违反「令牌层外禁裸色」严格口径 | V0.2.0 |

### 8.4 非产品缺陷（工程说明）
- **E-01** 并行编译 ICE：默认并行 `cargo test --no-run` 曾致 rustc 编 `tokio-stream` 崩溃（`STATUS_ACCESS_VIOLATION`）；**`-j 2` 稳定通过**。属构建环境/并行度问题。建议 CI 固定 `-j` 并排查内存/杀软。

---

## 9. 测试完整性反作弊（test integrity）

| 检测项 | 结果 | 说明 |
|---|---|---|
| 测试文件/用例被删 | ✅ 无 | 复验 58 → 68（净增，未删） |
| 断言数下降 / 弱化断言 | ✅ 无 | 断言取精确值（错误码相等、`accumulated==2`、行计数、部分索引 SQL 文本、几何 `Rect` 相等） |
| 新增 skip/xfail/.only/focus | ✅ 无 | 0 命中；无 `#[ignore]` |
| 硬编码实现自身输出 | ✅ 无 | 断言值来自 Spec/契约 |
| 框架/配置篡改 | ✅ 无 | 未改 `package.json` scripts / `tsconfig`；`Cargo.toml` 仅初版新增 dev-dependency |
| 业务代码被 QA 改动 | ✅ 零 | QA 仅新增测试文件 |

**QA 对非业务文件的改动（初版披露，复验无新增）：**
1. `src-tauri/Cargo.toml`：新增 `[dev-dependencies] tokio = { features=["macros","rt-multi-thread"] }`。
2. `src-tauri/src/lib.rs`：新增一行 `#[cfg(test)] mod tests;`（不入 release 产物）。
> 本次复验轮：QA **未改动任何文件**（含测试与非测试）；三处修复由前端/后端同学实施，QA 仅只读复核 + 复跑。

**替代变异证据（强断言 = 各畏惧缺陷的杀手测试）：**
- 单 active：`unique_active_session_enforced`（第二条 active 必失败）
- R-5：`resolve_discard_frees_single_active_slot`（discard 后必须能再开会话）
- 时长口径：`resolve_resume_...` / `resolve_close_...`（accumulated 必须==42，杀"补算间隙"）
- off-by-one：`pause_freezes...`（floor(2500)==2）、`range_filter...`（to 不含）、`page_and_limit_are_clamped`
- 几何：`fully_outside_moves_to_primary_workarea_center`、`rect_larger_than_workarea_is_shrunk_and_centered`、`clamped_result_is_stable`、`missing_primary_falls_back_to_first_monitor`

---

## 10. 生产就绪评级（7 维 × 3 档 · 复验后）

| 维度 | 档位 | 证据 |
|------|------|------|
| 测试 + 回归 | **Bronze** | 后端 68 测试全绿、构建/类型检查绿；但**前端仍零自动化测试**、无 CI、无回归集进门禁 |
| 契约 | **Silver** | 契约先行、29 命令/11 码一一核验、错误模型统一（V0.2.0 漂移不属 V0.1.0） |
| 安全 | **Silver** | 纯本地无鉴权面、capabilities 最小权限、CSP `default-src 'self'`、零网络 |
| 无障碍 | **Bronze** | 键盘全路径 + 焦点陷阱 + aria；无自动扫描/屏读走查证据 |
| 性能 | **Bronze** | 无 N+1、索引齐；cold-start/panel/内存目标未实测 |
| 可观测 | **Bronze** | 有错误日志与前端 error/notice 态；无结构化日志/指标/SLO |
| 发布安全 | **Bronze** | 安装包可卸载；无渐进发布/回滚演练 |
| **总档（取最低）** | **Bronze** | **未达 Silver ⇒ 不交付商业生产**（当前定位 MVP 内测） |

> 复验未改变总档：三处修复消除了 P0/P1 缺陷，但记分卡的短板在「前端零自动化测试 + 无 CI + 性能/可观测未量化」，需 V0.2.0 周期补门禁方可冲 Silver。

---

## 11. 回归集更新

| 新增回归用例 | 对应风险 | 文件路径 |
|---|---|---|
| `resolve_discard_frees_single_active_slot` | R-5（discard 占死唯一槽） | `src-tauri/src/tests/timer.rs` |
| `undo_blocked_when_a_new_session_is_active` | R-1（撤销/新计时竞态） | `src-tauri/src/tests/timer.rs` |
| `resolve_resume/close_*_without_gap` | R-2（崩溃间隙被计入） | `src-tauri/src/tests/timer.rs` |
| `unique_active_session_enforced` + 4 CHECK + 外键 | 数据完整性不变式 | `src-tauri/src/tests/migration.rs` |
| `window_geometry.rs`（10 例） | AC-23 多显示器回落（D-02） | `src-tauri/src/tests/window_geometry.rs` |

> 建议补：D-01 的前端回归（E2E/组件测试断言启动后调用 `showWindow` 且窗口可见）；D-07 若加 setTimeout 兜底，应补「rAF 不触发时仍显示」的用例。当前无前端测试框架，建议 V0.2.0 引入（Vitest/Playwright）。

---

## 12. 上线建议（复验后）

**判定：条件通过 —— 生产就绪档位 Bronze。**

理由：
1. **P0 已归零**：初版唯一 P0（D-01 冷启动不可见）已修复并代码级复验；`visible:false` 防白闪未回归。按团队 P0 门禁，**不再构成上线阻断**。
2. **AC 不通过 = 0**；6 条「无法验证」均为**真机/GUI/注册表依赖项**（AC-01、AC-16、AC-19、AC-21、AC-22、AC-23），非代码缺陷，需真机验收补证。
3. **后端逻辑质量正面**：68/68 全绿（含多显示器几何），无沉默逻辑错误。
4. 未达 Silver（前端零自动化测试 / 无 CI / 性能与可观测未量化）→ **不面向商业生产**，仅适合 MVP 内测 / 真机验收阶段。

**放行条件（真机验收清单）：**
- [ ] 真机启动 → 确认**药丸自动可见**（AC-01）；若不可见，按 **D-07** 加 `setTimeout` 兜底后复验。
- [ ] 真机补验 AC-19（托盘）/ AC-21（注册表自启 + 重启）/ AC-22（单实例聚焦）/ AC-16（面板 <300ms）/ AC-23（跨 DPI + 拔屏回落）。
- [ ] 真机验收通过后，本报告 6 项「无法验证」可销项；总档仍受「前端零测试 + 无 CI」限制。
- [ ] V0.2.0 排期处理 D-03 / D-04 / D-05。

---

## 附录 A：验证命令速查

```bash
# 后端（必须 -j 2）
cd src-tauri && cargo test --message-format short -j 2   # 68 passed, exit 0
# 前端
cd tickbar && npx tsc --noEmit                                   # exit 0
cd tickbar && npm run build                                      # exit 0
# P0 门禁（emoji）
grep -rP '[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{1F000}-\x{1F02F}\x{1F0A0}-\x{1F0FF}\x{1F100}-\x{1F64F}\x{1F680}-\x{1F6FF}\x{1F900}-\x{1F9FF}\x{1FA00}-\x{1FA6F}\x{1FA70}-\x{1FAFF}\x{FE00}-\x{FE0F}\x{200D}\x{20E3}]' src src-tauri/src   # 0 命中
```

## 附录 B：核验方法备注
- 契约计数：脚本解析 `domain.ts::IpcApi` / `ipc.ts` 对象 / `lib.rs::generate_handler!` / `error.rs` 字符串。
- 有效行统计：剥离 `/* */` 与 `//` 行注释及空行后计数（Spec §4.2 口径）。
- 迁移一致性：`diff` 忽略 `--` 注释后仅差一行末尾空行。
- 无 git 仓库，完整性差异以「新增文件 + 非业务改动显式披露」替代。
- 复验对 D-01/D-02/D-06 逐行读源码确认真实落地（未只信转述）。
