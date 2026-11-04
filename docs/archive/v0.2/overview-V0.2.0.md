> **历史文档（v0.2.0 交付概览）**：记录 2026-10-16 那一轮的交付内容与门禁结果，正文保留原样。其中 `release/Timing.exe`、`release/Timing.new.exe` 等构建产物**未纳入本仓库**（见 `.gitignore` / `CHANGELOG.md`）；原 `timing/` 路径已随仓库平铺改为根目录相对路径。现行版本为 **0.2.1**。
# Timing V0.2.0 —— 交付概览

> 2026-10-16 · 批2「重功能」+ 小条 UI 统一 + **Timing 全面对齐优化轮**
> 结论：**QA verdict = PASS，零 P0**。批2 四大功能（常用事项 / 倒计时 / 便利贴 / 提醒铃）+ 托盘 IA 扩展全部落地并验证通过；同日完成以 Timing v1.7.0 源码常量为基准的 UI 全面对齐
> 交付物：`release/Timing.new.exe`（Timing 对齐版，双击即用）

---

## 增量更新 —— Timing 全面对齐优化轮（17:00-18:00）

**依据**：设计师对 Timing 源码 9 个 UI 文件的逐值审计（`docs/design/TIMING-DELTA-AUDIT.md`）→ 前端落地 → QA 独立验证，全链 PASS。git 基线已建立（`main`，5 commits）。

| 类别 | 内容 |
|---|---|
| **P1 视觉** | 环 idle 色灰→墨（RingIdle=InkOnGlass）· 悬停板半透玻璃 74% + 圆角 12 + 去描边 · **倒计时 ≤60s 红 `#E5484D` + 1s 闪烁**（弧+环闪、数字只变色）· 暂停数字切橙 · 便利贴正文 14px Bold |
| **P2 对齐** | SVG 轨道改状态色 37% · 小条高 34→32 · 抓取柄墨度/描边校准（0.55/0.36 + 2.5）· 收起圆点 paused 同步橙 · 待办面板字号 12.5/11.5 · 提醒卡宽 330 + CTA 28 · 主题卡标签 12.5 |
| **三则设计裁决** | 急迫态红+闪（避免暂停/急迫语义坍缩，1Hz 低于 WCAG 2.3.1 光敏阈值）· 悬停板 74% 折衷（投埃淡出后板面须承对比度）· dot 与环同色（状态连续性） |
| **基建** | git 仓库 + 基线（反作弊门可跑 diff，首验通过）· `.gitattributes` LF · 登记册闭合「无 VCS」项（未决 2 / 已决 9） |
| **门禁** | `cargo test` 164 绿 · `tsc` 0 · `build` 成功 · emoji/紫粉/裸色 0 · 行数 ≤300（note.css 299 红线守住）· git diff 与申报清单逐文件一致 |

**移交下一轮**：像素级运行态比对需真机（idle/running/paused/倒计时 90s·30s/便利贴/菜单/提醒/设置）；`design-tokens.css` 449 行拆分（既有豁免）；`--menu-status-h` 预留待运行态验证后接线。

---

## 批2 收官（当日早间）

- **需求**：所有悬浮窗**未悬停时只隐藏背景、保留内容**（小条 = 状态环 + 计时数字 + 事项名；便利贴本就如此）。
- **实现（纯前端，零后端改动）**：
  - `styles/surfaces.css`：`.pill` 默认 `background/border/box-shadow` 全透明（只留内容）；显影条件 = `:hover` / `:focus-within` / `[data-reveal="true"]` → 恢复完整药丸板式。
  - `components/pill/PillBar.tsx`：加 `data-reveal`，任一悬浮层（右键菜单 / 内联面板 / 倒计时菜单 / 常用事项 / 提醒卡）展开时强制显影，避免交互中小条凭空消失。
  - 便利贴无需改（AC-39「未悬停全透仅留正文」早已实现）。
- **自检**：`tsc --noEmit` 0 错 · `npm run build` 成功（2031 modules）· 两文件均 ≤300 行。
- exe 已重建：`release/Timing.exe` = 6,192,640 B。

---

## 一句话结论

批2 四个 P1 功能 + 52 命令契约（29→52）全部实现；`cargo test` **164 通过 / 0 失败**、`tsc`/`build` 全绿、P0 扫描全 0、契约四方一致（Spec §5 = `IpcApi` = `lib.rs` = `ipc.ts` = 52）；AC-38~50 + AC-61~64 逐条 EARS 判定达标；批1 无退化。

---

## 批2 交付了什么

| 功能 | 要点 |
|------|------|
| **N-7 常用事项 / 固定任务** | `items.is_pinned`；`list_items` 排序改 `is_pinned DESC, sort_order ASC, id ASC`；「常用事项」面板 = 置顶组 + 最近5（由 `listRecords` 派生）+ 一键开计时 |
| **N-6 倒计时** | `time_records.mode/target_sec` + `TimerState.remainingSec`；`start_countdown`/`set_countdown_preset`；**1s Rust watcher** 到点判定（抗窗口隐藏/休眠）；到点行为默认仅「通知+视觉」（AC-62 开关默认关） |
| **N-4 便利贴** | 独立多窗（label `note-{id}`，默认 320×232，硬钳 160×120–900×900）；note 域 5 命令 + 开/关窗；300ms 防抖几何落盘 + 重启恢复；上限 20（`WINDOW_LIMIT_EXCEEDED`）；AC-64 默认置顶 |
| **N-5 提醒铃** | `reminder_set/clear/pending`；**15s 查询式调度**（`remind_at<=now AND reminded_at IS NULL`，天然抗休眠补偿，AC-44）；`reminded_at` 去重（K-19）；±60s 聚合（AC-61） |
| **托盘 IA 扩展** | 原生 Win32 菜单（ADR-013）追加 3 个常显项 + 倒计时状态行；emit `app:open-common-items` / `app:open-new-note` 驱动前端 |

**新增接口**：命令 12 个（总数 52）· IPC 事件 4 个（`countdown-finished`/`reminder-fired`/`note-window-opened`/`note-window-closed`）+ 应用内 2 个 · 错误码 5 个（`NOTE_NOT_FOUND`/`TODO_NOT_FOUND`/`WINDOW_LIMIT_EXCEEDED`/`INVALID_TARGET_SEC`/`INVALID_COLOR`）
**零新增迁移**：`0002_v020.sql` 已前瞻建好批2 全部表/列（notes 表 + items.remind_at·reminded_at·is_pinned + time_records.mode·target_sec + todos.reminded_at + countdown.presets）

---

## 门禁结果（批2 终局）

| 门禁 | 结果 |
|------|------|
| `cargo test -j 2` | **164 passed / 0 failed / 0 ignored** |
| `cargo clippy --all-targets` | **0 error / 0 code-warning** |
| `cargo check --all-targets` | 通过（含 capabilities 改动） |
| `tsc --noEmit` / `npm run build` | EXIT=0 / 成功（2031 modules） |
| P0 扫描（emoji / 紫粉渐变 / 靛蓝 / 裸色值） | **全 0 命中** |
| 单文件 ≤300 行 | 前后端全过（`timer.rs` 494→267+226） |
| 契约一致 | **52 = 52 = 52 = 52**（Spec §5 / IpcApi / lib.rs / ipc.ts），事件字面值逐一对齐 |
| 批1 回归 | **0 退化**（计时三态 / 撤销条 / 主题切换抽查通过） |
| 边界错误流 | 第21张便利贴 / target≤0 / 非法 hex / 不存在 id → 对应错误码全命中 |

---

## 我（Team Lead）在批2 的关键裁定与修复

1. **抓出 QA 之外的 AC-41 真机隐患**：`capabilities/default.json` 未放行 `core:window:allow-scale-factor` + `core:window:allow-inner-size`，而 `useNoteGeometry` 调用 `scaleFactor()`/`innerSize()` → 会**静默 reject**、HiDPI 下几何归一错误。**已补放行**（`cargo check --all-targets` 验证可编译）。
2. **便利贴置顶跨层缺陷**（后端定位、我核实）→ 派单修复：`NoteWindow.tsx` 由 `ipc.setAlwaysOnTop`（主窗语义 + 落库全局设置）改为 `setCurrentWindowAlwaysOnTop`（当前窗）。**AC-64 运行期开关达标，不再污染全局 `ui.always_on_top`**。
3. **便利贴正文静默丢失**（前端自查发现）→ 修复：`noteStore` 引入 `savedContent` 基准，落盘判定修正（失效模式 #2 沉默逻辑错误）。
4. **AC-38 口径裁定** → 补入口（小条右键「便利贴…」绑当前计时事项），三入口统一写入 Spec §9 口径块。
5. **`domain.ts` 302 行** → 拆 `domain-params.ts` 外移入参块，有效行 302→**242**。
6. **ADR-011 铃声** → 裁降级（系统通知 + 视觉，AC-47 已满足），ADR 就地标注 + 登记册记录。

---

## 未决登记（OPEN-DECISIONS：未决 3 / 已决 8）

- ✔ **闭合** D-B1-07（AC-54 提醒色可达性）——批2 交付提醒/排期入口后判定路径打通
- **OPEN #7** 待办 `title` 超长复用 `ITEM_NAME_EMPTY`（v0.3 补 `ITEM_NAME_TOO_LONG`）
- **OPEN #10** 便利贴 pin 持久化（需 `notes.is_pinned` 列，v0.3）
- **OPEN #11** 无 VCS 基线（反作弊 diff 检测留痕，建议纳入 git）
- **RESOLVED #9** ADR-011 Web Audio 铃声降级

---

## 待办 / 下一步

- **真机复测（等用户双击）**：含 `--disable-gpu` + `RendererCodeIntegrity` 的新 exe 是否仍崩；若仍崩，备选：① 去透明窗口 ② `--no-sandbox` ③ 排查注入软件（微信输入法 / 小米电脑管家）。
- **真机验收**：批1 6 条 AC（AC-01/34/35/37/51/54，见 `docs/phase4/RM-CHECKLIST-V0.2.0-BATCH1.md`）+ 批2 便利贴几何（AC-41）dev 冒烟。
- **P2 / 商业级**：结构化日志 + 指标（可观测）· 渐进发布/回滚（发布安全）→ 冲评分卡 Silver；前端自动化测试 + CI。
- **NSIS 安装器**：网络允许时重试（`--no-bundle` 已产出 exe 本体）。

---

## 关键文档索引

| 文档 | 说明 |
|------|------|
| `docs/Spec-V0.2.0.md` | Spec 契约（§5 52 命令 / §9 AC + 口径块 / §13 变更记录） |
| `docs/decisions/ADR-009~013.md` | 多窗口 / 提醒调度 / 倒计时状态机 / 双主题 / 托盘 |
| `docs/decisions/OPEN-DECISIONS.md` | 未决 3 / 已决 8 |
| `docs/design/pages-V0.2.0/` | 批2 设计页（sticky-note / countdown-menu / reminder-popover / common-items / tray-menu） |
| `docs/phase4/QA-REPORT-V0.2.0-BATCH1.md` | 批1 QA 报告 |
| `release/Timing.exe` | 批2 交付可执行文件 |
| `.workbuddy/memory/2026-10-16.md` | 全流程项目记忆 |

---

## UI 统一：小条对齐 Timing（2026-10-16 16:25）

**依据**：用户截图（上行参考 Timing 目标 / 下行本项目现状）+ Timing 源码 `MainForm.cs` 常量实测。

| 项 | 改前 | 改后（= Timing） |
|---|---|---|
| 状态环 | ⌀22 / stroke 2.6 / 全圆 | **⌀16 / 2.4**；运行=90°旋转弧（3.2s/圈）· 暂停=270°静弧（暖橙）· 倒计时=递减弧 |
| 计时数字 | 14px mono 650 | **20px Segoe UI Semibold 观感**（tabular-nums 保不抖动） |
| 事项名 | 13px / 500 / --ink-2 | **14px Bold 全墨**（暂停变暗由状态墨度 0.88 承载） |
| 分隔线 | 时间与名字之间 1px | **删除**（Timing 无） |
| 透明态 | 无阴影 | 文字/环带投埃 `--shadow-ink`，悬停淡出（Timing 同款） |
| 状态墨度 | 无 | idle 0.75 / paused 0.88 / 悬停回满（Timing PaintFrame 同款） |
| 环内图标 | hover 淡入播放/暂停 | **移除**（Timing 无环内图标；状态=环色+弧形；命中区仍 ⌀24） |

**门禁**：tsc 0 错 · build 成功 · emoji/紫粉/裸色 0 · 行数全 ≤300。
**交付**：`release/Timing.new.exe`（旧实例运行中占用 Timing.exe，关闭旧实例后可原地替换）。
