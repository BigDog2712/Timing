# 悬而未决登记册（OPEN-DECISIONS）— TickBar

> 规范：只追加 + 就地关闭（OPEN → RESOLVED，补 Resolution 字段）。每次 Phase 开始时把未决项复现到工作上下文最前面。  
> 三类固定 slug：`waiting-on-external-condition`（等外部条件）/ `design-decision-to-evaluate`（设计待评估）/ `existing-design-boundary`（现有设计边界约束）。

## 汇总

- 未决（OPEN）：**0**
- 已决（RESOLVED）：**11**

> 注：0.3.0（2026-10-18）是**架构加固轮**（分层解环 / 权限最小化 / 机械门禁 / 可观测性，见 ADR-015~017），
> 当轮**未处理**下列最后 2 条 OPEN——它们分别动 `ErrorCode` 闭合 union 与 `notes` 表结构，
> 与架构改造不同源，需要各自走一次契约 / 迁移评审。
>
> **0.3.0 收尾（2026-10-18）已完成这两项**：`ITEM_NAME_TOO_LONG`（第 17 码，ADR-018）
> 与 `notes.is_pinned`（迁移 v3，ADR-019）。登记册至此清空，未决项为 0。

---

## 登记表

| Date       | Source                             | Open Item                                                         | Related Constraints                                                                       | Current Leaning                              | Blocked By                              | Resolves When                    | Status       |
| ---------- | ---------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------- | -------------------------------- | ------------ |
| 2026-10-16 | Phase 1 / PRD §12                  | 结束计时的收尾交互：弹收尾浮层 vs 一键保存                                           | 摩擦最低 vs 允许改归属                                                                             | 倾向"右键单击即保存 + 撤销条"                            | waiting-on-external-condition（用户拍板）     | 用户确认                             | **RESOLVED** |
| 2026-10-16 | Phase 1 / A-1                      | 全局快捷键 / 系统托盘 / 开机自启 是否纳入 MVP                                      | 团队简报列为关键诉求；PRD 列 P1                                                                       | 倾向至少"托盘 + 自启"进 MVP                           | waiting-on-external-condition（用户拍板）     | 用户确认                             | **RESOLVED** |
| 2026-10-16 | Phase 1 / 一致性问题 ②                  | 图标库版本口径不一（设计 ≥0.460 / 架构 1.57.0）                                  | 全项目唯一图标库                                                                                  | 以架构 `lucide-react` 为准，安装实际解析                 | existing-design-boundary                | Spec 锁定                          | **RESOLVED** |
| 2026-10-16 | Phase 1 / A-4                      | 悬浮条默认停靠位置与尺寸（架构建议 24px / 设计定 16 DIP）                              | 与吸附阈值一致                                                                                   | 采用 16 DIP（与 §9 平台规范一致）                       | existing-design-boundary                | Spec 锁定                          | **RESOLVED** |
| 2026-10-16 | Phase 1 / A-5                      | 本地匿名统计是否在 MVP 落地                                                  | 零遥测叙事                                                                                     | 维持 P1，MVP 不采集                                | existing-design-boundary                | Spec 锁定                          | **RESOLVED** |
| 2026-10-16 | V0.2.0 批1 Wave B / 后端回传 advisory#2 | 待办 `title` 超长（>200）无专属错误码，复用 `ITEM_NAME_EMPTY`（语义偏弱）              | `ErrorCode` 为闭合 union（V0.1.0 的 11 + V0.2.0 的 5 = 16），Spec §5 只授权新增 5 个，不得越权加第 17 码        | 复用 `ITEM_NAME_EMPTY` + 明确 message 承载（已落地并单测） | —（已解除）      | v0.3.0 增设 `ITEM_NAME_TOO_LONG` 并回填（已达成） | **RESOLVED** |
| 2026-10-16 | V0.2.0 批1 Wave B / 偏差 P-1          | 事项窗「待进行」态的分区归属：设计稿把它列在**今日计时区**，实现把它并入**待办事项区**（有时间/未设时间/已逾期三级语气） | `time_records` 无 `planned_at`；TickBar 的「计划」载体是 `todos.planned_at`，设计稿设想的「计划中的今日记录」数据模型不支持 | 保持现状（四状态语义均可达且视觉可区分）                         | waiting-on-external-condition（用户/设计师确认） | 用户/设计师确认分区归属                     | **RESOLVED** |
| 2026-10-16 | 批1 回归 QA 复验 / D-B1-07               | AC-54「提醒色」**可达性边界**：`--color-warn` 两处消费者（提醒铃需 `remind_at`、逾期文字需 `planned_at<now`）**均条件渲染**，而批1 UI 无入口设置 planned/remind ⇒ 常规流程下改「提醒色」可能**无可见像素变化** | 批1 未做排期/提醒入口；`0002_v020.sql` 无 todos seed | 机制完备（持久化 + 注入 + 消费者均通），留批2 凭排期/提醒入口可达；真机验 AC-54 需先造带 planned/remind 的待办 | waiting-on-external-condition（批2 功能） | 批2 交付排期/提醒入口后（已达成） | **RESOLVED** |
| 2026-10-16 | 批2 回归 QA / advisory#4 | 便利贴「置顶」开关状态未持久化：设计 `sticky-note.md §3.2` 提到状态入 `notes`，但 `notes` 表无 pin 列、前端 `useState(true)` 不落库 | `0002_v020.sql` 无 `notes.pin` 列；AC-64 仅要求「默认置顶」（已满足） | 已加 `notes.is_pinned` 列并落库（默认 1 = 置顶，迁移 v3） | —（已解除） | v0.3.0 加列并落库（已达成） | **RESOLVED** |
| 2026-10-16 | 批2 回归 QA / advisory#3 | ADR-011 所述倒计时到点「Web Audio 铃声」未实现：实际到点 = 系统通知 + 应用内视觉 | AC-47 仅要求「至少通知 + 视觉提示」（已满足）；铃声属 ADR 增强项 | 本期降级为「系统通知（OS 自带提示音）+ 应用内视觉」；Web Audio 铃声留后续 | design-decision-to-evaluate | 用户反馈需要铃声时 | **RESOLVED** |
| 2026-10-16 | 批2 回归 QA / advisory#6 | 无 VCS 基线（`tickbar` 非 git 仓库），反作弊门禁「测试删除 / 断言数下降」diff 检测不可执行 | 反作弊门禁需版本基线留痕 | 本期以绝对面兜底（18 测试文件 / 477 断言 / 零 skip·ignore·桩）；建议后续纳入 git | existing-design-boundary | 项目纳入 VCS | **RESOLVED** |
| 2026-10-16 | 持续优化轮 / lead | （上条收口）Resolution：项目根已 `git init`（main 分支，.gitignore 排除 node_modules/target/dist/release），基线 commit `a96ae16` 含批2 全量 + 小条 Timing 对齐；此后反作弊门可跑 `git diff` 检测测试删除/断言下降。Resolved by：team-lead（2026-10-16 17:1x） | — | — | — | — | **RESOLVED** |

### Resolution 明细

**#1 结束计时收尾交互 → RESOLVED**

- Resolution：采用「右键单击 = 立即结束并保存（默认当前事项）+ 3 秒撤销条」；右键长按 ≥500ms = 上下文菜单。数据模型去掉 `draft` 态，新增 `undo_stop` 命令。升格为 Spec §13 变更记录，Phase 2 由架构师补 ADR-007。
- Resolved by：用户裁决（2026-10-16）

**#2 托盘 + 开机自启进 MVP → RESOLVED**

- Resolution：两项由 P1 提升为 P0（MVP），形成 P0-5 / P0-6；全局快捷键仍留 P1。升格为 ADR-008（Phase 2 架构师产出）。
- Resolved by：用户裁决（2026-10-16）

**#3 图标库版本口径 → RESOLVED**

- Resolution：全项目唯一图标库 = `lucide-react`；版本基线 1.57.0，以安装时实际解析锁定。

**#4 停靠位置 → RESOLVED**

- Resolution：默认右下角，距屏幕边 16 DIP；吸附阈值 16 DIP、吸附后固定边距 16 DIP。

**#5 本地统计 → RESOLVED**

- Resolution：维持 P1，MVP 不采集任何统计（保持零遥测）。

**#6 「待进行」分区归属（偏差 P-1）→ RESOLVED**

- Resolution：**保持现状**（四状态语义均可达且视觉可区分）；批1 回归 QA 复验判定「**不影响 AC-34/35 达成，不构成缺陷**」。设计稿 `pages-V0.2.0/todos-panel.md §1` 已补「分区说明」（`time_records` 无 `planned_at`，「待进行」＝待办区中已排期未开始的行）。
- Resolved by：team-lead 裁定（2026-10-16）+ QA 复验确认

**#8 D-B1-07：AC-54「提醒色」可达性边界 → RESOLVED**

- Resolution：批2 交付**提醒入口**（小条右键 / 事项右键「提醒…」→ `reminder_set` 写 `items.remind_at`）+ **排期/提醒入口**（待办 `planned_at`）后，`--color-warn` 两个条件渲染消费者（提醒铃 / 逾期文字）在常规流程下**可达**，改动「提醒色」有可见像素变化，AC-54 判定路径打通。真机验证 AC-54 需先造带 remind/planned 的数据（见 `docs/phase4/RM-CHECKLIST-V0.2.0-BATCH1.md` 造数据 SQL）。
- Resolved by：批2 交付（2026-10-16）

**#9 ADR-011「Web Audio 铃声」→ RESOLVED（降级）**

- Resolution：V0.2.0 倒计时到点行为实现为「系统通知（复用 ADR-010 通知通道，随 OS 自带提示音）+ 应用内视觉（`useAppBootstrap` `setNotice` + `flashEnded`）」；AC-47「至少通知 + 视觉提示」**满足**。ADR-011 §6 的 Web Audio 铃声本期不实现，ADR-011 已就地标注降级。
- Resolved by：team-lead 裁定（2026-10-16）

**#10 待办 `title` 超长无专属错误码 → RESOLVED（0.3.0 收尾）**

- Resolution：增设第 17 码 `ITEM_NAME_TOO_LONG`（`error.rs` + 前端 `ErrorCode` 联合类型 + 契约 §2.3），
  三个超长检查点（事项名 >60 / 待办标题 >200 / 便利贴正文 >4000）全部改用它；
  顺带补上后端缺失的事项名长度校验（此前只有前端 `maxLength=60`，IPC 可绕过）。
  机械凭据：`npm run check:contract` 输出 `错误码：Rust 17 / 前端 17`。
- Resolved by：ADR-018（2026-10-18）

**#11 便利贴「置顶」开关状态未持久化 → RESOLVED（0.3.0 收尾）**

- Resolution：加列 `notes.is_pinned INTEGER NOT NULL DEFAULT 1`（迁移 `0003_v030.sql` + `ensure_column` 守卫，
  `schema.version` 2 → 3）；建窗按列值决定 `always_on_top`，`note_update` 带 `isPinned` 时落库并
  `set_always_on_top` 即时生效；`NoteHeader` 补第三枚置顶点（实心 = 置顶 / 空心环 = 取消），
  仍零文字。默认 1 使老便利贴升级后行为不变。
- Resolved by：ADR-019（2026-10-18）
