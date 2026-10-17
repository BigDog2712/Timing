# 页面：上下文菜单 ContextMenu（V0.2.0 · 改造）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> **图例**：本文 ASCII 示意图中的 ○ / ● / ◐ 仅为实现层 SVG/CSS 图形的示意记号，非图标资产；实现一律使用 lucide-react SVG。
> 本文件只写**本页规格**与**差异字段**。
> 触发：小条右键长按（≥500ms）/ 事项右键 / 悬浮菜单 | 主题：深/浅双主题 | 层：`--z-menu` (60)
> 来源：对齐 Timing §4.5 `GlassMenu`
> 形态：**自绘玻璃菜单 + 键盘 ↑↓/Enter/Esc 导航**
> V0.2.0 改造：统一走自绘玻璃；补键盘可达性；行高 28→30；补图标；禁用项明确「点不了」

---

## 1. 布局与尺寸标注

```
+--------------------------------------+  min-width 184 / padding 6 / r-lg 12
| ● 摸会儿鱼              12:34         |  ← 顶部状态块（--bg-field + r 8 + padding 9 10）
| 倒计时 · 剩 07:26                     |     ● = 7px --accent 圆点 + 3px --accent-wash 光环
+--------------------------------------+
| [=] 今日事项                          |  ← 行高 30 / padding 0 9 / gap 10 / r 6
| [timer] 今日计时                    on     |  ← 当前项：右侧 --accent 勾（.tick）
| [list] 打开今日日记                       |
| [◐] 切到浅色                          |  ← 主题联动（深色时显示「切到浅色」）
| [settings] 设置…                             |
| [eye-off] 隐藏到托盘                        |
+--------------------------------------+
   破坏性项 / 禁用项 / 分组标题 / 分隔线 见 §1 表
```

| 元素 | spec |
|---|---|
| 容器 | `min-width --menu-w` 184 + `padding --menu-pad` 6 + `--radius-lg` 12 |
| 底 | 玻璃 `--menu-bg`（94% / 浅色 97%）+ 1px `--line-2` + `--shadow-float` |
| 行高 | `--menu-item-h` 30；`padding 0 --menu-item-pad-x` 9；gap `--menu-icon-gap` 10；`radius 6` |
| 行文字 | `--menu-text`（`--ink-2`）；hover → `--bg-field-hi` 底 + `--menu-text-on`（`--ink`） |
| 图标 | 16px 描边型，`--ink-4`；hover → `--ink-3` |
| 键位 / 信息位 | 等宽 11 / `--ink-4`，右对齐 |
| 当前项 | 左 3×16 `--accent` 竖条（`.mi.on`）**或** 右侧 `--accent` 勾（`.tick`）—— 二选一 |
| 破坏性项 | `--danger` 字 + 图标；hover 底 = `--danger-wash` |
| 禁用项 | `--ink-4` + `opacity .55`；**hover 不变色** |
| 分隔线 | 1px `--line`，`margin 5px 6px` |
| 分组标题 | 10.5 / 600 / `.08em` / `--ink-4` |
| 状态块 | `--bg-field` 底 + 1px `--line` + `radius 8` + `padding 9 10`：`●任务名 … 12:34`（7px `--accent` 圆点 + 3px `--accent-wash` 光环；时间等宽 12 / `--ink-2`）；第二行 `倒计时 · 剩 07:26` 11.5 / `--ink-3` |

---

## 2. 组件树

```
<ContextMenu rows={[...]} kind="bar|item">
+-- <MenuStatusBlock/>      计时中/暂停时显示（空闲不显示）
+-- <MenuGroup label/>      可选分组标题
+-- <MenuItem icon label info key on danger disabled/>  × N
+-- <MenuSeparator/>
```

---

## 3. 状态与交互

### 3.1 行语义（两种入口）

**小条右键（7 项）：** 今日事项 / 今日计时（当前项 on）/ 打开今日日记 / 切到浅色|深色 / 设置… / 隐藏到托盘。

**事项右键（11 项，含危险项）：**

| 项 | 图标 | 语义 |
|---|---|---|
| 停止计时 · {事项名} | `square` | 主动作 |
| 编辑事项 | `pencil` | |
| 关提醒 · {事项名} | `bell` | 有提醒时显示 |
| 增加备注… | `message-square-plus` | |
| 编辑备注… | `message-square` | 有备注时 |
| 便利贴… | `sticky-note` | 开便利贴窗口 |
| 复制备注 | `copy` | 有备注时 |
| **删除事项** | `trash-2` | **危险项**（`--danger` + hover `--danger-wash`） |

### 3.2 交互态

| 状态 | 菜单行 | 状态块 | 菜单容器 |
|---|---|---|---|
| Default | 字 `--ink-2` / 图标 `--ink-4` | 静态 | 玻璃 + `--line-2` + `--shadow-float` |
| Hover（`--dur-quick`） | 底 `--bg-field-hi` + 字 `--ink` + 图标 `--ink-3` | — | — |
| Active | 底 `--bg-field-hi`，`scale(0.99)` | — | — |
| Current | 左竖条 `--accent` 或右勾 `--accent`，字 `--ink` | — | — |
| Danger hover | 底 `--danger-wash` + 字 `--danger` | — | — |
| Disabled | `--ink-4` + `opacity .55`，**hover 无变化** | — | — |
| Focus-visible | `--focus-ring` 双环（键盘高亮当前行） | — | — |
| Loading | 菜单打开时若需拉数据 → 状态块显示 `--ink-3` 骨架 | — | — |
| Error | — | 状态块第二行显示 `--danger`「状态读取失败」 | — |
| Empty | 不适用（菜单必有项） | 空闲时状态块显示「空闲 · 点开始正计时」 | — |
| Edge | 长事项名撑宽至上限后省略号；靠近屏幕边缘自动翻转方向 | — | — |

### 3.3 键盘可达性（V0.2.0 新增 — Timing §8-9 遗留项）

Timing 的 `GlassMenu` 原只有鼠标路径；V0.2.0 必须补：

| 键 | 行为 |
|---|---|
| `↑` / `↓` | 在当前行上下移动（跳过禁用项） |
| `Home` / `End` | 跳到首 / 末可用项 |
| `Enter` | 执行当前项 |
| `Esc` | 关闭菜单（不执行） |
| `Tab` / `Shift+Tab` | 移出菜单并关闭（焦点交还触发元素） |
| 字母键 | 加速键（如 `D`=删除，可选） |

> **打开时**：焦点落在第一项；**关闭时**：焦点交还触发元素（小条 / 事项行）。点菜单外 → 关闭（`--dur-exit` 180ms）。

### 3.4 打开 / 关闭

- 打开：`--dur-base` 200ms（`opacity 0→1` + `translateY -4→0`），`--ease-standard`。
- 关闭：`--dur-exit` 180ms。
- 定位：以触发点左上为锚，贴边自动翻转（不越出工作区）。

---

## 4. 引用的 Token 名

- 颜色：`--menu-bg` `--line` `--line-2` `--bg-field` `--bg-field-hi` `--menu-text` `--menu-text-on` `--menu-danger` `--menu-group-label` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--accent-wash` `--danger` `--danger-wash` `--focus-ring`
- 尺寸：`--menu-w` `--menu-item-h` `--menu-item-pad-x` `--menu-icon-gap` `--menu-pad` `--menu-status-h` `--radius-lg` `--radius-md` `--icon-sm`
- 阴影：`--shadow-float`
- 动效：`--dur-base` `--dur-exit` `--dur-quick` `--ease-standard` `--ease-exit`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `list` `clock` `book-open` `settings-2` `eye-off` | 16px | 2.5 | 小条右键各项 |
| `square` `pencil` `bell` `message-square-plus` `message-square` `sticky-note` `copy` | 16px | 2.5 | 事项右键各项 |
| `sun` / `moon` | 16px | 2.5 | 主题切换项 |
| `trash-2` | 16px | 2.5 | 删除事项（`--danger`） |
| `check` | 16px | 2.5 | 当前项勾（`.tick`） |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 行高 | 28 | **30** | Timing §4.5 对齐 |
| 键盘 | 通用 focus 环 | **完整 ↑↓/Home/End/Enter/Esc** | 补 v1 缺失的键盘可达性 |
| 禁用项 | opacity 降低 | **`--ink-4` + .55 + hover 不变色** | 明确「点不了」 |
| 玻璃 | 浮层玻璃 | 同款（94%） | 与倒计时 / 常用项菜单同一语言（**托盘菜单为原生，不参与**） |
