# 页面：便利贴 StickyNote（V0.2.0 · 新增 · 多窗口）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> **图例**：本文 ASCII 示意图中的 ○ / ● / ◐ 仅为实现层 SVG/CSS 图形的示意记号，非图标资产；实现一律使用 lucide-react SVG。
> 触发：小条右键「便利贴…」/ 事项右键「便利贴…」| 主题：深/浅双主题 | 层：`--z-note` (20)
> 来源：对齐 Timing §4.2 `StickyNoteForm`
> 形态：**每个便利贴一个独立 `WebviewWindow`**（可拖拽、可缩放、位置持久化）
> 窗口默认：`--note-w` 320 × `--note-h` 232（原 Timing 现状 300×200）
> 对应命令：`note_create` `note_update` `note_delete` `note_list` `note_get` `open_note_window` `close_note_window`
> 事件：`note-window-opened` / `note-window-closed`

---

## 1. 布局与尺寸标注

```
+----------------------------------------------------------+  320 × 232（默认可缩放）
| 上厕所                                       [trash] [x] |  ← 头 36：标题 13/600  | 两个 26×26 图标按钮
+----------------------------------------------------------+
| +------------------------------------------------------+ |
| | 测试                                                   | |  ← 正文编辑区：--note-body-bg --bg-inset / radius 8
| | 买完咖啡回工位，顺手把今天的计划列一下。                | |     padding 9 11，6px 自绘滚动条
| |                                                        | |
| +------------------------------------------------------+ |
| 第 1 条会同步到记录行 · 换行折叠为空格                        |  ← 页脚 34：11.5/--note-foot-ink，分隔点分句
+----------------------------------------------------------+
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 默认尺寸 | `--note-w` 320 × `--note-h` 232 | 可拖拽缩放 |
| 缩放下限 | `--note-w-min` **160** × `--note-h-min` **120** | 架构应用层硬钳制（保证两行正文 + 删除确认条两按钮不挤压） |
| 缩放上限 | `--note-w-max` **900** × `--note-h-max` **900** | 架构**静态天花板**；**运行时再受当前屏 `work_area` 收窄** → 实际最大 = `min(900, work_area.width/height)`（小屏更小） |
| 舒适上限 | `--note-w/h-comfort-max` 640 / 480 | 设计建议（PM 建议值）；**软提示 / 拖拽吸附**，**不拦截用户拖拽**（仅硬钳制可拦截） |
| 置顶 | **默认 always-on-top = 是** | 否则被工作窗口盖住就失去意义（AC-64） |
| 数量上限 | `--note-max-count` **20**（架构 ADR-009） | 达上限时「新建便利贴」入口置灰并提示「最多 20 张」 |
| 圆角 | `--radius-lg` 12（WebView 原生 `border-radius`） | 原 WinForms 硬直角 |
| 底 | 玻璃 `--glass-panel-bg`（94% / 浅色 97%） | **不使用 `Form.Opacity` 整窗透明** |
| 描边 | 1px `--line-2` | |
| 投影 | `--shadow-plate` | |
| 头高 | `--note-head-h` 36 | 标题 13/600 |
| 页脚高 | `--note-foot-h` 34 | 11.5 / `--note-foot-ink` |
| 正文区 | `--note-body-bg`（`--bg-inset`）+ `--radius-sm` 8 + `padding 9 11` | focus = 1px `--accent-line` + 3px `--accent-wash` 外发光 |
| 滚动条 | 宽 6，thumb `--radius-full` `--line-3` | 自绘，无箭头 |

---

## 2. 组件树

```
<StickyNote>
+-- <NoteHeader/>      标题 13/600 + [IconButton trash] + [IconButton x]（两个 26×26 同尺寸同形态）
+-- <NoteBody/>        无边框可编辑区（--note-body-bg）+ 6px 滚动条 + 空态 placeholder
+-- <NoteFooter/>      「第 N 条会同步到记录行 · 换行折叠为空格」（11.5 · --note-foot-ink）
+-- <InlineConfirm/>   删除确认条（替换「两次点击 + 3s 超时」）
```

---

## 3. 状态与交互

### 3.1 「未悬停全透只剩正文」（V0.2.0 新增需求）

便利贴的默认态是**「几乎只有正文浮在桌面上」**——头/页脚/按钮在**未悬停时淡出**，鼠标进入后整块显影。

| 状态 | 头 / 页脚 / 按钮 | 正文 | 底 / 描边 |
|---|---|---|---|
| **未悬停（sticky 态）** | `opacity 0`（不可点，`pointer-events: none`） | `opacity 1`，正常可读 | 底**更透**（`--glass-hover-bg` 74% / 浅色 86%）**无描边**（去 `--line-2`）、去 `--shadow-plate` |
| **悬停 / 聚焦**（鼠标进入或正文获得焦点） | `opacity 1`（`--dur-exit` 180ms） | 不变 | 底 → `--glass-panel-bg` 94% + 1px `--line-2` + `--shadow-plate` |
| **拖拽移动** | 同悬停 + `cursor: grabbing` | — | `--shadow-plate` 加强 |

> 注意 **可读性红线**：即便「全透」，**正文文字始终 100% 不透明**（用 `--ink`），只让**背景板**更透。这条是 Timing §1 第 11 号硬伤（双重透明导致对比度不可控）的直接修复。
> 注意 **可输入性**：便利贴**严禁** `WS_EX_NOACTIVATE` 类等价设置（否则输不进字）。WebView 窗口需可获焦。

### 3.2 关联关系与置顶（AC-63 / AC-64）

- **关联关系（AC-63）**：一张便利贴**只关联一个事项**（`notes.item_id` 单值），或解绑为「**随记**」（`item_id = null`）。**不支持一对多** —— 否则「备注 ↔ 记录行镜像」语义会混乱。
  - 从「事项右键 → 便利贴…」创建 ⇒ `item_id` = 该事项；页脚显示「第 N 条会同步到记录行」。
  - 从托盘 / 菜单「新建便利贴」创建 ⇒ `item_id = null`，页脚显示「随记 · 未关联事项」，并提供 `[link] 关联事项…` 入口。
  - 页脚可 `[link] 关联` / `[link-off] 解绑` 切换，切换即时生效。
- **置顶（AC-64）**：**默认 always-on-top = 是**（否则被工作窗口盖住就失去意义）。用户可在头按钮区（hover 时出现 `[pin]`）取消置顶；状态持久化进 `notes`。
- **可输入（AC-64）**：**「未悬停全透」状态下正文仍可获焦、可输入** —— 点击正文即进入编辑（`pointer-events` 在正文区始终为 `auto`；只有头/页脚/按钮在未悬停时 `pointer-events: none`）。

### 3.3 交互态

| 状态 | 头按钮（trash / x） | 正文 |
|---|---|---|
| Default | `background: transparent`，`color: --ink-3` | `--ink`，placeholder `--ink-4` |
| trash hover | 底 `--danger-wash` + 字 `--danger` | — |
| x hover | 底 `--bg-field-hi` + 字 `--ink` | — |
| Focus-visible | `--focus-ring` 双环 | 1px `--accent-line` + 3px `--accent-wash` 外发光 |
| Active | `scale(0.92)` | — |
| Loading（首次打开） | 骨架标题 + 正文骨架（`--bg-field`） | 只读 |
| Error（保存失败） | 页脚临时换 `--danger` 文案 + 重试 | 保留内容 |
| Empty（无内容） | 正文 placeholder「写点什么…」（`--ink-4`） | — |
| Edge | 超长文本 → 内部滚动；超长标题 → 省略号；空标题 → 「未命名」（`--ink-4`） | — |

### 3.4 删除确认（内联确认条，替换两次点击 + 3s 超时）

Timing 现状是「首次点击按钮变红 + 3s 超时」。V0.2.0 改为**内联确认条**（可见、可读、说明连带影响）：

```
+----------------------------------------------------------+
| 删除这张便利贴？                                            |  ← 13/--ink
| 记录行里已同步的那条备注也会一并移除。                       |  ← 11.5/--ink-3
|                        [ 取消 ghost ]  [ 确认删除 danger ]  |
+----------------------------------------------------------+
  底 --note-confirm-bg（--danger-wash）+ 1px rgba(danger,.30) 描边
```

| 项 | 值 |
|---|---|
| 容器 | `--note-confirm-bg` + 1px `--note-confirm-line`（30% alpha）描边 + `--radius-md` |
| 文案 | 明确写出「记录行里已同步的那条备注也会一并移除」 |
| 按钮 | `danger` 确认 + `ghost` 取消 |
| **窄宽自适应** | **note 宽 ≥ 200px → 按钮单行右对齐**；**< 200px → 按钮竖排、各 `width:100%` 满宽**（见下） |

**窄宽自适应（保证 AC-63 下限 160px 下「两按钮不挤压」）：**

单行排布所需内容宽 = 取消(≈43) + gap8 + 确认删除(≈68) = **≈119px**；而 note 宽 160 时确认条可用内容宽仅 **≈118px**（160 − 正文左右 11×2 − 条内边距 10×2）→ **单行会挤压 1px**。故：

- **`note 宽 ≥ 200px`**：单行、右对齐（`[取消] [确认删除]`）。
- **`note 宽 < 200px`**（含 160 下限）：**竖排、每枚 `width: 100%`、高 `--btn-sm-h` 24、gap `--space-2`**。竖排下按钮内容宽 ≈118 ≥ 「确认删除」所需 ≈68 → **不挤压**，下限语义（AC-63）成立。

```
窄宽（<200px）竖排：
+--------------------------+
| 删除这张便利贴？            |
| 同步的备注也会一并移除。      |
| [       取消        ]     |  ← width:100%
| [     确认删除       ]     |  ← width:100%, --danger
+--------------------------+
```

> 注意 该改动为 **U4 改判**结果（Timing §6.1）。落地前确认 U4 原始意图仍成立（见 §6 冲突项）。

> **`noteConfirmStackBelowW = 200` 的归属（架构已定）**：这是**组件内部布局断点、属表现层**，由**便利贴组件消费**即可；**不进窗配置**（窗配置只管 `minWidth:160/minHeight:120`、`maxWidth:900/maxHeight:900`），**也不进 `domain.ts` 常量**（该文件只放窗口/领域/契约常量）。

### 3.5 键盘路径

`Tab` 在 标题（只读）/ 正文 / trash / x 间移动；正文 `Esc` 失焦（不关窗）；`Ctrl+Enter` 保存并失焦；`Delete`（聚焦 trash 后）触发确认条。

---

## 4. 引用的 Token 名

- 颜色：`--glass-panel-bg` `--glass-hover-bg` `--line-2` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent-line` `--accent-wash` `--danger` `--danger-wash` `--note-body-bg` `--note-foot-ink` `--note-confirm-bg` `--note-confirm-line` `--bg-field` `--focus-ring`
- 尺寸：`--note-w` `--note-h` `--note-head-h` `--note-foot-h` `--radius-lg` `--radius-md` `--radius-sm` `--icon-btn-size` 26 `--scrollbar-w` 6
- 阴影：`--shadow-plate` `--inset-top`
- 动效：`--dur-exit` `--dur-quick` `--dur-instant` `--ease-standard`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `trash-2` | 14px | 1.5 | 删除（`--danger` 仅 hover 出现） |
| `x` | 14px | 1.5 | 关闭 |
| `pin` / `pin-off` | 14px | 1.5 | 置顶 / 取消置顶（AC-64，hover 显示） |
| `link` / `link-off` | 14px | 1.5 | 关联 / 解绑事项（AC-63，页脚） |
| `check` | 14px | 2 | 内联确认条「确认删除」可留纯文字（无图标） |

> 原「●同步到记录行」徽标**删除**（Timing 主人 #2：只读徽标点了没反应，且每张都长一样）。同步行为不变，只删宣告。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 底透明度 | 玻璃 94% | 未悬停态 **74%**（浅色 86%）且**无描边** | 实现「未悬停全透只剩正文」 |
| 文字不透明度 | `--ink` | **始终 100%**（只透背景板） | 对比度可静态保证（Timing §1-11 修复） |
| 阴影 | `--shadow-plate` | 未悬停态**无阴影** | 全透观感 |
| 删除确认 | 通用 inline 确认 | **专用确认条**（含连带影响文案） | U4 改判，需确认 |

---

## 与架构的交叉点（已裁定 · ADR-009 / §6.a）

- **窗口**：每便利贴一 `WebviewWindow`，**动态 label `note-{id}`**。窗口创建/关闭/重启恢复/多显示器 → ADR-009。
- **几何持久化（便利贴专用 · 落 DB `notes` 表）**：保存 **`pos_x` / `pos_y` / `width` / `height`（均为逻辑像素 REAL）× 4 + `is_open`（INTEGER 0/1）**。
  - 注意 **不写 `monitor_id`** —— 显示器 id **不持久化**；恢复时由 `infra/windows.rs::clamp_to_workarea` 现算（`app.available_monitors()` 取目标屏，`Monitor.work_area` 物理 rect ↔ `pos_x/pos_y` 逻辑值 ×`scale_factor` 比对，越界钳进该屏 `work_area`，屏不存在回落主屏）。
  - 触发：`WindowEvent::Moved` / `Resized` 给的是**物理像素**，须 **÷ `scale_factor` 存逻辑值**（K-15）；**`--note-geom-persist-debounce-ms` 300ms 去抖**后经 `note_update` 落盘（K-23）。
  - 尺寸钳制（两层，架构 §6.a-5）：**硬钳制 width 160–900 / height 120–900**（= `--note-w/h-min/max`，代码 `NOTE_MIN_*/NOTE_MAX_*` 强制，**只有它能拦截拖拽**）；**运行时再受当前屏 `work_area` 收窄**（实际最大 = `min(900, work_area.width/height)`）。**舒适上限 640/480（`--note-w/h-comfort-max`）为软提示 / 拖拽吸附，Spec 与实现都不得据此拦截用户拖拽。**
- **窗口透明**：Tauri 透明窗口 + 「**板式拟玻璃**」（`--glass-panel-bg` 94%/97% + `backdrop-filter`，仅便利贴可用；**主小条禁模糊**）；首帧防白闪守 `visible:false` 握手（K-1）。
- **可输入**：窗口**不得设为不可激活**（AC-64）；`data-tauri-drag-region` **只放头部标题区**（放正文会抢输入）。
- **主题同步**：各窗**自订阅 `theme-changed`**（主窗不代转）。
