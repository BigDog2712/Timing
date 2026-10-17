# 页面 Override：撤销条 UndoBar

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：`stop_timer` 成功后 3 秒内（AC-05 / AC-06 / AC-07） | 主题：恒定深色 | 层：`--z-undo` (40)
> 对应命令：`stop_timer` `undo_stop`
> 相关验收：AC-05 / AC-06 / AC-07 / AC-25

---

## 1. 布局与尺寸标注

```
              +-------------------------------------------+
              |  已记录 22:08 · 设计评审        [ 撤销 ]   |   <- 高 --toast-h 32
              +-------------------------------------------+
               圆角 --radius-md 12 / 底 --undo-bg / 描边 1px --undo-border
               距药丸下方 --space-3 8px
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 高 | `--toast-h` 32px | |
| 圆角 | `--radius-md` 12px | |
| 底 | `--undo-bg`（`--bg` 深渊 L0） | 比药丸更暗，形成"下沉的提示" |
| 描边 | 1px `--undo-border`（`--border`） | 装饰性 |
| 投影 | `--elev-float` | |
| 位置 | 药丸下方 `--space-3` 8px | **不做从屏幕外滑入**（会抢注意力） |
| 文案 | 12px / `--weight-read`，`--undo-text`（`--fg-2`）；时长数字用 `--font-mono` | `已记录 22:08 · 设计评审` |
| 操作按钮 | 「撤销」12px/510 `--undo-action`（`--accent`） | 唯一强调点（本组件 = 1 处强调色） |
| 生命周期 | `--dur-undo` 3000ms | 到期静默退场 |

---

## 2. 组件树

```
<UndoBar>
+-- <UndoText/>            // "已记录 {HH:MM:SS} · {事项名}"（等宽时长 + 分隔点 + 名称）
+-- <UndoButton/>          // "撤销"，--undo-action
```

---

## 3. 状态与交互

> **契约常量对齐：** 撤销窗口严格 = `--dur-undo` **3000ms** = `src/types/domain.ts` 导出的 **`UNDO_WINDOW_MS`**（IPC-CONTRACT-v2 锁定）。前端不得另立常量，两处必须同源。

### 3.1 状态矩阵（5 态）

| 状态 | 表现 |
|---|---|
| Default（Populated） | 正常文字 + 「撤销」按钮，倒计时 3000ms |
| Hover（按钮） | 「撤销」文字 -> `--accent-hover`，底 `--surface-2` 圆角 pill，`--dur-quick` |
| Focus-visible | `--focus-ring` 双环（**键盘用户可 `Tab` 到「撤销」并 `Enter` 触发**） |
| Active | `--accent-active`，`--dur-instant` |
| Loading | 不适用（`undo_stop` 为本地事务，极快） |
| Success | 撤销成功：撤销条立即退场，环回琥珀 RUNNING，时长接续（无 toast 叠加） |
| Error | `undo_stop` 失败 / 窗口过期 -> `TIMER_NO_UNDO`：忽略并同步状态，撤销条按正常退场 |
| Empty | 不适用（有记录才出现） |
| Edge | 事项名超长 -> 截断到 11 中文字符 + 省略号；总宽不超药丸最大宽 |

### 3.2 特殊变体：短时计时（< 60 秒结束）

计时 < 60 秒时**不静默保存**，撤销条换正文案：

| 元素 | 内容 |
|---|---|
| 正文 | 「只记了 47 秒，要留下吗？」（`--text-sm`，`--undo-text`） |
| 主按钮 | 「保存」（文字 `--accent`，510） |
| 次按钮 | 「丢弃」（ghost，文字 `--muted`，hover -> `--danger`） |

### 3.3 特殊变体：保存失败

| 元素 | 内容 |
|---|---|
| 底 | 保持 `--undo-bg`；描边 -> `--danger` |
| 正文 | 「保存失败 · 记录已留在本地，点此重试」 |
| 图标 | `circle-alert` 16px `--danger`（**不用 Unicode 警告符号**） |
| 操作 | 「重试」 |

### 3.4 特殊变体：自动保存旧记录

计时中新建事项时先自动保存旧记录，撤销条文案：「已保存 上一条 · 22:08」+「撤销」。

### 3.5 交互

| 用户操作 | 反馈 |
|---|---|
| 点「撤销」 | `undo_stop(recordId)` -> 记录回滚为 active，环回 RUNNING，累计时长接续，撤销条立即退场 |
| 不做操作（3s 到） | 记录保持已保存，界面回 idle，撤销条 `--dur-exit` 180ms 淡出（**无位移**） |
| 键盘 `Enter`（焦点在撤销条） | 等价点「撤销」 |

### 3.6 动效

| 阶段 | 规格 | 信息 |
|---|---|---|
| 入场 | 从药丸下方 8px：`translateY(-6px) + opacity 0` -> `translateY(0) + opacity 1`，`--dur-morph` 280ms `--ease-morph` | "有个东西可以撤销" |
| 退场 | `opacity 1 -> 0`，`--dur-exit` 180ms `--ease-exit`，**无位移** | 静默离场 |

---

## 4. 引用的 Token 名

- 颜色：`--undo-bg` `--undo-border` `--undo-text` `--undo-action` `--accent-hover` `--accent-active` `--surface-2` `--muted` `--danger` `--fg-2` `--focus-ring`
- 尺寸：`--toast-h` `--space-2` `--space-3` `--space-5` `--radius-md` `--radius-chip` `--icon-sm` `--pill-w-max`
- 阴影：`--elev-float`
- 动效：`--dur-instant` `--dur-quick` `--dur-exit` `--dur-morph` `--dur-undo` `--ease-standard` `--ease-exit` `--ease-morph`
- 排版：`--font-mono` `--text-sm` `--text-xs` `--weight-read` `--weight-emphasize`
- 层级：`--z-undo`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `undo-2` | `--icon-sm` 16px | 2.5 | 「撤销」按钮前景（可选，文字 + 图标） |
| `circle-alert` | `--icon-sm` 16px | 2.5 | 保存失败态提示 |

> 禁止用 `U+26A0` 警告三角 / `U+2714` 对勾等字符符号，一律用 `circle-alert`。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 底色 | `--surface` / `--surface-2` | `--undo-bg`（**`--bg` 深渊 L0，比药丸更暗**） | 撤销条是"临时浮出物"，用比药丸更暗的底形成层级下沉 |
| 入场方向 | 位移入场 | 仅 `translateY` -6px -> 0，**不从屏幕外滑入** | 避免抢注意力（它是可撤销提示，非必须响应） |
| 强调色用量 | 每屏 <= 2 | 本组件**仅 1 处**（「撤销」文字） | 撤销条是独立小浮层 |
| 生命周期 | - | 严格 `--dur-undo` 3000ms | AC-07 撤销条过期行为 |
