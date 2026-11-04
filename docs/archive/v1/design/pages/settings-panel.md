# 页面 Override：设置面板 Settings Panel

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：托盘菜单「设置」/ 上下文菜单 `settings-2` / 事件 `app:open-settings` | 主题：恒定深色 | 层：`--z-settings` (30)
> 对应命令：`get_settings` `update_settings` `set_autostart` `get_autostart` `register_shortcut`[P1]
> 相关验收：AC-21（开机自启开关）/ AC-25 / AC-27[P1]

---

## 1. 布局与尺寸标注

```
+-----------------------------------------------+
|  设置                                           |   <- 标题 16px/590 --fg
+-----------------------------------------------+
|  开机自启                              [ o  ]  |   <- AutostartToggle，行高 40
|  保持窗口置顶                          [ o  ]  |   <- AlwaysOnTopToggle
|  感知壁纸自动提高不透明度               [ o  ]  |   <- OpacityToggle
+-----------------------------------------------+   <- 1px --border-soft
|  全局快捷键  (P1)                               |
|  显示 / 隐藏            Ctrl+Alt+T      [编辑]  |   <- ShortcutList，行高 36
|  开始 / 暂停            Ctrl+Alt+S      [编辑]  |
|  结束                   Ctrl+Alt+E      [编辑]  |
|  新建事项               Ctrl+Alt+N      [编辑]  |
+-----------------------------------------------+
   面板宽 --panel-w 300 / 圆角 --radius-lg 16 / 内边距 --space-5 12

> 注：图中「全局快捷键」组在 **MVP 期为占位展示**（四键为 P1 默认值，MVP 不注册热键、编辑按钮禁用），详见 §3.4。
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 面板宽 | `--panel-w` 300px | |
| 圆角 | `--radius-lg` 16px | |
| 内边距 | `--space-5` 12px | |
| 底 | `--surface-2` | |
| 投影 | `--elev-panel` | |
| 标题 | `--text-lg` 16px / `--weight-announce` 590 / `--fg` | 标题靠字重拉层级，不用字号堆叠 |
| 开关行高 | 40px | |
| 快捷键行高 | 36px | |
| 行分隔 | 1px `--border-soft`（组间），不用卡片盒 | |
| 分组标题 | `--text-xs` 11px / `--muted` + 字距 `--tracking-caps`（仅 P1 组） | |

---

## 2. 组件树

```
<SettingsPanel>
+-- <PanelTitle/>                     // "设置"
+-- <SettingGroup>                    // 无组标题（3 项自明）
|   +-- <ToggleRow label="开机自启">           <Switch name="autostartEnabled"/>
|   +-- <ToggleRow label="保持窗口置顶">        <Switch name="alwaysOnTop"/>
|   +-- <ToggleRow label="感知壁纸自动提高不透明度"> <Switch name="opacityEnabled"/>
+-- <Divider/>
+-- <SettingGroup title="全局快捷键  (P1)">
|   +-- <ShortcutRow action="toggleWindow" label="显示 / 隐藏"  accel="Ctrl+Alt+T"  <EditBtn/>/>
|   +-- <ShortcutRow action="startPause"   label="开始 / 暂停"  accel="Ctrl+Alt+S"  <EditBtn/>/>
|   +-- <ShortcutRow action="stop"         label="结束"        accel="Ctrl+Alt+E"  <EditBtn/>/>
|   +-- <ShortcutRow action="newItem"      label="新建事项"     accel="Ctrl+Alt+N"  <EditBtn/>/>
```

---

## 3. 状态与交互

### 3.1 状态矩阵（5 态）

| 状态 | 表现 |
|---|---|
| Populated | 3 个开关按 `get_settings` 回填；快捷键列表按 `Settings.shortcuts` 回填（P1） |
| Loading | 首帧：开关显示为 `--surface-3` 静态占位（**不闪烁**），`get_settings` 返回后填充 |
| Empty | 快捷键行未注册：右侧显示「未设置」`--muted` + 「编辑」（P1） |
| Error | `set_autostart` 失败 / `IO_ERROR`：行下方 11px `--danger` 提示「写入失败，请检查权限」+ 开关回滚到原值 |
| Edge | `SHORTCUT_REGISTER_FAILED`（热键被占用）：该行描边 `--danger` + 提示「该组合键已被占用」+ 允许改键（**禁止 unwrap，见 Spec K-3**） |

### 3.2 Switch（开关）规格

| 状态 | 规格 |
|---|---|
| Off | 轨道 40x22，圆角 pill，底 `--surface-4`，滑块 `--fg-2` |
| On | 轨道底 `--accent`，滑块 `--accent-on`，**本页唯一强调色来源** |
| Hover | 轨道描边 1px `--border-strong` |
| Focus-visible | `--focus-ring` 双环 |
| Active | 滑块 `scale(0.94)`，`--dur-instant` |
| Disabled | 轨道底 `--surface-3`，滑块 `--meta` |
| 过渡 | 底/滑块位移 `--dur-base` 200ms `--ease-standard`（**位移用 transform，非 left**） |

### 3.3 交互

| 用户操作 | 反馈 |
|---|---|
| 切换「开机自启」 | `set_autostart({ enabled })` -> 返回实际状态并回填；失败回滚 + 错误提示（AC-21：写 HKCU Run，关闭时一键移除不留隐藏启动项） |
| 切换「保持窗口置顶」 | `set_always_on_top({ enabled })` + `update_settings` |
| 切换「感知壁纸」 | `update_settings({ patch: { opacityEnabled } })` |
| 点「编辑」（**P1**） | MVP：按钮禁用（`--meta` + tooltip），不进入录制。P1：进入录制态——行内显示「按下组合键...」+ `keyboard` 图标；捕获后调 `register_shortcut`；失败告 `SHORTCUT_REGISTER_FAILED` 并提示「该组合键已被占用」，保留可改 |
| `Esc` | 录制态：取消录制；非录制态：关闭设置面板 |
| `Tab` | 在开关 -> 快捷键行 -> 「编辑」按钮间循环 |

### 3.4 P1 标注与 MVP 占位行为（与 `IPC-CONTRACT-v2 §9` 对齐）

**快捷键四键默认值（锁定，全文档唯一来源）：** `toggleWindow = Ctrl+Alt+T` / `startPause = Ctrl+Alt+S` / `stop = Ctrl+Alt+E` / `newItem = Ctrl+Alt+N`。**`Ctrl+Alt+Space` 已作废**，不再出现于任何设计/契约文档。

**MVP 期行为（本页必须遵守）：**
- `Settings.shortcuts` 四个字段在 MVP 的**实际默认值是 `null`（未注册）**；上表四键是"**P1 落地时**的默认值"。
- 因此 ShortcutList 在 MVP 以**占位 / 默认展示**渲染这四行（键名 + 加速键文本 + 「编辑」按钮），整组标题右侧缀 **「P1」** 小标。
- **MVP 不调用 `register_shortcut`**；「编辑」按钮在 MVP 为**禁用态**（其文字/图标 `--meta`，`cursor: not-allowed`，hover tooltip「v2 支持自定义快捷键」）——**避免出现"看起来能改、实际无效"的假交互**。
- 组标题：`--text-xs` 11px / `--muted` + 字距 `--tracking-caps`；「P1」小标 10px `--meta`、1px `--border` 描边、圆角 `--radius-chip`。
- **呈现方式已定稿（架构裁决，不再二选一）：MVP 全程 = 占位展示 + 「P1」小标 + 「编辑」禁用，不做整体隐藏。** 理由：Spec §2.2 的 P1「仅记录」职责由占位展示承担，与 Spec §5.5 保留快捷键结构的定位一致；整体隐藏会让设置面板缺失该章节，与 Spec §7/§8 的 Settings 形态定义不符。
- **capabilities 口径（架构锁定，前端对齐）：** MVP 的 `capabilities/default.json` **不放行 `global-shortcut` 相关权限**；`register_shortcut` 在 Rust 侧保留注册但 MVP 不被调用。因为占位+禁用态**零 invoke**，本主方案在 MVP 全程不受 capability 缺失影响。P1 落地时再同时开 capability + 启用编辑按钮。
- **禁止**：一边显示可点「编辑」一边不注册（假交互）。

---

## 4. 引用的 Token 名

- 颜色：`--surface-2` `--surface-3` `--surface-4` `--border-soft` `--border-strong` `--fg` `--fg-2` `--muted` `--meta` `--accent` `--accent-on` `--danger` `--success` `--focus-ring`
- 尺寸：`--panel-w` `--space-3` `--space-5` `--radius-lg` `--radius-chip` `--radius-sm` `--icon-sm` `--menu-w`
- 阴影：`--elev-panel`
- 动效：`--dur-instant` `--dur-quick` `--dur-base` `--ease-standard`
- 排版：`--font-ui` `--font-mono` `--text-lg` `--text-base` `--text-sm` `--text-xs` `--tracking-caps` `--weight-announce` `--weight-emphasize` `--weight-read`
- 层级：`--z-settings`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `keyboard` | `--icon-sm` 16px | 2.5 | 快捷键组标题 / 录制态提示 |
| `pencil` | `--icon-sm` 16px | 2.5 | 快捷键行「编辑」按钮 |
| `circle-alert` | `--icon-sm` 16px | 2.5 | 注册失败 / 写入失败错误提示 |

> 开关本身为自绘 SVG（几何），非 Lucide 图标；仅用 `--accent` 表达 on 态。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 标题层级 | `--text-lg` + `--weight-announce` | 沿用；**不加大标题区/不居中** | 保持仪表一致性，设置是功能面板非营销页 |
| 分组方式 | 卡片盒 | 1px `--border-soft` 分隔 + 无组标题（前 3 项自明） | 高密度用线不用盒 |
| 强调色用量 | 每屏 <= 2 | On 态开关是**唯一强调来源**，其余全中性 | 开关 on 是本面板唯一"活跃"信号 |
| 开关位移 | - | 用 `transform: translateX()`，**禁用 `left`** | 遵守动效属性白名单（§6.4） |
