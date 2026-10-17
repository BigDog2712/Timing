# 页面 Override：崩溃恢复对话框 Recover Dialog

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：启动时检测到 active 会话（AC-14） | 主题：恒定深色 | 层：`--z-dialog` (70)
> 对应命令：`resolve_open_record`
> 相关验收：AC-14（继续/结束/丢弃三选一，丢失 <= 30s）/ AC-25

---

## 1. 布局与尺寸标注

```
        +-------------------------------------------+
        |  上次计时没有正常结束                       |   <- 标题 16px/590 --fg
        |                                           |
        |  品牌视觉改版 · 已计时 01:12:41             |   <- 会话摘要 13px --fg-2
        |  （开始于 09:12，意外退出）                 |   <- 辅助 12px --muted
        |                                           |
        |  [ 继续计时 ]  [ 结束并保存 ]  [ 丢弃 ]      |   <- 三选一
        +-------------------------------------------+
        宽 --panel-w+（见下）/ 圆角 --radius-lg 16
        遮罩 --scrim 全窗口（不使用 backdrop-filter）
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 宽 | 300px（`--panel-w`）| 与面板同宽 |
| 圆角 | `--radius-lg` 16px | |
| 底 | `--surface-2` | |
| 内边距 | `--space-6` 16px | 对话框比普通面板留白略大 |
| 投影 | `--elev-panel` | |
| 遮罩 | `--scrim`（`rgba(14,15,18,0.56)`）全覆盖 384x360 置顶层 | **不使用 `backdrop-filter`** |
| 定位 | 置顶层内居中 | 固定窗口内绝对居中 |
| 标题 | `--text-lg` 16px / `--weight-announce` 590 / `--fg` | |
| 会话摘要 | `--text-base` 13px / `--fg-2`；时长数字用 `--font-mono` 等宽 | `品牌视觉改版 · 已计时 01:12:41` |
| 辅助说明 | `--text-sm` 12px / `--muted` | `（开始于 09:12，意外退出）` |
| 按钮组 | 3 个按钮等高 32px，间距 `--space-3` 8px | 主 + 次 + 危险 |

---

## 2. 组件树

```
<RecoverDialog role="alertdialog" aria-modal="true">
+-- <Scrim/>                       // --scrim 全覆盖（无 backdrop-filter）
+-- <DialogCard>
    +-- <DialogTitle/>             // "上次计时没有正常结束"
    +-- <SessionSummary/>          // "{事项名} · 已计时 {HH:MM:SS}"（等宽数字）
    +-- <SessionMeta/>             // "（开始于 {HH:MM}，意外退出）"
    +-- <ButtonRow>
        +-- <ResumeBtn/>           // "继续计时"  primary（--accent）
        +-- <CloseBtn/>            // "结束并保存" secondary（1px 描边 + --accent 文字）
        +-- <DiscardBtn/>          // "丢弃"      ghost（--muted，hover -> --danger）
```

---

## 3. 状态与交互

### 3.1 三选一行为（对应 `resolve_open_record`）

| 按钮 | action | 结果 |
|---|---|---|
| 继续计时 | `resume` | 记录保持 active，`running_since = now`，回到 RUNNING；**休眠/关闭期间不计入**（单调时钟语义） |
| 结束并保存 | `close`（`endAt` = 上次落盘时间点附近） | 记录写为 saved，归入当前事项；丢失 <= `--size.recoverLossBudgetSec` 30s |
| 丢弃 | `discard` | 记录软删除（`deleted_at` 置位），不进汇总 |

> 三个按钮均为**非破坏性默认**：焦点默认落在「继续计时」（最保守），Tab 可及「结束并保存」与「丢弃」。

### 3.2 状态矩阵（5 态）

| 状态 | 表现 |
|---|---|
| Default | 三按钮可用，焦点默认「继续计时」，`--focus-ring` 可见 |
| Loading | `resolve_open_record` 进行中：对话框底 `--surface-3`，按钮禁用（`--meta`），卡片内 16px 半圆弧（240ms） |
| Error | `DB_ERROR`：标题下 11px `--danger` 提示「处理失败，已保留原记录」+「重试」；**不自动丢弃** |
| Success | `resolve_open_record` 返回后对话框关闭（`--dur-exit` 淡出），药丸按结果进入对应状态 |
| Edge | 会话时长 > 4h：摘要行右侧加 `--warn` 10px 圆点 + 「已连续计时 4 小时 12 分」（**不弹窗、不变红**） |
| Empty | 不适用（无 active 会话时不显示对话框） |

### 3.3 交互

| 输入 | 行为 |
|---|---|
| 点按钮 | 调 `resolve_open_record({ action, endAt? })`，成功后关闭 |
| `Tab` / `Shift+Tab` | 在 3 个按钮间循环（**焦点陷阱**：对话框内循环，不逃逸到药丸） |
| `Enter`（焦点在按钮） | 触发该按钮 |
| `Esc` | 等价「继续计时」（最保守，**不丢弃数据**） |
| 点遮罩 | 不关闭（必须显式选择，避免误触丢数据） |

### 3.4 动效

| 阶段 | 规格 |
|---|---|
| 入场 | 遮罩 `opacity 0 -> 1`（`--dur-base`）+ 卡片 `scale(0.98) -> 1` + `opacity 0 -> 1`（`--dur-base`，`--ease-standard`，**非弹性**） |
| 退场 | `opacity 1 -> 0`，`--dur-exit` 180ms，`--ease-exit`，无位移 |

### 3.5 prefers-reduced-motion

关闭缩放与淡入，卡片直接可见（`opacity 1`，`scale 1`）；三选一按钮状态仍 100% 可辨。

---

## 4. 引用的 Token 名

- 颜色：`--scrim` `--surface-2` `--surface-3` `--fg` `--fg-2` `--muted` `--meta` `--accent` `--accent-on` `--danger` `--warn` `--border` `--border-strong` `--focus-ring`
- 尺寸：`--panel-w` `--space-3` `--space-5` `--space-6` `--radius-lg` `--radius-sm` `--icon-sm` `--snap-margin`
- 阴影：`--elev-panel`
- 动效：`--dur-instant` `--dur-quick` `--dur-base` `--dur-exit` `--ease-standard` `--ease-exit`
- 排版：`--font-mono` `--text-lg` `--text-base` `--text-sm` `--text-xs` `--weight-announce` `--weight-emphasize` `--weight-read`
- 层级：`--z-dialog`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `clock` | `--icon-sm` 16px | 2.5 | 会话摘要行前缀（时长语义） |
| `play` | `--icon-sm` 16px | 2.5 | 「继续计时」按钮（可选前缀） |
| `check` | `--icon-sm` 16px | 2.5 | 「结束并保存」按钮（可选前缀） |
| `trash-2` | `--icon-sm` 16px | 2.5 | 「丢弃」按钮（危险语义预览） |
| `circle-alert` | `--icon-sm` 16px | 2.5 | 错误态提示 |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 遮罩 | - | `--scrim` 纯色半透明，**禁止 `backdrop-filter`** | 保持对比度可预测 + 省 GPU |
| 焦点默认 | 首个可交互元素 | **默认「继续计时」**（最保守，不丢数据） | 防误触丢弃（Riley 压力测试视角） |
| Esc 行为 | 关闭 | 等价「继续计时」而非「丢弃」 | 数据安全优先 |
| 点击遮罩 | 通常关闭 | **不关闭** | 必须显式三选一，避免误触丢数据 |
| 强调色用量 | 每屏 <= 2 | **仅 1 处**（「继续计时」主按钮） | 对话框是单一决策点，主选项唯一 |
| 按钮组留白 | --space-3 | 沿用；卡片内边距提至 `--space-6` 16px | 对话框需要更强"停顿感" |
