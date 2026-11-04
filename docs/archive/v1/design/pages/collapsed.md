# 页面 Override：收起圆点 Collapsed

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：点药丸右侧手柄 `chevron-right` | 主题：恒定深色 | 层：`--z-pill` (10)
> 对应命令：`get_timer_state` `start_timer` `pause_timer` `resume_timer` `stop_timer` `undo_stop`
> 相关验收：AC-01 / AC-23（多显示器位置正确）/ AC-25

---

## 1. 布局与尺寸标注

```
          收起前锚点（药丸左边缘）
                |
                v
          +----------+
          |   ( )    |   <- 可见直径 --dot-size 28
          +----------+      环描边 2.5px + 状态色；运行中带 halo
          |<- 36x36 ->|   <- 命中区 --hit-target-dot 36（< 44，见偏差说明）
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 可见直径 | `--dot-size` 28px | 只剩状态环 |
| 命中区 | `--hit-target-dot` 36x36 | **主动小于 `--hit-target` 44px**（见 §6 偏差） |
| 环描边 | 2.5px（收起态加强，补偿面积缩小） | 色 = 当前状态色 |
| 内容 | 仅状态环；RUNNING 时环下方带 `--accent-halo` | 无数字、无文字 |
| 位置 | 保持收起前药丸**左边缘锚点**位置，向左上收拢 | 变形过程连续，不跳位 |
| 悬停提示 | 延迟 `--size.hoverTooltipMs` 300ms 弹出 tooltip：`00:12:41 · 品牌视觉改版` | 12px / `--surface-3` / 圆角 `--radius-sm` 8 / 高 `--toast-h` 32 |

---

## 2. 组件树

```
<CollapsedDot data-state="idle|running|paused|ended">
+-- <StatusRing/>            环 28px（描边 2.5px）+ 可选 halo
+-- <HoverTooltip/>          hover 300ms 后：等宽时长 + " · " + 事项名
```

---

## 3. 状态与交互

### 3.1 状态矩阵

| 属性 | IDLE | RUNNING | PAUSED | ENDED（瞬时 900ms） |
|---|---|---|---|---|
| 环色 | `--state-idle` | `--state-running` | `--state-paused` | `--success` |
| 光晕 | 无 | `--accent-halo` 呼吸 `--dur-breath` | 无 | 绿光晕淡出 |
| 描边宽 | 2.5px | 2.5px | 2.5px | 2.5px -> 3px |

### 3.2 交互态

| 状态 | 规格 |
|---|---|
| Default | 环 2.5px 状态色，`--elev-ring` 内描边 |
| Hover（`--dur-quick`） | 环色提亮 8%，`scale(1.06)`（非弹性），300ms 后出 tooltip |
| Active（`--dur-instant`） | `scale(0.92)`，光晕 +0.04 |
| Focus-visible | `--focus-ring` 双环（外扩至可容纳双环，不裁剪） |
| Dragging | 可拖拽（阈值 `--drag-threshold` 4px），阴影 `--elev-drag` |
| Loading | 半圆弧 240ms |
| Error | 环闪 `--danger` 一次 |
| Empty | 与 IDLE 同（无记录可结束，仍可启动） |

### 3.3 交互

- 单击：展开回形态 A（药丸），`--dur-morph` 280ms `--ease-morph`；内容延迟 80ms 后 200ms 淡入。
- 右键单击（收起态）：弹出上下文菜单（无 active 记录可结束时语境自适应）。
- 拖拽：位置记忆（多显示器 + 相对右下角偏移）；吸附阈值 `--snap-margin` 16 DIP。

---

## 4. 引用的 Token 名

- 颜色：`--state-idle` `--state-running` `--state-paused` `--success` `--accent-halo` `--surface-3` `--fg-2` `--meta` `--focus-ring`
- 尺寸：`--dot-size` `--hit-target-dot` `--toast-h` `--radius-sm` `--space-3` `--snap-margin` `--drag-threshold`
- 阴影：`--elev-ring` `--elev-drag`
- 动效：`--dur-instant` `--dur-quick` `--dur-morph` `--dur-confirm` `--dur-breath` `--ease-standard` `--ease-morph`
- 排版：`--font-mono` `--text-sm`（tooltip 时长数字）
- 层级：`--z-pill` `--z-tooltip`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `play` | `--icon-sm` 16px | 2.5 | （可选）hover 动作提示 |
| `pause` | `--icon-sm` 16px | 2.5 | （可选）hover 动作提示 |
| `check` | `--icon-sm` 16px | 2.5 | ENDED 态环内对勾 |

> 收起态主体**不显示图标**（仅有状态环）；图标仅用于 hover/ended 的语义补偿。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 命中目标 | `--hit-target` 44x44 | `--hit-target-dot` **36x36** | Timing 是**常驻置顶覆盖层**，44px 隐形命中区会遮挡底层应用点击（Windows 头号坑）。补偿：鼠标场景 36px 已舒适 + 全局热键路径 + hover 即出 tooltip |
| 环描边 | `--ring-stroke` 2px | **2.5px** | 面积缩小到 28px，加粗补偿可见性 |
| tooltip 延迟 | - | `--size.hoverTooltipMs` 300ms | 防抖，避免扫过即弹 |
