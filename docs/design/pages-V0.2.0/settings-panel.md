# 页面：设置面板 SettingsPanel（V0.2.0 · 改造）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> **图例**：本文 ASCII 示意图中的 ○ / ● / ◐ 仅为实现层 SVG/CSS 图形的示意记号，非图标资产；实现一律使用 lucide-react SVG。
> 本文件只写**本页规格**与**差异字段**。
> 触发：托盘菜单「设置…」/ 小条右键「设置…」| 主题：深/浅双主题 | 层：`--z-settings` (30)
> 来源：对齐 Timing §4.3
> 窗口：**独立窗口** 392×660（标题栏 50 / 页签 48 / 内容区 504 / 底栏 58）
> 对应命令：`settings_get` `settings_set` `theme_get/set` `accent_get/set` `plugin_*`
> V0.2.0 改造：**三页签 = 外观配色 / 扩展 / 通用**

---

## 1. 布局与尺寸标注

```
+--------------------------------------------------------+  392 × 660
| 设置                                          [ x ]     |  ← 标题栏 50：15/650 + 右图标按钮 + 底 1px --line
+--------------------------------------------------------+
| [ 外观配色 | 扩展 | 通用 ]                              |  ← 分段控件（页签区 48，居中或左对齐）
+--------------------------------------------------------+
|                                                        |
|  [卡片 背景蒙版浓度 ………… 滑条 ——○——  [ 50% ] ]          |  ← 内容区 504（滚动）
|  [卡片 整体缩放   ………… 滑条 ————○—  [ 100% ] ]          |
|  [卡片 主题：两张带迷你预览的选择卡（见 theme-picker.md）]  |
|  [卡片 配色：4 条取色行 + 恢复默认（见 theme-picker.md）]   |
|                                                        |
+--------------------------------------------------------+
| 所有更改即时生效                              [ 完成 ]   |  ← 底栏 58：左文字 11.5/--ink-3 + 右 neutral 按钮
+--------------------------------------------------------+
```

| 区域 | 高度 | 说明 |
|---|---|---|
| 标题栏 | `--settings-title-h` 50 | 15 / 650 + 右侧 `x` 图标按钮 + 底部 1px `--line` |
| 页签区 | `--settings-tab-h` 48 | 分段控件（三段），选中段 `--bg-seg-on` |
| 内容区 | 504 | 卡片分组 + 行分隔；超出滚动（8px 滚动条） |
| 底栏 | `--settings-foot-h` 58 | 左「所有更改即时生效」+ 右 `neutral`「完成」 |

| 规格项 | 值 | 说明 |
|---|---|---|
| 外壳底 | `--bg-panel` `#0E1015` | 原 `#1E2128`（偏亮偏灰，不像一个软件） |
| 圆角 | `--radius-xl` 14 | |
| 卡片 | `--bg-card` + 1px `--line` + `--radius-lg` 12 + `padding 14` | |
| 行 | `padding 9px 0` + 底 1px `--line`（末行无） | |

---

## 2. 组件树

```
<SettingsPanel>
+-- <SettingsTitleBar/>     15/650「设置」 + [IconButton x]
+-- <SegmentedTabs/>        外观配色 | 扩展 | 通用
+-- <TabPanel tab="look">   <SliderRow 背景蒙版浓度/> <SliderRow 整体缩放/> <ThemePicker/>（主题卡 + 配色卡）
+-- <TabPanel tab="ext">    <ExtensionCard/> × N（纵向三段式）
+-- <TabPanel tab="gen">    <SettingRow 计时最短秒数/> <SettingRow 自动开始/> <SettingRow 高亮色/>
+-- <SettingsFooter/>       左提示文字 + [neutral 「完成」]
```

### 2.1 替换的原生控件（全部自绘）

| 原生 | 替换为 | Token |
|---|---|---|
| `TrackBar`（带刻度白轨道） | `SliderRow`（轨道 4 / 钮 14 / 数值胶囊 54×26） | §4.2 MASTER |
| `CheckBox`（系统方块） | `ToggleSwitch`（38×22，开=`--accent`） | §4.3 |
| 三个独立页签按钮 | `SegmentedTabs` | §4.4 |
| 色块按钮（hex 当字压色块） | `SwatchRow`（色点 + hex 胶囊） | `theme-picker.md` |

### 2.2 扩展页三段式（纵向）

```
[图标 + 名 + 版本]               [开关 38×22]
[描述文字（11.5/--ink-3，可换行）]
[动作按钮 ×N（ghost sm）]
```

> 注意 V0.2.0 插件系统**缓做（v0.3）**（见 CHANGE-PLAN §B.3）。扩展页先保留**结构占位**（含空态「暂无扩展」），不实装 obsidian-sync / timer-window。

---

## 3. 状态与交互

### 3.1 三个页签内容

| 页签 | 行 | 控件 |
|---|---|---|
| **外观配色** | 背景蒙版浓度（0–100%） | `SliderRow` + 数值胶囊 |
| | 整体缩放（80–140%） | `SliderRow` + 数值胶囊 |
| | 主题 | 主题卡 ×2（`theme-picker.md`） |
| | 配色（计时中/提醒/完成/小条底色） | 取色行 ×4 + 恢复默认 |
| **扩展** | 扩展卡片 ×N | 三段式（名/描述/开关 + 动作） |
| **通用** | 计时最短秒数 | 左标签 + 右滑条 + 右数值胶囊（三列骨架） |
| | 自动开始 | 左标签 + 右 `ToggleSwitch` |
| | 高亮色 | 左标签 + 右取色行 |

> **通用页三行统一「左标签 + 右控件」骨架** —— 全页竖向对齐轴只有一条（Timing 主人 #4/#5 意见）。

### 3.2 交互态

| 状态 | 页签 | 行 | 滑条 / 开关 | 底栏「完成」 |
|---|---|---|---|---|
| Default | 未选段 `--seg-off-ink` | 标签 `--ink` | 见 MASTER §4.2/§4.3 | `neutral`（`--bg-field-hi` / `--ink`，13.29:1） |
| Hover | 未选段字 → `--ink` | 行底 `--bg-field`（可点行） | 钮微亮 | 底 → `--line-3` 内描边 |
| Active | `scale(0.99)` | — | `scale(0.98)` | `scale(0.98)` |
| Selected | 选中段 `--bg-seg-on` + `--ink` + 顶部内高光 | — | — | — |
| Focus-visible | `--focus-ring` | 同左 | 同左（滑条钮 / 开关双环） | 同左 |
| Loading | 首帧读设置前：骨架行 | — | 禁用 | disabled |
| Error | — | 行下 11px `--danger`（如数值超范围） | 同左 | 保留 |
| Empty | 扩展页无扩展 → 「暂无扩展」图标块 | — | — | — |
| Edge | 缩放 80/140 极限值 → 数值胶囊提示边界；超长扩展名 → 省略号 | — | 数值胶囊定宽不跳 | — |

### 3.3 「完成」按钮的语义（Timing §4.3.1）

- 用 `neutral`（灰底），**不用 `solid` 白底** —— 白底按钮在整片深灰里是个光源；设置面板是长表单，底栏只是收尾。
- 文案「完成」（不是「关闭」）—— 它是收尾，不是关窗。
- 尺寸 58×28；对比度 `--ink on --bg-field-hi` = **13.29:1**（深）/ 14.60:1（浅），远超 AA。

### 3.4 键盘路径

`Tab` 进入页签 → 内容控件 → 底栏；页签 `←→` 切换；滑条 `←→` 调值（`Shift` 大步）；开关 `Space`；`Esc` 关窗。

---

## 4. 引用的 Token 名

- 颜色：`--bg-panel` `--bg-card` `--line` `--line-2` `--line-3` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--accent-wash` `--accent-ink` `--bg-field` `--bg-field-hi` `--bg-seg` `--bg-seg-on` `--seg-on-ink` `--seg-off-ink` `--track` `--danger` `--focus-ring` `--btn-neutral-bg` `--btn-neutral-ink`
- 尺寸：`--settings-w` `--settings-h` `--settings-title-h` `--settings-tab-h` `--settings-foot-h` `--radius-xl` `--radius-lg` `--radius-md` `--radius-sm` `--row-pad-y` `--card-pad-x` `--slider-track-h` `--slider-thumb` `--switch-w` `--switch-h` `--field-num-w` `--icon-btn-size` `--icon-sm`
- 动效：`--dur-quick` `--dur-instant` `--dur-base` `--ease-standard`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `x` | 16px | 2.5 | 标题栏关闭 |
| `rotate-ccw` | 16px | 2.5 | 恢复默认配色 |
| `chevron-right` | 11px | 2 | 取色行箭头 |
| `check` | 16px | 2.5 | 主题卡选中 |
| `folder-open` `file-json` `chevron-down` | 16px | 2.5 | 扩展卡片动作（v0.3 占位） |
| `puzzle` | 24px | 2 | 扩展页空态图标块 |
| `sun` / `moon` | 16px | 2.5 | 主题卡 |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 底栏主按钮 | `accent` / `solid` | **`neutral`** | 长表单收尾，不喧宾夺主（13.29:1） |
| 分组方式 | 1px 线 | **卡片分组**（这是唯一用卡片的窗口） | 设置项需强分组 |
| 弹窗 vs 窗口 | `--z-panel` 内绘制 | **独立 392×660 窗口** | 多窗口模型（见 §7） |

---

## 与架构的交叉点（已裁定）

- **窗口尺寸**：V0.1.0 设置面板绘制在 384×360 单窗内；V0.2.0 改为**独立 392×660 窗口**（`open_settings_window`，固定 label `settings`）。
- **几何持久化**：**不入库** —— 由 **`tauri-plugin-window-state` 按 label 自动维护**位置/尺寸（V0.1.0 既有机制，本期沿用）。**本页无 `pos_x`/`monitor_id` 等 DB 几何字段**。
- **即时生效**：所有更改即写即生效（无「保存」），底栏文案「所有更改即时生效」须与实现一致。
- **主题同步**：本窗**自订阅 `theme-changed`**（主窗不代转）。
- **扩展页**：插件系统缓做 v0.3，本页先留结构占位 + 空态。
