# 页面 Override：上下文菜单 Context Menu

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：右键长按 >= 500ms / `Menu` 键 / `Shift+F10` | 主题：恒定深色 | 层：`--z-menu` (60)
> 对应命令：`pause_timer` `stop_timer` `update_record` `delete_record` `set_always_on_top`
> 相关验收：AC-05（右键单击结束 vs 长按菜单分层）/ AC-11 / AC-25

---

## 1. 布局与尺寸标注

```
+----------------------------------------+
|  > play/pause   开始 / 暂停     SPACE  |   <- 高 --menu-item-h 32
|  > check        结束并保存      ENTER  |      左内边距 --space-4 10
|  > pencil       微调开始时间           |      图标 16 + --space-3 8 + 13px 文字
|  > trash-2      丢弃本次记录           |   <- 危险项：--menu-danger
|  ------------------------------------  |   <- 1px --border-soft，上下 --space-2 4
|  > pin          保持置顶         (on)  |
|  > settings-2   设置                   |
+----------------------------------------+
   宽 --menu-w 184 / 圆角 --radius-md 12 / 内边距 上下 --space-2 4 左右 0
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 宽度 | `--menu-w` 184px | |
| 圆角 | `--radius-md` 12px | |
| 内边距 | 上下 `--space-2` 4px，左右 0 | |
| 菜单项高 | `--menu-item-h` 32px | 左内边距 `--space-4` 10px |
| 图标布局 | 16px 图标 + `--space-3` 8px + 13px 文字 | `--text-base` 13px / `--weight-emphasize` |
| 加速键提示 | 右对齐，`--text-xs` 11px mono，`--meta`，大写 + 字距 `--tracking-caps` | `SPACE` / `ENTER` |
| hover 项 | 底 `--menu-item-hover`，文字 `--fg` | **禁止 3px 彩色左边框** |
| 按下项 | 底 `--menu-item-pressed` | |
| 分隔线 | 1px `--border-soft`，上下 `--space-2` 4px | |
| 投影 | `--elev-float` | |

---

## 2. 组件树

```
<ContextMenu role="menu">
+-- <MenuItemGroup/>                       // 语义组 1：计时动作
|   +-- <MenuItem icon="play|pause"  label="开始 / 暂停"  accel="SPACE"  onSelect=pauseTimer/>
|   +-- <MenuItem icon="check"       label="结束并保存"   accel="ENTER"  onSelect=stopTimer/>
|   +-- <MenuItem icon="pencil"      label="微调开始时间"                onSelect=updateRecord/>
|   +-- <MenuItem icon="trash-2"     label="丢弃本次记录"  variant="danger" onSelect=deleteRecord/>
+-- <MenuDivider/>                         // 1px --border-soft
+-- <MenuItemGroup/>                       // 语义组 2：应用设置
    +-- <MenuItem icon="pin|pin-off" label="保持置顶"  checked  onSelect=setAlwaysOnTop/>
    +-- <MenuItem icon="settings-2"  label="设置"                 onSelect=openSettings/>
```

---

## 3. 状态与交互

### 3.1 状态矩阵

| 状态 | 表现 |
|---|---|
| Default | 底 `--menu-bg`，13px/510 `--fg`，图标 `--fg-2` |
| Populated | 计时中：显示「开始/暂停」「结束并保存」「丢弃本次记录」；空闲：该组灰显（`--meta`）或隐藏 |
| Hover | 底 `--menu-item-hover`，文字 `--fg`，图标 `--fg`，`--dur-quick` 150ms |
| Focus-visible | `--focus-ring` 双环（内缩 2px 不裁剪），键盘导航项带 focus 环 |
| Active | 底 `--menu-item-pressed`，`--dur-instant` |
| Disabled | 文字/图标 `--meta`，`cursor: not-allowed`，不响应 hover（如无 active 记录时「结束并保存」禁用） |
| Danger | 「丢弃本次记录」文字/图标 `--menu-danger`，hover 底仍 `--menu-item-hover`（**不改红底**，避免过度刺激） |
| Edge | 菜单超出窗口边界时向内翻转定位（不裁切） |

### 3.2 交互

| 输入 | 行为 |
|---|---|
| 右键单击（< 400ms） | **不动画打断**，直接结束并保存（见 `pill-bar.md`）——不进本菜单 |
| 右键长按 >= 500ms | 环外圈轻微放大 1.06 后回 1.0（`--dur-quick`，**非弹性**）-> 弹菜单 |
| 400-500ms 不确定区抬起 | 视为单击（结束），菜单不弹 |
| `Menu` / `Shift+F10` | 键盘路径弹出菜单 |
| 收起态右键单击 | 弹出菜单（无记录可结束，语境自适应） |
| 方向键 | 在菜单项间移动（不依赖 hover） |
| `Esc` / 点击外部 | 关闭菜单，`--dur-exit` 180ms 淡出 |
| 选择项 | 执行命令 + 关闭菜单 |

### 3.3 「保持置顶」项

`pin` / `pin-off` 图标按当前 `alwaysOnTop` 切换；当前为 on 时显示 `pin` + 右侧对勾（`check` 16px `--success`，或文字「已开启」），点击调 `set_always_on_top`。

---

## 4. 引用的 Token 名

- 颜色：`--menu-bg` `--menu-item-hover` `--menu-item-pressed` `--menu-text` `--menu-danger` `--fg` `--fg-2` `--muted` `--meta` `--border-soft` `--success` `--focus-ring` `--danger`
- 尺寸：`--menu-w` `--menu-item-h` `--space-2` `--space-3` `--space-4` `--radius-md` `--icon-sm`
- 阴影：`--elev-float`
- 动效：`--dur-instant` `--dur-quick` `--dur-exit` `--ease-standard` `--ease-exit`
- 排版：`--font-mono` `--text-base` `--text-xs` `--tracking-caps` `--weight-emphasize`
- 层级：`--z-menu`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `play` | `--icon-sm` 16px | 2.5 | 空闲态「开始」 |
| `pause` | `--icon-sm` 16px | 2.5 | 计时中「暂停」 |
| `check` | `--icon-sm` 16px | 2.5 | 「结束并保存」/ 置顶已开启标记 |
| `pencil` | `--icon-sm` 16px | 2.5 | 「微调开始时间」 |
| `trash-2` | `--icon-sm` 16px | 2.5 | 「丢弃本次记录」（危险项） |
| `pin` | `--icon-sm` 16px | 2.5 | 「保持置顶」（当前开启） |
| `pin-off` | `--icon-sm` 16px | 2.5 | 「保持置顶」（当前关闭） |
| `settings-2` | `--icon-sm` 16px | 2.5 | 「设置」 |

> 全部为 16px 档，统一 `stroke-width: 2.5`，与药丸/面板的线重语言一致。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 菜单圆角 | `--radius-lg` 16 | `--radius-md` **12px** | 小浮层用更紧的圆角，避免"过度圆滑" |
| 危险项视觉 | `--danger` 全套 | 仅文字/图标用 `--danger`，**hover 底不改红** | 红色只属于"销毁"语义，不用红底制造焦虑 |
| hover 强调 | 允许左边框 | **明令禁止 3px 彩色左边框** | 反 AI 模板特征；用背景色区分 |
| 分组方式 | 卡片盒 | 1px `--border-soft` 分隔线分 2 组 | 高密度用线不用盒 |
