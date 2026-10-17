# 页面 Override：展开面板 Panel

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：点「新建事项」/ 手柄 | 主题：恒定深色 | 层：`--z-panel` (20)
> 对应命令：`create_item` `list_items` `switch_item`
> 相关验收：AC-08 / AC-10 / AC-11 / AC-12 / AC-18 / AC-25

---

## 1. 布局与尺寸标注

```
+---------------------------------------------+
|  [ 环 ]  00:00   |  品牌视觉改版第一轮    |   <- 药丸本体（钉在顶部，不动）
+---------------------------------------------+   <- 1px 全宽 divider --border-soft
|  +---------------------------------------+
|  | 这一段时间在做什么？                    |   <- 输入框 h --input-h 36 / radius --radius-sm 8
|  +---------------------------------------+
|  [ 品牌视觉改版 ] [ 客户方案评审 ]            <- chips 2 行 x 2 个，高 --chip-h 28
|  [ 接口联调     ] [ + 新建       ]
+---------------------------------------------+
|  ENTER 开始计时        ESC 取消              |   <- 11px mono --meta
+---------------------------------------------+
   面板宽 --panel-w 300 / 内边距左右下 --space-5 12 / 上 --space-3 8
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 面板宽 | `--panel-w` 300px（固定） | 比药丸典型宽 288 略宽，形成"沉降"感 |
| 面板内边距 | 左右下 `--space-5` 12px，上 `--space-3` 8px | |
| 面板圆角 | `--radius-lg` 16px | 上圆角与药丸下圆角连续过渡，一体感 |
| 面板底 | `--surface-2` | |
| 输入框 | 高 `--input-h` 36px，圆角 `--radius-sm` 8，底 `--input-bg`，14px/510 `--input-text`，placeholder `--input-placeholder` | 焦点态底 `--input-bg-focus` |
| 输入框焦点 | 2px `--focus-ring`（琥珀），**本屏唯一一处强调色** | |
| Chips | 高 `--chip-h` 28，圆角 `--radius-chip`，左右内边距 `--chip-pad-x` 12，12px/500 `--chip-text`，底 `--chip-bg` | hover -> `--chip-bg-hover` + 1px `--border-strong` |
| Chips 上限 | **4 个**（`--size` 无独立 token，按 2 行 x 2 个排版） | 认知负荷 <= 4 |
| 底部提示行 | 高 28px，11px mono，`--meta`；键名用 `--muted` | `ENTER` / `ESC` 大写 + 字距 `--tracking-caps` |
| 面板投影 | `--elev-panel` | |

---

## 2. 组件树

```
<Panel>                                  // 药丸顶部锚点固定，底部向下生长
+-- <PillHeader/>                         // = 药丸本体（环 + 数字 + 事项名，只读态）
+-- <PanelDivider/>                       // 1px 全宽 --border-soft
+-- <ItemInput>                           // 自动聚焦，input type=text，maxlength 建议 60
|   +-- <InlineError/>                    // 错误态：ITEM_NAME_EMPTY / ITEM_NAME_DUPLICATE
|   +-- <DuplicateHint/>                  // 重名时内联："直接使用该事项"
+-- <RecentChips max={4}>
|   +-- <Chip/> x N                       // list_items 最近使用，<= 4
|   +-- <Chip add/>                       // "+ 新建"，icon plus 16px
+-- <ShortcutHint/>                       // ENTER 开始计时 / ESC 取消
```

---

## 3. 状态与交互

### 3.1 状态矩阵

| 状态 | 表现 |
|---|---|
| Default（Populated） | 输入框空 + 最近 chips（最多 4） |
| Typing | 输入框底 `--input-bg-focus` + 琥珀焦点环；底部提示 `ENTER 开始计时` 保持 |
| Focus | `--focus-ring` 琥珀双环（**本屏唯一强调色**） |
| Empty | 无历史事项时 chips 区仅显示 `+ 新建`；输入框 placeholder「这一段时间在做什么？」 |
| Error | `ITEM_NAME_EMPTY`：输入框 1px `--danger` 描边 + 下方 11px `--danger` 内联提示 |
| Duplicate | `ITEM_NAME_DUPLICATE`：内联提示 + 提供「直接使用该事项」按钮（ghost） |
| Loading | `create_item` 进行中：输入框右侧 16px 半圆弧（240ms，非旋转 spinner），禁重复提交 |
| Success | 面板收起为药丸 + 环变琥珀（RUNNING），无 toast（形态变化即反馈） |

### 3.2 交互

| 用户操作 | 视觉反馈 |
|---|---|
| 点「新建事项」/ 手柄 | 药丸钉顶不动，底部向下生长 `--dur-morph` 280ms，圆角 24 -> 16；内容延迟 80ms 后 200ms 淡入 |
| 输入名称 + `Enter` | `create_item` -> 面板收起 -> 成为当前事项 -> 环变琥珀 |
| 点 chip | `switch_item`（`mode: end_and_start` 若计时中），chip 短暂 `--surface-4` 反馈后收起 |
| 点 `+ 新建` | 焦点移回输入框（原地新建，不新开面板） |
| `Esc` | 取消面板，收回药丸（不创建、不切换） |
| 点外部 / 失焦 | 面板收起（保留已输入内容到下次打开的可选行为由前端定，默认丢弃） |
| 重名 | 内联「已存在同名事项」+ 「直接使用该事项」 |

### 3.3 键盘

`Enter` 提交；`Esc` 取消；`Tab` 在 输入框 -> chips -> `+ 新建` 间移动；方向键在 chips 间移动（不依赖鼠标悬停）。

### 3.4 事项删除与系统事项保护（`ITEM_SYSTEM_PROTECTED`）

事项的删除入口（chip 右键菜单项 `trash-2` 删除）在**系统事项「未归类」(id=1)** 上必须：

| 触发 | 表现 |
|---|---|
| 「未归类」的删除项 | 置灰：文字/图标 `--meta`，`cursor: not-allowed`，不响应 hover（**不隐藏**，让规则可见） |
| 悬停置灰项 | tooltip「系统事项不可删除」（12px / `--surface-3` / `--radius-sm`） |
| 强行调用 | 后端返回 `ITEM_SYSTEM_PROTECTED`，前端忽略并同步状态；**不弹错误 toast**（规则已前置表达） |

> **图标约束：** 本页只使用 §8.2 锁定清单内的 `trash-2` / `pencil` / `plus` / `circle-alert`。`archive_item` / `unarchive_item` 在本期**没有独立 UI 入口**（供后续版本），因此设计稿不新增任何归档图标；若未来暴露归档入口，**必须先改 Spec 扩充 §8.2 图标清单**，不得在页面里直接引入清单外的 Lucide 图标。

> 其它错误码在本页的呈现：`ITEM_NAME_EMPTY` -> 输入框 1px `--danger` + 内联提示；`ITEM_NAME_DUPLICATE` -> 内联提示 + 「直接使用该事项」；`DB_ERROR` -> 面板顶部内联提示「数据保存失败」+ 重试，内存输入不丢；`ITEM_NOT_FOUND` -> 刷新事项列表（v2 无独立 `RECORD_NOT_FOUND`，记录级缺失复用该码）。

---

## 4. 引用的 Token 名

- 颜色：`--surface-2` `--surface-3` `--surface-4` `--input-bg` `--input-bg-focus` `--input-text` `--input-placeholder` `--chip-bg` `--chip-bg-hover` `--chip-text` `--border-soft` `--border-strong` `--fg` `--fg-2` `--muted` `--meta` `--accent` `--danger` `--focus-ring` `--focus-ring-danger`
- 尺寸：`--panel-w` `--input-h` `--chip-h` `--chip-pad-x` `--space-1` `--space-3` `--space-5` `--space-6` `--radius-sm` `--radius-lg` `--radius-chip` `--icon-sm` `--ring-size`
- 阴影：`--elev-panel`
- 动效：`--dur-base` `--dur-quick` `--dur-morph` `--ease-standard` `--ease-morph`
- 排版：`--font-ui` `--font-mono` `--text-sm` `--text-md` `--text-lg` `--tracking-caps` `--weight-emphasize` `--weight-announce` `--weight-read`
- 层级：`--z-panel`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `plus` | `--icon-sm` 16px | 2.5 | chips 区「+ 新建」入口 |
| `circle-alert` | `--icon-sm` 16px | 2.5 | 重名 / 空名内联错误提示行 |
| `keyboard` | `--icon-sm` 16px | 2.5 | 底部快捷键提示行前缀（`ENTER` / `ESC`） |

> 禁止使用 `U+2714` / `U+274C` 等字符符号表示成功/失败，一律用上表图标或纯文本。

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 强调色用量 | 每屏 <= 2 处 | 输入框焦点环 + 主按钮 = **<= 2 处**，其余全中性 | 面板内允许第二处强调（Density=8 上限） |
| 卡片容器 | 常规卡片 | **不用嵌套卡片盒**，用 `--border-soft` 1px 线 + 负空间分组 | 高信息密度用线不用盒子（对标 Super Productivity 深色主题） |
| 面板圆角 | `--radius-lg` 16 | 上圆角与药丸**连续过渡** | Dynamic Island 式一体感 |
| 输入框底 | `--surface` | `--input-bg`（`--surface-3`） | 输入区需在面板底上"下沉"一档 |
