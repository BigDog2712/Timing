# 页面：常用事项 CommonItems（V0.2.0 · 新增）

> 覆盖对象：`DESIGN-V0.2.0.md` + `design-tokens-V0.2.0.{json,css}`
> 触发：左键点小条事项名 / 托盘菜单「编辑固定任务…」| 主题：深/浅双主题 | 层：`--z-menu` (60)
> 来源：对齐 Timing `GlassMenu`「常用事项」场景
> 形态：自绘玻璃菜单；**一键开始某常用事项 / 固定任务**，降低「每次都要输名字」的摩擦
> 对应命令：`item_list_recent` `item_pin` `item_unpin` `start_timer` | 数据：`items.is_pinned`

---

## 1. 布局与尺寸标注

```
+--------------------------------------+  min-width --menu-w 184（长名可撑宽）
| 常用事项                              |  ← 分组标题 10.5/600/.08em/--ink-4
|  ▸  上厕所                    倒计时 10 分 |  ← 最近 5 条：图标 play + 名 + 右侧信息位
| ▌▸  摸会儿鱼                  倒计时 20 分 |  ← 当前项：左 3×16 --accent 竖条 + 字提 --ink
|  ▸  睡一觉                    倒计时 35 分 |
|  ▸  吃饭                          正计时   |
|  ▸  写周报                        —        |  ← 无预设 → 信息位空
|  ────────────────────────────────────   |
|  [plus]  其他事项…                          |  ← 打开新建/输入
+--------------------------------------+
   固定任务（is_pinned）置顶于常用之前，用 pin 图标区分
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 容器 | `min-width --menu-w` 184（长名撑宽，上限参考 272） + `padding 6` + `--radius-lg` 12 | |
| 底 | 玻璃 `--menu-bg`（94% / 浅色 97%）+ 1px `--line-2` + `--shadow-float` | |
| 行高 | `--menu-item-h` 30；`padding 0 9`；gap 10；`radius 6` | |
| 当前项 | 左侧 3×16 `--accent` 竖条（`.mi.on`）+ 字提 `--ink` | |
| 图标 | 16px 描边型，`--ink-4`；hover → `--ink-3` | |
| 信息位 | 等宽 11 / `--ink-4`（「倒计时 10 分」/「正计时」/空） | |
| 分组标题 | 10.5 / 600 / `.08em` / `--ink-4` | |

---

## 2. 组件树

```
<CommonItems>
+-- <MenuGroup label="固定任务">      （有 is_pinned 项时）
|   +-- <MenuItem icon="pin" label="{名}" info="{预设}"/>
+-- <MenuGroup label="常用事项">
|   +-- <MenuItem icon="play" label="{最近事项}" info="倒计时 10 分 | 正计时 | —" on={isCurrent}/>
+-- <MenuSeparator/>
+-- <MenuItem icon="plus" label="其他事项…"/>     打开新建输入
```

---

## 3. 状态与交互

### 3.1 数据来源

- **固定任务**（`items.is_pinned = 1`）：置顶，带 `pin` 图标。**不设硬上限**，展示区滚动，**建议保持 ≤5–8 条**（`size.commonPinnedSoftCap` = 8，仅作软提示）。可在此菜单「取消固定 / 固定」。
- **常用事项**：最近使用 **5** 条（`size.commonRecentCount` = 5，按 `updated_at` 倒序）。工作记忆容量约束。
- **预设时长**：若该事项曾用倒计时，信息位显示上次预设（可一键沿用）。

### 3.2 交互态

| 状态 | 菜单项 | 当前项 | 「其他事项…」 |
|---|---|---|---|
| Default | 字 `--ink-2` / 图标 `--ink-4` | — | 同左 |
| Hover（`--dur-quick`） | 底 `--bg-field-hi` + 字 `--ink` + 图标 `--ink-3` | — | 同左 |
| Active | 底 `--bg-field-hi`，`scale(0.99)` | — | 同左 |
| Current（正被计时） | — | 左 3×16 `--accent` 竖条 + 字 `--ink` | — |
| Focus-visible | `--focus-ring` 双环 | 同左 | 同左 |
| Loading | 点击后 1 帧行尾 spinner | — | — |
| Error | 启动失败 → 行下 inline `--danger`「启动失败，重试」 | — | — |
| Empty | 无常用/固定 → 仅显示「其他事项…」 + 11px 提示「还没有记录，先新建一个」 | — | — |
| Edge | 超长事项名 → 撑宽至上限后省略号；同名多条 → 允许（按 id 区分）；当前事项已在计时 → 点它触发「结束当前并切换」确认 | — | — |

### 3.3 键盘路径

`↑↓ / Home / End` 移动；`Enter` 开始选中事项；`Esc` 关闭；`P` 固定/取消固定选中项。

---

## 4. 引用的 Token 名

- 颜色：`--menu-bg` `--line` `--line-2` `--bg-field-hi` `--ink` `--ink-2` `--ink-3` `--ink-4` `--accent` `--danger` `--focus-ring`
- 尺寸：`--menu-w` `--menu-item-h` `--menu-item-pad-x` `--menu-icon-gap` `--menu-pad` `--radius-lg` `--icon-sm`
- 阴影：`--shadow-float`
- 动效：`--dur-base` `--dur-quick` `--ease-standard`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke | 用途 |
|---|---|---|---|
| `play` | 16px | 2.5 | 开始某常用事项 |
| `pin` | 16px | 2.5 | 固定任务 |
| `plus` | 16px | 2.5 | 「其他事项…」 |
| `timer` | 16px | 2.5 | 预设为倒计时（可选，信息位前缀） |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 列表上限 | 无统一上限 | **常用 5 条**；固定任务不设硬上限（滚动，软提示 ≤8） | 工作记忆 ≤4~5 项（AC-62 语境） |
| 当前项表达 | 竖条 + 勾二选一 | **竖条** | 与事项窗口当前行一致（跨页统一语言） |
