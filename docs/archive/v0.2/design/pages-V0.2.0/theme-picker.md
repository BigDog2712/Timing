# 页面：主题 / 配色 Picker ThemePicker（V0.2.0 · 新增）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> **图例**：本文 ASCII 示意图中的 ○ / ● / ◐ 仅为实现层 SVG/CSS 图形的示意记号，非图标资产；实现一律使用 lucide-react SVG。
> 位置：设置面板「外观配色」页签内的两张卡片（主题卡 + 配色卡）
> 主题：本页自身随主题切换（切到浅色时页面即变浅） | 层：`--z-settings` (30)
> 来源：对齐 Timing §4.3 主题卡 + §3.6 取色行
> 对应命令：`theme_get` `theme_set` `accent_get` `accent_set` | 事件：`theme-changed`

---

## 1. 布局与尺寸标注

```
[ 卡片 1 · 主题 ]  --bg-card + 1px --line + --radius-lg + padding 14/14
   主题
   +----------------------+  +----------------------+
   | ┌──────────────────┐ |  | ┌──────────────────┐ |
   | │  ● ────           │ |  | │  ○ ────           │ |   ← 迷你预览：180° 渐变缩略 + 圆环 + 时间条
   | └──────────────────┘ |  | └──────────────────┘ |
   |      深色      on      |  |      浅色             |   ← 选中：--accent-line 描边 + --accent-wash 底 + 右上勾
   +----------------------+  +----------------------+

[ 卡片 2 · 配色 ]  标题行：配色  ……  [ ↺ 恢复默认配色 ghost sm ]
   取色行 ×4（--radius-sm）：
   [ ● ] 计时中          [ #4DA3E8 ]  ›      ← 色点 18 + 名 13/--ink + 弹性空白 + hex 胶囊 + 箭头
   [ ● ] 提醒            [ #E8A33D ]  ›
   [ ● ] 完成            [ #4CC38A ]  ›
   [ ● ] 小条底色        [ #0E0F12 ]  ›
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 主题卡 | 两张并排，各 `--radius-md` 10；缩略 180° 渐变 | 选中 = `--accent-line` 描边 + `--accent-wash` 底 + 右上 `check` |
| 缩略 | 迷你预览：小圆环 + 时间条，用该主题的真实色 | 不是抽象图形，是「这块就是这个主题长啥样」 |
| 取色行 | 见 `DESIGN-V0.2.0.md` §4.6；色点 18 + hex 胶囊 54×26 | 色点自带 `inset 0 0 0 1px rgba(255,255,255,.20)` |
| 「恢复默认配色」 | 卡片标题行右侧 `ghost sm` 小按钮 | 取代原通栏 30px 按钮 |
| 强调色用量 | **≤ 2 处**（选中主题卡 + 一个 accent 元素） | |

---

## 2. 组件树

```
<ThemePicker>
+-- <ThemeCardSection>
|   +-- <ThemeCard theme="dark"  selected={...}/>
|   +-- <ThemeCard theme="light" selected={...}/>
+-- <ColorSection>
|   +-- <SectionHeader> 配色 … <GhostBtn>↺ 恢复默认配色</GhostBtn>
|   +-- <SwatchRow role="running" value="#4DA3E8"/>
|   +-- <SwatchRow role="remind"  value="#E8A33D"/>
|   +-- <SwatchRow role="done"    value="#4CC38A"/>
|   +-- <SwatchRow role="bar"     value="#0E0F12"/>
+-- <ColorPickerPopover/>   点色点/胶囊 → 原生 color input + hex 输入（校验）
```

---

## 3. 状态与交互

### 3.1 四色 → Token 映射（本页是「四色可配」的 UI 入口）

| 取色行 | 设置字段 | Config Token | 写入后影响 |
|---|---|---|---|
| 计时中 | `accent_running` | `--color-running` | 小条色环、进行中行竖条、倒计时弧 |
| 提醒 | `accent_warn` | `--color-warn` | 提醒铃、逾期待办、提醒弹窗头 |
| 完成 | `accent_done` | `--color-done` | 已完成圆标记、（可选）结束态闪色 |
| 小条底色 | `accent_bar` | `--color-bar` | 小条本体底色 |

> **浅色自动派生**：写值前跑 `DeepenForNonText(value, --bg-panel, 3.0)`；**不改用户存的原始色**，只在渲染层派生（见 MASTER §10.2）。

### 3.2 交互态

| 状态 | 主题卡 | 取色行 | 恢复默认 |
|---|---|---|---|
| Default | `--bg-field` 缩略 + `--line` 描边 | 色点 + 名 `--ink` + hex 胶囊 | `ghost`（`--ink-3`） |
| Hover（`--dur-quick`） | 描边 `--line-3` | 行底 `--bg-field-hi`；箭头 `--ink-4`→`--ink-3` | 字 → `--ink`，底 `--bg-field-hi` |
| Active | `scale(0.99)` | 行底 `--bg-field-hi` | `scale(0.98)` |
| Selected | `--accent-line` 描边 + `--accent-wash` 底 + 右上 `check` 16px | — | — |
| Focus-visible | `--focus-ring` 双环 | 同左 | 同左 |
| Loading | 首帧读 `theme_get` / `accent_get` 前：缩略骨架 | hex 胶囊显示 `#──────` | disabled |
| Error | hex 非法 → 胶囊描边 `--danger` + 行下 11px `--danger` 提示 | 同左 | — |
| Empty | 不适用 | 不适用 | 不适用 |
| Edge | 相同值四条 → 允许（用户自由）；极端色（纯黑/纯白小条底色）→ 色点自带内描边保证可见 | hex 输入接受 #RGB/#RRGGBB | 无自定义时按钮 disabled |

### 3.3 切换主题的实时反馈

点「浅色」→ `document.documentElement.dataset.theme = 'light'`（无重排）→ 写 `settings.theme_mode` → `emit('theme-changed')` 广播给所有窗口 → 本页自身**立即变浅**（所见即所得，「所有更改即时生效」）。

### 3.4 键盘路径

`Tab` 在主题卡 / 4 条取色行 / 恢复默认间移动；`←→` 主题卡间切换；`Space`/`Enter` 选中主题；`Enter` 在取色行上打开取色浮层；`Esc` 关取色浮层不保存。

---

## 4. 引用的 Token 名

- 颜色：`--bg-card` `--line` `--line-2` `--line-3` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--accent-line` `--accent-wash` `--accent-ink` `--bg-field` `--bg-field-hi` `--danger` `--focus-ring`（+ 四色变量 `--color-running/warn/done/bar`）
- 尺寸：`--radius-lg` `--radius-md` `--radius-sm` `--field-num-w` 54 `--space-2` `--space-3` `--icon-sm` `--btn-sm-h`
- 动效：`--dur-quick` `--dur-instant` `--ease-standard`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `sun` | 16px | 2.5 | 浅色主题卡角标（可选） |
| `moon` | 16px | 2.5 | 深色主题卡角标（可选） |
| `check` | 16px | 2.5 | 选中主题卡右上勾 |
| `chevron-right` | 11px | 2 | 取色行右侧箭头（`--ink-4`） |
| `rotate-ccw` | 16px | 2.5 | 「恢复默认配色」 |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 取色交互 | 色块当字压 hex | **色点 + 独立 hex 胶囊** | Timing §1-3 硬伤修复（`ReadableOn` 启发式会失手） |
| 主题选择 | 两个文字按钮 | **带迷你预览的选择卡** | 一眼看出选的是哪个主题 |
| 恢复默认 | 通栏 30px 按钮 | 卡片标题行右侧 `ghost sm` | 降权，不喧宾夺主 |
