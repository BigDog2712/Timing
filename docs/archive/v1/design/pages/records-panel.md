# 页面 Override：记录汇总面板 Records Panel

> 覆盖对象：`DESIGN.md` + `design-tokens.json`（MASTER）
> 仅写差异字段，未提及项沿用 MASTER / Token 源。
> 触发：点展开手柄（记录入口） | 主题：恒定深色 | 层：`--z-panel` (20)
> 对应命令：`stats_summary` `list_records` `update_record` `delete_record`
> 相关验收：AC-16（300ms 内展示）/ AC-17（明细 + 改归属）/ AC-18（空状态）/ AC-25

---

## 1. 布局与尺寸标注

```
+-----------------------------------------------+
|  [ 今天 ][ 本周 ]                                |   <- DayTab / WeekTab，高 28
+-----------------------------------------------+
|  总计  03:42:18                                 |   <- 总计行，28px 等宽
+-----------------------------------------------+
|  > 品牌视觉改版              01:20:04        ^  |   <- ItemGroup，高 36，可展开（箭头示意）
|    > 09:12 - 09:47            35:02             |   <- RecordRow，高 32，缩进
|    > 10:03 - 10:48            45:02             |
|  > 客户方案评审                58:10         v  |
|  > 接口联调                    44:04         v  |
+-----------------------------------------------+
   面板宽 --panel-w 300 / 圆角 --radius-lg 16 / 内边距 --space-5 12
   行分隔：1px --border-soft（不用卡片盒）
```

| 规格项 | 值（Token） | 说明 |
|---|---|---|
| 面板宽 | `--panel-w` 300px | 与展开面板同宽，保持一致 |
| 圆角 | `--radius-lg` 16px | |
| 内边距 | `--space-5` 12px | |
| 底 | `--surface-2` | |
| 投影 | `--elev-panel` | |
| Tab（今天/本周） | 高 28px，选中底 `--surface-3` + 文字 `--fg`；未选 `--muted` | 推荐用下划线 2px `--accent` 表选中（**仅 1 处强调**） |
| 总计行 | `--text-timer-lg` 28px 等宽，`--fg`，右对齐（`.timer-digits`） | 用 `tabular-nums` 保证多行数字对齐 |
| ItemGroup 行 | 高 36px，`--text-base` 13px/510，`--fg-2`；左侧图标 `clock` 16px | 可展开/收起 |
| RecordRow | 高 32px，缩进 `--space-6` 16px，`--text-sm` 12px，`--muted`；时长右对齐等宽 | 开始时间 + 时长 |
| 行分隔 | 1px `--border-soft`（**不用卡片盒**） | 高密度用线不用盒 |
| 展开图标 | `chevron-right` 20px（收起）/ `chevron-left`? 见下：旋转 90 度表示展开 | 见 §5 |

---

## 2. 组件树

```
<RecordsPanel>
+-- <TabBar role="tablist">
|   +-- <DayTab/>        // 今天（默认选中）
|   +-- <WeekTab/>       // 本周
+-- <TotalRow/>          // 总计时长（.timer-digits[data-hours])
+-- <ItemGroupList>
|   +-- <ItemGroup itemId>                // 按 stats_summary.byItem 聚合
|       +-- <GroupHeader/>                // clock 16px + 事项名 + 聚合时长 + 展开箭头
|       +-- <RecordRowList>               // list_records 明细，仅 saved
|           +-- <RecordRow recordId/>     // 开始时间 + 时长；右键/点击出改归属/删除
+-- <EmptyState/>                         // 无记录时替代 ItemGroupList
+-- <LoadingState/>                       // 骨架屏
```

---

## 3. 状态与交互

### 3.1 状态矩阵（5 态）

| 状态 | 表现 |
|---|---|
| **Populated** | 按事项聚合行 + 可展开明细 + 总计；AC-16 要求 300ms 内呈现 |
| **Empty** | 当日无记录：居中 `circle-dot` 24px `--muted` + 引导文案「点左侧圆钮开始第一次计时」（**非空白**，AC-18） |
| **Loading** | 骨架屏：3 行 `--surface-3` 圆角块，**静态不闪烁**（`--meta` 描边），<= 300ms |
| **Error** | `DB_ERROR`：「数据读取失败」+ `circle-alert` 16px `--danger` + 「重试」按钮（ghost） |
| **Edge** | 事项数 > 8：面板内滚动（`overflow-y: auto`，滚动条用 `--border-strong`）；单条记录跨零点：归属到**开始日期**；时长 >= 1h：切换 `data-hours` -> `8ch` |

### 3.2 交互

| 用户操作 | 反馈 |
|---|---|
| 点「今天」/「本周」 | 切换数据集，`stats_summary` 重新拉取；Tab 下划线 2px `--accent` 滑动（110ms，`--ease-standard`） |
| 点 ItemGroup 行 | 展开/收起明细（`chevron` 旋转 90 度，`--dur-base`），行高不变（明细分行出现） |
| 点一条记录 | 打开内联编辑：改归属（下拉事项列表）/ 删除（`--danger`），调 `update_record` / `delete_record` |
| 删除记录 | 立即从列表移除；可选 3s 撤销（复用 `attempt` 语义，本期不强制） |
| `Tab` | 在 Tab -> 总计 -> 各 ItemGroup -> 明细行间移动 |
| `Esc` | 关闭记录面板，收回药丸 |
| hover 行 | 底 -> `--surface-3`，`--dur-quick`；**无左边框** |

### 3.3 改归属（update_record）

点明细行 -> 弹出事项选择（复用 chips 或小下拉，宽 `--menu-w` 184px）；选择后 `update_record({ id, patch: { itemId } })`，聚合实时重算。

---

## 4. 引用的 Token 名

- 颜色：`--surface-2` `--surface-3` `--border-soft` `--fg` `--fg-2` `--muted` `--meta` `--accent` `--danger` `--success` `--focus-ring`
- 尺寸：`--panel-w` `--space-3` `--space-5` `--space-6` `--radius-lg` `--radius-sm` `--icon-sm` `--icon-lg` `--menu-w`
- 阴影：`--elev-panel`
- 动效：`--dur-instant` `--dur-quick` `--dur-base` `--ease-standard` `--ease-morph`
- 排版：`--font-mono` `--text-sm` `--text-base` `--text-timer-lg` `--weight-emphasize` `--weight-read`
- 层级：`--z-panel`

---

## 5. 用到的 Lucide 图标与尺寸

| 图标 | 尺寸 | stroke-width | 用途 |
|---|---|---|---|
| `clock` | `--icon-sm` 16px | 2.5 | ItemGroup 行前缀（时长语义） |
| `chevron-right` | `--icon-md` 20px | 2 | ItemGroup 展开箭头（收起态，展开时旋转 90 度） |
| `circle-dot` | `--icon-lg` 24px | 2 | 空状态引导图标 |
| `circle-alert` | `--icon-sm` 16px | 2.5 | 错误态 |
| `pencil` | `--icon-sm` 16px | 2.5 | 明细行「改归属 / 编辑」 |
| `trash-2` | `--icon-sm` 16px | 2.5 | 明细行「删除」（`--danger`） |
| `inbox` | `--icon-lg` 24px | 2 | （可选）本周无任何历史时的空状态图标 |

---

## 6. 本页 Override 差异（相对 MASTER）

| 字段 | MASTER 默认 | 本页覆盖 | 原因 |
|---|---|---|---|
| 分组方式 | 卡片盒 | **1px `--border-soft` 行分隔 + 负空间** | Density=8：高密度用线不用盒子 |
| 总计数字 | `--text-lg` 16 | **`--text-timer-lg` 28px 等宽** | 总计是核心数据，用等宽数字对齐 |
| 强调色用量 | 每屏 <= 2 | 本页**仅 1 处**（Tab 选中下划线） | 避免与药丸环争夺注意力 |
| 空状态 | 通用文案 | 「点左侧圆钮开始第一次计时」+ `circle-dot` | AC-18 强制引导，且指向具体动作 |
| 选中 Tab | 背景块 | 2px 下划线 `--accent` 滑动 | 比背景块更克制，符合仪表气质 |
