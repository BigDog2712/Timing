# Timing 安卓版 PRD（V1）

| 项 | 值 |
|---|---|
| 版本 | V1 · 2026-11-02 · 产品经理 |
| 基线 | Timing **v0.4.1**（Windows 桌面 · Tauri 2.12 / React 19 / Rust / SQLite） |
| 事实来源 | `docs/phase2/IPC-CONTRACT-v2.md`（65 命令 / 16 错误码）· `IPC-CONTRACT-v3.md`（11 事件）· `src/components/` · `src-tauri/src/app/`、`infra/` |
| 已定前提 | ① Tauri 2 Android 原生包；② 功能对齐桌面；③ 手机独立本地存储，表结构与桌面 SQLite 对齐（留同步接口） |
| 本文不含 | 实现方案、测试用例、桌面端改造 |

## 0. 读代码后必须先纠正的三件事

| # | 桌面事实 | 对本文的影响 |
|---|---|---|
| F1 | **没有「日记」模块**。V0.3.4 整体下架（ADR-023）：`diary_get_config` / `diary_set_config` / `diary_today` / `diary_open_today` 与设置页「日记」页签全部删除，`DiaryConfig` / `TodayDiary` DTO 已不存在 | 「日记 Markdown」一律按现存的 **md-sync**（Markdown 双向同步）表述；可编辑日记页列为 P2「需新增」。不把已删功能写成桌面已有 |
| F2 | **没有独立统计页**。只有记录面板（日/周汇总 + 按事项分组）与事项窗表头的今日汇总，两者共用 `stats_summary` | 统计口径按 §6，不承诺趋势图 / 目标 / 连续天数 |
| F3 | **没有全局快捷键**（V0.3.3 下架，ADR-022；`register_shortcut` 已从 65 条命令中删除）。托盘、恒定置顶、单实例、开机自启仍在 | §5 差异表按「无快捷键可迁」处理 |

## 1. 目标 / 非目标

**目标**：把「点一下就开始计时、抬头就能看到今天花了多少」搬到手机上，且**离线、无账号、数据结构与桌面同构**，为将来接同步留门。

**非目标**

| 不做 | 理由 |
|---|---|
| 与桌面同步 / 跨设备合并 | 用户已定：手机独立本地存储。冲突合并策略不在本期 |
| 账号、云备份、登录 | 桌面即纯本地（无 HTTP、无网络权限），手机保持一致 |
| PWA / 网页版 / 小程序 | 用户已定：Tauri 2 原生包 |
| 复刻悬浮药丸（384×360 透明置顶窗、点击穿透） | 见 §5；手机端改为应用内整屏 + 通知栏 |
| 桌面之外的业务能力（多端协作、分享、社交） | 本期只做形态适配，不扩业务 |
| 桌面已有的「P1 预留未实装」（`create_manual_record` / `export_records_csv`） | 桌面自己都没做，手机不抢先 |

## 2. 用户故事（8 条）

| # | 作为… | 我要… | 以便… |
|---|---|---|---|
| U1 | 随时被打断的上班族 | 在锁屏前腾出一只手点一下就开计时 | 会议插进来也不丢时间 |
| U2 | 在家办公的人 | 一眼看到今天每个事项各花了多久 | 决定下午先做哪件 |
| U3 | 经常忘记关计时的人 | 重开 App 时被问「刚才那段还继续吗」 | 既不丢时长，也不把停机算成工作 |
| U4 | 用手机临时记事的人 | 给当前事项挂一张便利贴 | 想法不丢，回到电脑还能看到 |
| U5 | 设了「25 分钟后提醒我」的人 | 到点收到系统通知 | 不用一直盯着屏幕 |
| U6 | 待办清单用户 | 把一条待办一键变成计时 | 开始后不用再选事项 |
| U7 | 有固定节奏的人 | 一步「换事项 + 定长」直接开倒计时 | 重复动作不超过两下 |
| U8 | 把日记写在 Markdown 里的人 | 手机上的记录自动出现在今日文件里 | 回到电脑接着写，不用手动抄 |

## 3. 功能清单

### 3.1 P0（首个可发布版本，缺一不可）

| ID | 功能 | 桌面命令 | 手机端要点 |
|---|---|---|---|
| P0-1 | 计时主流程：开始 / 暂停 / 继续 / 结束 / 撤销 / 丢弃 | `start_timer` `pause_timer` `resume_timer` `stop_timer` `undo_stop` `discard_timer` `get_timer_state` | 主按钮单击 = 开始/暂停/继续；「结束」为独立按钮（不靠长按）；`stop_timer` 返回 `StopResult`，`discarded=true` 时**不出撤销条** |
| P0-2 | 计时归属切换 + 倒计时 | `switch_item` `start_countdown` `set_countdown_preset` | 切换分「结束并新开」/「仅改归属」两种，文案要说人话；倒计时到点恒结束并保存（无开关，ADR-023） |
| P0-3 | 崩溃 / 杀进程恢复 | `resolve_open_record` | 冷启动检测到 `active` 会话即弹三选一（继续 / 结束 / 丢弃）；`includeGap` 默认 false，需暴露成可选文案（「把中间的空白也算进去」） |
| P0-4 | 事项管理 | `list_items` `create_item` `update_item` `archive_item` `unarchive_item` `delete_item` | 允许同名（ADR-021）；「未归类」id=1 受保护；删除 = 软删，历史记录仍归属它 |
| P0-5 | 记录浏览 / 编辑 / 汇总 | `list_records` `stats_summary` `update_record` `delete_record` | 日/周两档；明细单页 100 条上限；改归属、改起止、改备注（≤500 字）、软删 |
| P0-6 | 待办 | `todo_list` `todo_create` `todo_update` `todo_delete` `todo_toggle` `todo_start` | `todo_start` = 按标题匹配事项后立即起计时，**待办当场移出待办区**；删除走「乐观删除 + 3s 撤销」 |
| P0-7 | 设置与主题 | `get_settings` `update_settings` `get_reference_settings` `update_reference_settings` `theme_get` `theme_set` `accent_get` `accent_set` | 主题 mode（深/浅/跟随系统）+ 四色 + 高亮色；最短记录时长 5–300 秒（默认 30） |
| P0-8 | 数据结构与桌面同构 | 无（表结构与 DTO） | 5 张业务表 + `settings` KV，迁移版本 4；DTO 字段名/枚举值/时间单位（epoch ms、时长秒）逐字对齐桌面 |

> P0 明确**不调用**的桌面窗口命令：`show_window` `hide_window` `toggle_window` `main_work_area` `main_window_rect` `save_window_position` `open_settings_window` `open_todos_window` `open_note_window` `open_timer_window` `close_note_window` `plugin_open_dir` `quit_app` —— 手机无窗口与进程托管，改页面路由，见 §5。

### 3.2 P1（对齐桌面完整能力）

| ID | 功能 | 桌面命令 | 说明 |
|---|---|---|---|
| P1-1 | 便利贴 | `note_create` `note_get` `note_list` `note_update` `note_delete`（桌面另有 `open_note_window` / `close_note_window`） | 手机单窗：列表 + 全屏编辑页，不做多窗；正文 ≤4000 字；溢出策略与桌面一致 |
| P1-2 | 提醒 | `reminder_set` `reminder_clear` `reminder_pending` | 需 Android 通知运行时权限；15s 查询式调度 + ±60s 聚合 + `reminded_at` 去重 |
| P1-3 | 今日简报与逐行状态 | `daily_status_get` `daily_status_set` | 桌面 = 今日简报浮层（按事项标 pending/done） |
| P1-4 | Markdown 同步 | `md_sync_get` `md_sync_save` `md_sync_run` `md_sync_open` | 落点选择走 SAF 目录授权（**配置模型需扩**，见 §8-Q2）；冲突最后写入者胜 |
| P1-5 | 插件（声明式） | `plugin_list`（`plugin_open_dir` 不适用） | 只读 `plugin.json` 启动头；摸鱼菜单预设来自 `contributes.quickTimers` |
| P1-6 | 摸鱼菜单 / 常用事项偏好 | `update_settings`（`moyuPresets` / `itemsShowRecent` / `itemsRecentCount` / `itemsTimers`） | 手机为底部快捷面板，不再依赖右键 |

### 3.3 P2（手机形态增强）

| ID | 功能 | 桌面命令 | 说明 |
|---|---|---|---|
| P2-1 | 可交互常驻通知（暂停 / 结束 / 当前时长） | 需新增 | 桌面靠托盘，手机只能靠通知 |
| P2-2 | 主屏小组件 / 长按快捷方式 | 需新增 | 桌面无对应概念 |
| P2-3 | 大计时页（横屏 / 折叠屏展开） | `open_timer_window` 语义借用 | 桌面是 280×180 只读窗，手机是整屏大字 |
| P2-4 | 导出 CSV | 需新增 | 桌面仅有预留接口，未实装 |
| P2-5 | 今日日记可编辑 | 需新增 | 桌面无此能力；只对 md-sync 的今日区块读写 |

## 4. 手机端信息架构

桌面主窗是 **384×360 透明画布收缩到约 210×48 的药丸**，手机**不复用该几何**：整屏单列、触控目标 ≥44×44dp、正文字号 ≥14sp、无悬停态。

```
底部导航（4 个一级页）
├─ ① 计时（默认）
│   ├─ 大计时环（状态色 + 弧）+ MM:SS + 当前事项名
│   ├─ 主按钮（开始 / 暂停 / 继续） + 结束按钮 + 撤销条（3s，浮于底部）
│   ├─ [倒计时] → 定长 Sheet（预设档 + 自定义）
│   ├─ [换事项] → 事项选择 Sheet（含最近使用 + 新建）
│   ├─ 长按计时数字 → 快捷面板 Sheet（摸鱼预设 / 换事项+定长 → switch_item + start_countdown）
│   └─ 右上角：便利贴列表入口 / 提醒入口 / 今日简报入口
├─ ② 事项
│   ├─ 今日汇总条（今日计时 N 条 · Xh Ym）
│   ├─ 待办列表（未完成 / 已完成可折叠）+ 新建待办卡（标题 + 时间 + 关联事项 + 便利贴预览）
│   ├─ 今日记录（按事项分组，点行 → 记录详情）
│   └─ 长按事项行 → 底部菜单（停止计时 / 编辑 / 归档 / 删除）
├─ ③ 记录
│   ├─ 日 / 周 分段控件
│   ├─ 总计 + 按事项分布（占比条）
│   └─ 明细列表（点行 → 编辑 Sheet；左滑 → 删除）
└─ ④ 设置（二级全屏页，四段）
    ├─ 外观：主题三选 / 四色 / 高亮色 / 文字·背景不透明度
    ├─ 插件：插件列表 + 摸鱼预设管理 + 常用事项偏好
    ├─ 同步：md-sync 落点 / 立即同步 / 打开今日文件
    └─ 通用：最短记录时长 / 通知权限 / 关于

全局覆盖层（不属于任何 Tab）
├─ 崩溃恢复对话框（冷启动，模态，不可下滑关闭）
├─ 记录编辑 Sheet、提醒设置 Sheet、通知提示条
└─ 空态 / 加载骨架 / 错误重试（三态与桌面一致）
```

**跳转关系**：①→②（点今日汇总）· ②→③（点「看全部记录」）· ③→记录编辑 Sheet（原地）· ①②③ 长按 → 底部菜单/Sheet · ④→同步/插件（二级）· 任意页 `返回键` 先关 Sheet 再退 Tab 再退到后台（不杀进程）。

| 页面 | 核心元素 | 触摸口径（无键盘/右键/悬停） |
|---|---|---|
| 计时 | 大环、MM:SS、事项名、主按钮、结束 | 单击 = 主操作；长按 500ms = 快捷面板；**结束不做长按**（延迟不可接受） |
| 事项 | 汇总条、待办行、今日记录行 | 长按行 = 菜单；左滑 = 删除；点行 = 编辑 |
| 记录 | 日/周分段、总计、分组占比、明细 | 左滑删除；点行编辑；下拉刷新 |
| 设置 | 四段分组卡 | 单击切换；数字项用数字键盘而非滑杆（沿用桌面 V0.3.5 决定） |
| 便利贴 | 列表卡（首行摘要 + 时间）、全屏编辑 | 点卡进入；返回自动保存；删除走确认条 |

## 5. 桌面 vs 手机差异表

| # | 桌面能力 | 代码位置 | 手机怎么办 |
|---|---|---|---|
| D1 | 透明无边框悬浮置顶药丸（PillBar，384×360 画布 auto-fit 到内容包围盒） | `src/components/pill/PillBar.tsx`、`hooks/useWindowAutoFit`、`infra/window.rs` | **不复刻**。改为①应用内计时首页；②常驻通知显示「事项 + 时长」（P2-1）；③「悬浮于其他应用之上」列为待确认（Q4），默认不做 |
| D2 | 系统托盘（原生 Win32 菜单，11 个菜单项随状态重建） | `app/tray.rs`、`infra/tray_menu.rs` | 无托盘。托盘菜单的入口拆成：通知（暂停/结束）+ 应用内首页（设置/事项/便利贴/提醒）+ 长按应用图标的快捷方式（P2-2） |
| D3 | 窗口位置记忆（`save_window_position` + `window-state` 插件，含多屏钳制） | `commands/system_cmd.rs`、`infra/window_rect.rs`、`infra/geometry.rs` | 无窗口位置概念，**不调用该命令**。等价的用户价值只剩「小条停靠位置」，若需要则新增本地偏好（不落库，避免污染桌面 schema） |
| D4 | 开机自启（`set_autostart` / `get_autostart`，写 `HKCU\...\Run`） | `infra/autostart.rs`、`settings_cmd.rs` | **不做**。Android 无等价语义（`BOOT_COMPLETED` 是另一回事，且商店审核敏感）。设置页「通用」不出现该开关 |
| D5 | 全局快捷键 | 已于 V0.3.3 删除（ADR-022），无代码 | 无可迁。手机不加全局手势/音量键触发 |
| D6 | 单实例锁（重复启动聚焦已有窗口） | `tauri-plugin-single-instance` | Android 系统本就单实例，**移除该插件与相关逻辑**，不做「再点图标唤起某页」的额外承诺 |
| D7 | 系统通知（`reminder-fired` / `countdown-finished` 走 WinRT Toast） | `infra/notify.rs`、`jobs/reminder.rs` | 保留，但需 `POST_NOTIFICATIONS` 运行时权限 + 单通道「计时提醒」；用户拒绝权限时降级为应用内提示条（不静默失败） |
| D8 | 多窗口（`settings` / `todos` / `note-{id}` / `timer` 各自独立窗） | `lib.rs` 窗口命令、`infra/window_spec.rs` | 单 Activity 多页面路由。便利贴由「多窗并存（上限 20）」改为「列表 + 单编辑页」，`WINDOW_LIMIT_EXCEEDED` 在手机不再有触发点（保留码不删，随桌面契约走） |
| D9 | 拖拽（拖药丸、拖便利贴、`data-tauri-drag-region`） | `hooks/usePillDrag`、`useWindowDragAnywhere` | 无。位置类交互全部改为固定布局 |
| D10 | 悬停显隐（悬停才显抓取柄 / 离开自动收起浮层 / 悬停显影） | `hooks/useHoverClose`、`pill-bar` 悬停态 | 无 hover。浮层改「点遮罩 / 下滑 / 返回键」关闭；原本只靠 hover 才出现的入口（抓取柄、备注）必须有常显替代入口 |
| D11 | 右键菜单（药丸右键 = 结束；事项行右键 = 事项菜单） | `components/menu/ItemMenu.tsx`、`TodosItemMenu.tsx` | 长按 500ms 唤出同一个底部 Sheet；**结束**单独给按钮，不只靠长按 |
| D12 | 滚轮调时长（摸鱼/倒计时定长） | `hooks/usePillWheel` | 改滚轮选择器 / 数字输入，单位分钟 |
| D13 | 键盘（Space 开始暂停、Enter 结束、Esc 收起、Menu 菜单） | `hooks/usePillKeyboard`、`useReminderKeys` | 无物理键盘。返回键 = 关上层；不实现快捷键 |
| D14 | 窗口级关闭即隐藏（K-5）、`quit_app` 真退出 | `infra/window.rs::on_window_event` | 返回键 = 退到后台，不退出；不提供「退出应用」，仅提供「结束当前计时」 |
| D15 | md-sync 落点用原生文件夹选择（`dialog:allow-open`） | `md_sync_cmd.rs`、`capabilities/default.json` | 必须改 SAF 目录授权（持久 URI）；**配置里的「路径字符串」模型不适用**，见 Q2 |
| D16 | `plugin_open_dir` 打开资源管理器 | `plugin_cmd.rs` | 无文件管理器可跳。改为应用内展示插件目录/已加载插件，或不做（P1 可不含） |
| D17 | 托盘双击高亮定位（`tray:highlight`） | `app/tray.rs` | 无入口，手机不订阅该事件 |

## 6. 统计口径（以 `stats_summary` 为唯一算法）

| 指标 | 口径 | 来源 |
|---|---|---|
| 总计时长 `totalSec` | Σ `accumulated_sec`，仅 `status='saved'` 且 `deleted_at IS NULL` | `stats_summary` |
| 条数 `recordCount` | 同上的行数 | `stats_summary` |
| 按事项分布 `byItem` | 按 `item_id` 聚合，`totalSec` 降序 | `stats_summary` |
| 区间 | `from ≤ started_at < to`（含头不含尾，**本地时区**）；日 = 当日 00:00 起 24h，周 = **周一** 00:00 起 7 天 | `lib/time.ts` |
| 跨零点会话 | 整条归属到**开始日期**，不切分 | `started_at` 过滤的必然结果 |
| 今日汇总（事项页表头） | 同上 + 明细 `list_records`（limit=100），展示「今日计时 · N 条 / 共 X 小时 Y 分」 | `TodosPanel` / `useTodayRecords` |

**不计入统计的情况**：① 时长 < 最短记录时长的非显式保存会话（手动结束 / 切换分段，默认 30 秒）；② `discard_timer` 与 `resolve_open_record(discard)` 的记录（软删）；③ 进行中的 `active` 会话（未 saved）；④ 已软删记录。
**明确没有**：趋势曲线、目标/达成率、连续天数、按标签/时段的分析、CSV 导出（桌面均未实装）。

## 7. 验收标准（P0）

| ID | 怎样算做对了（可观察） |
|---|---|
| P0-1 | 计时中强杀 App 再打开，重开后显示的数字与真实经过时间误差 ≤1s；点结束 3s 内出现撤销条，撤销后累计时长接续（不丢秒、不从 0 重算）；3s 后再点结束不会出现第二条记录 |
| P0-2 | 「结束并新开」后记录列表出现两条，前一条 `ended_at` = 后一条 `started_at`（±100ms）；「仅改归属」后仍是一条、总时长不变；倒计时到点必定落一条 saved 记录并弹通知 |
| P0-3 | 有未结束会话时冷启动必现三选一对话框；选「继续」后时长从落盘值起算，停机时段不计入；选「丢弃」后记录不再出现在任何列表，且能立刻开新计时 |
| P0-4 | 新建两个同名事项均成功；删除「未归类」被拒并有明确提示；归档后不出现在选择器，但其历史记录仍出现在记录页 |
| P0-5 | 把一条记录改归属后，「按事项分布」数字立即变化；删除后总计减少且重开 App 仍不出现；改起止导致结束早于开始时被拒并保留原值 |
| P0-6 | 勾选待办后 3s 内出现撤销条，撤销后恢复未完成；点待办「开始」后立刻进入计时，当前事项按**标题匹配**（同名事项直接复用，无同名则新建一条），且该待办立即从待办区消失 |
| P0-7 | 换主题/换色后当前页立即生效，冷启动仍是该配色；最短记录时长设为 60 秒后，计时 30 秒手动结束不产生记录且**不弹撤销条** |
| P0-8 | 同一份导出数据分别灌入桌面库与手机库，两端「今日记录」的条数、顺序、每条秒数逐条一致，`stats_summary.totalSec` 相等 |

## 8. 待确认问题（需用户拍板）

| # | 问题 | 为什么必须现在定 |
|---|---|---|
| Q1 | 「日记 Markdown」到底是哪一件：**(a)** 只做 md-sync（记录 ↔ Markdown 双向同步，桌面现状）；**(b)** 额外做一个可编辑「今日日记」页（桌面无，需新增命令 + 契约评审） | 决定 P1 是否升级为 P0，以及要不要动契约（65 命令的闭集） |
| Q2 | md-sync 落点在 Android 只能拿到 **SAF 持久 URI**（不是路径字符串）。是否接受「手机版落点配置与桌面不同构」？ | 直接冲突于「数据结构与桌面对齐」；会影响将来同步配置的合并 |
| Q3 | 倒计时到点 / 提醒是否必须「应用被划掉也能响」？若是，需前台服务 + 常驻通知 + 电池优化豁免（用户会看到一条不可消除的通知） | 决定 P0 是否必须包含前台服务，以及是否要做「下次打开才补」的降级口径 |
| Q4 | 是否要做「悬浮于其他应用之上」的小条（`SYSTEM_ALERT_WINDOW`）？ | 商店审核敏感、权限被拒后体验断层；这是 D1 唯一可能的替代，成本最高 |
| Q5 | 最低支持版本与是否要平板/折叠屏布局（minSdk 与横屏策略） | 影响 P0 的布局数量与 P2-3 是否提前 |
