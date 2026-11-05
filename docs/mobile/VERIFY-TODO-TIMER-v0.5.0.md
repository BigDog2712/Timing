# 验证报告 — 安卓端「待办直接开始计时 + 计时中可切换事项」

- 版本标记：v0.5.0（`package.json` 实为 `0.4.1`，本文件名沿用主理人口径）
- 验证人：QA（Edward / 严过关）
- 验证对象：工程师本轮 7 改 + 5 新（`src/` 侧），**独立核实，不采信自述**
- 验证方式：门禁实跑 + 全量测试实跑 + 逐行代码审查 + **QA 新补 8 条边界探针**
- 本机限制：无 MSVC / 无 Android SDK·NDK·JDK → 未跑 `cargo`、未构建 APK、未真机验证
  > **2026-11-05 补记**：JDK 17 / Android SDK（platform 35·36、build-tools 36.0.0）/ NDK 27.2 已装齐，
  > `arm64-v8a` release APK 已实机构建通过（8.7 MB，`com.timing.app` v0.5.0）。
  > 详见 `docs/mobile/TOOLCHAIN-SETUP.md`；真机安装仍未验证（当前无设备）。

---

# R3 收尾（最终结论）

```
$ npm run check  → CHECK_EXIT=0   （契约 67/16/11 一字不差；441 文件 ≤300 行；layers 7 条；eslint 无输出）
$ npm test       → TEST_EXIT=0     Test Files 41 passed (41) / Tests 317 passed (317)
```

1. **最终结论：PASS。** P0 = 0，**P1 = 0**，P2 = 4（全部为 Known Issues，见第 4 点）。门禁与 317 条测试全绿；317 = 318 − 1（按裁决删掉与 `ItemsPage.guard.test.tsx` 重叠的那条 P2-13 用例）。
2. **P2-12 / P2-13 我自己复验过（非采信工程师）**：
   - P2-12 —— 用**我自己的断言**在真实 `ItemsPage` 上压：同一同步块连发两次 → `todo_start` **1 次**（`TodoStartEdges.r2.test.tsx` ① 第 2 条，绿）。源码为 `startingRef`（`ItemsPage.tsx:82,120-125`），同步写入、不读闭包快照。
   - P2-13 —— 删我那条件之前，同一轮跑里**我的 ② 与工程师的 guard 两条同时绿**（10 passed）；删后由 `ItemsPage.guard.test.tsx`「不外溢（P2-13）」继续守在 317 里。源码 `ItemsPage.tsx:119-131`：锁只在 idle 分支内，`openSheet` 在锁外无条件执行。
3. **最终分级**：P0 = **0** ／ P1 = **0** ／ P2 = **4**（P2-2、P2-3、P2-4、P2-14）。R1 的 P1-1 与 P2-1/P2-5/P2-8、R2 的 P2-12/P2-13 均已修并复验。
4. **Known Issues 最终清单（写 CHANGELOG 用，逐条一句话）**：
   - **P2-2** —— 运行中「结束并新开」时 `pause` 成功但 `switchItem` 失败，秒表停在暂停且无 `resume` 补偿（只弹错误；`mobileTimerActions.ts:62-76`，与桌面 `startOrSwitch` 同模式，本轮之前即有）。
   - **P2-3** —— `createAndSwitch` 建好事项后切换失败会留下一条同名孤儿事项，无回滚；重试时按名命中可自愈（`mobileTimerActions.ts:141-156`）。
   - **P2-4** —— 「计时中」判定是标题匹配，两条同名待办会同时显示「计时中/已暂停」且都没有可点入口；用户无法区分哪条被消费（`ItemsPage.tsx:108,186`）。
   - **P2-14** —— 「计时中」标记的 `role="status"` 挂在随内容一起新建的节点上，live region 需「先存在后变更」，部分 TalkBack/VoiceOver 版本不播报；静态文本仍可读到（`TodoRowMobile.tsx:87`）。
5. **「无法验证项」与 R2 完全一致，无变化**：cargo/Rust 执行（缺 MSVC，后端结论均为读源码推断并标行号）、APK 构建与真机、真机手感、Android 返回键真实行为、浏览器 dev 待办区（browserMock 不覆盖 todo）。另新增一条同类的：真实浏览器「两次 tap 分属两个宏任务」是规范依据，本机无浏览器，未实测（§R2-4b Q1）。

---

# 第 2 轮回归（R2）

> 本节是 R2 增量；下方 §1–§6 是 R1 原文，未改写的部分仍然有效。R1 问题的处置见 §R2-5。

## R2-1. 结论

**PASS** —— 4 项修复 + 我发现的 2 条 P2（闭包陷阱 / 锁误伤非 idle）全部落地并复验，
2 条 P2 已从「已知问题」翻转成回归保护；门禁与 318 条测试全绿。
唯一残留是 P2-14（`role="status"` 挂在随内容新建的节点上，播报不确定），文档级，不阻断。

> 演变：18:03 我测出 `useState` 闸可被同一同步块连发绕过（P2-12）、且锁误伤「弹选单」（P2-13），
> 当时结论是 PASS WITH ISSUES；18:06 工程师落 `useRef` + 把锁挪进 idle 分支；
> 18:08 我翻转断言复验通过 → **PASS**。过程见 §R2-4。

## R2-2. 门禁与测试实测

```
$ npm run check > /tmp/r3_check2.log 2>&1; echo "CHECK_EXIT=$?"     → CHECK_EXIT=0
[contract] OK — 命令：Rust 67 / IpcApi 67 / ipc.ts 67 / mock 67；错误码：Rust 16 / 前端 16；事件：后端 11 / 前端 11 / emit 点 11
[size]     OK — 扫描 441 个文件，上限 300 行
[version]  OK — 0.4.1  ｜ [layers] OK — 7 条  ｜ eslint --max-warnings=0（无输出）

$ npm test > /tmp/r3_test2.log 2>&1; echo "TEST_EXIT=$?"           → TEST_EXIT=0
 Test Files  41 passed (41)
      Tests  318 passed (318)
```

拆账（三个时点，均为我实跑）：
- R1 末：**303 / 39**
- R2 首：**310 / 39**（工程师 +7：`mobileTimerActions.test` +59 行、`ItemsPage.todoStart.test` +44 行、`TodoRowMobile.test` +12 行）
- R2 末：**318 / 41**（我新增 `TodoStartEdges.r2.test.tsx` 7 条；工程师新增 `ItemsPage.guard.test.tsx` 3 条 + 2 条）
- **R3 收尾：317 / 41**（按裁决删掉与 guard 重叠的 1 条 P2-13 用例）

Rust 与 `android-app/` 仍零改动（`git status --short src-tauri/` 变化集与 R1 完全相同）。

## R2-3. 4 项修复逐条核实

| # | 声称 | 实测证据 | 判定 |
| --- | --- | --- | --- |
| ① | 归档匹配口径重写（`startTodo` 非 idle 分支） | `mobileTimerActions.ts:120-127`。三处口径逐一对照后端 `repositories/item.rs:24-34`：<br>· `includeArchived:true` + 后端 `WHERE deleted_at IS NULL`（归档保留、软删排除）→ **等价**；`item.rs:37-46` 的 `list` 恒带 `deleted_at IS NULL`，`include_archived` 只加不加 `status` 条件<br>· `.filter(name === …)` vs `name = ? COLLATE BINARY` → **等价**（`===` 与 BINARY 都是「码点/字节严格相等」，都不做大小写/trim 归一）<br>· `.sort((a,b)=>a.id-b.id)[0]` vs `ORDER BY id ASC LIMIT 1` → **等价**（同为最小 id）<br>· `.sort()` 原地排序确实会改数组，但作用在 `filter()` 的**新副本**上，`all` 之后没再被用（`:126-127` 一条链）→ 无副作用，实测源数组顺序不变 | ✅ |
| ② | 未 reload `useItemStore`；删掉错误注释；`Item` 类型 import 移除；`list` 抛错 → `notify` + `return false` 且不新建 | `:14-18` 已无 `Item` import（只剩 `SwitchMode`）；`:118` 明写「只用于本次匹配、不写回 store」；探针 ③ 实测 `useItemStore.getState().items` 仍为 `[2]`（未被归档项污染）；`:120-124` `.catch` → `return false`，探针 ③ 实测 `create` / `remove` 均零调用、`notice.text='读事项失败'` | ✅ |
| ③ | 连点锁（原 `starting` / `useState`） | 原版：跨 commit 1 次、**同 commit 2 次**（闸被闭包快照绕过）→ 报 P2-12。18:06 改为 `startingRef`（`useRef`）后复验：同 commit 也**只 1 次**（真实组件） | ✅ 已修（§R2-4c） |
| ④ | 非 idle 分支不受锁影响 | 原版**不成立**（锁在 idle 判断之前，点另一条零反馈）→ 报 P2-13。18:06 把锁移进 idle 分支后复验：锁上时点另一条 → `sheet = todoSwitch`，`todo_start` 仍 1 次 | ✅ 已修（§R2-4c） |
| ⑤ | P2-5 `paused` 文案 | `TodoRowMobile.tsx:87-89` `paused ? '已暂停' : '计时中'`；`ItemsPage.tsx:68,187` `timerStatus` 订阅 + `paused={timerStatus==='paused'}`。探针 ④ 实测 paused + 两条同名 → `['已暂停','已暂停']`、`role=status`、0 个开始按钮 | ✅ |
| ⑥ | P2-8 `role="status"` | `TodoRowMobile.tsx:87` 已加；探针 ④ 断言 `role === 'status'` | ✅（残留 P2-14） |
| ⑦ | `active` 判定口径未变 → P2-4 仍在 | `ItemsPage.tsx:108,186` 仍是 `todo.title === itemName(...)`。复测：两条同名 + running → 仍是 2 个 `计时中`、0 个按钮 | ✅ 与声称一致 |


## R2-4. 闭包陷阱专项

> 本节回答主理人的 3 个问题。**实验期间源码被改了**：18:03 我测的是 `useState` 版，
> 18:06 工程师已落 `useRef` + 把锁挪进 idle 分支；两套结论都保留（下表的 A/B 两组），
> 并在 §R2-4c 用**真实组件**复验了修复。

### R2-4a. 实验矩阵：`useState` 闸 vs `useRef` 闸

方法：闸的状态用「永不 resolve 的 promise」钉住，同一挂载内 `dispatchEvent`。
`useRef` 组用**镜像组件**验证（与 `ItemsPage.startTodo` 同构：同样的 guard → arm → await → finally
disarm，不改源码），`useState` 组同时也在真实 `ItemsPage` 上验证过，两组结论一致。

| # | 闸的写法 | 派发时序 | 越过闸的次数 |
| --- | --- | --- | --- |
| E1 | `useState` | 同一 `act` 内同步连发两次 | **2** |
| E2 | `useRef` | 同一 `act` 内同步连发两次 | **1** |
| E3 | `useState` | 两个 `act`（中间有 commit） | 1 |
| E4 | `useRef` | 两个 `act` | 1 |
| E5 | `useState` | **`act` 之外**，同一同步块连发两次 | **2** |
| E6 | `useRef` | `act` 之外，同一同步块连发两次 | 1 |
| E7 | `useState` | 两次之间只隔 **1 个 microtask**（`await Promise.resolve()`） | 1 |
| E8 | `useState` | 两次之间隔 **1 个宏任务**（`setTimeout 0`） | 1 |

`E5` 是这次最重要的一个格子：它排除了「A 场景只是 `act` 批处理造成的假象」这个解释——
**不套 `act` 也一样绕过**，说明这是真实的 React 语义，不是测试框架的锅。

`E7` 给出了精确边界：**只要 JS 栈展开 + 过一个 microtask，`useState` 闸就生效**。
也就是说这个闸的正确性依赖「两次点击之间至少有一次栈展开」，不是依赖 re-render 本身。

### R2-4b. 回答三个问题

**Q1：真实浏览器的双击 / 连点，两次 `click` 是同一个宏任务还是各自独立宏任务？**

**各自独立的宏任务**（结论），依据分两层：

1. 规范层：`click` 属于 user interaction 事件，由 event loop 的 *user interaction task source*
   单独排队；每个输入事件在自己的 task 里派发。一次「双击」在时间线上是
   `pointerdown → pointerup → click → pointerdown → pointerup → click → dblclick`，
   两次 `click` 之间夹着别的输入事件，必然是不同 task。
2. 本机间接证据：E7/E8 表明只要**栈展开 + 1 个 microtask** 闸就生效，而真实输入事件之间
   间隔的是**整个宏任务**（且中间还有多次渲染机会），远在边界之外。

**⚠️ 无法验证的部分**：本机无浏览器（无 Android SDK / 无桌面浏览器自动化），
上面第 1 点是**规范 + 实现常识**，不是本机实测。若要钉死，需要在真机上打点。

**Q2：把 A 的写法改成「两次独立 `act`」后，断言变成 1 次还是 2 次？**

**变 1 次**（E3）。这直接证明 `useState` 闸的生效条件是「两次点击之间有栈展开」。
原本工程师的测试就是分开两个 `act` 写的，所以它 Green 并不假；它只是**测不到**闭包陷阱。

**Q3：改用 `useRef` 做闸，A 场景会不会变 1 次？**

**会**（E2 / E6）。而且不止镜像组件——工程师落地 `useRef` 后，我用**真实 `ItemsPage`**
（同 `act` 内同步连发两次、命令挂住）复验：`todo_start` **1 次**（§R2-4c）。

### R2-4c. 修复已落地并复验（验证期间变更）

| 时间 | 源码状态 | 我的两条 ⚠️ 探针 |
| --- | --- | --- |
| 18:03 | `useState` 闸 + 锁在 `startTodo` 首行 | 全绿（钉的是 bug） |
| 18:06 | `startingRef`（`useRef`）+ 锁移进 idle 分支 | **按设计变红**——canary 正常触发 |
| 18:08 | 我把断言翻转 | 7/7 全绿 |

复验证据（真实组件，非镜像）：
- 同一同步块连发两次 → `todo_start` **1 次**（`TodoStartEdges.r2.test.tsx` ① 第 2 条）
- 锁上时点另一条 → `sheet = {kind:'todoSwitch', todoId:3, title:'写周报'}`，且 `todo_start` 仍 1 次（②）
- 工程师另加 `ItemsPage.guard.test.tsx`（3 条）覆盖同一不变量 + **锁释放**（防一次性死锁），
  我复核了断言方向与 `hangStart()` 的用法，正确。与我的探针重叠但方向一致，不是矛盾。

### R2-4d. 判断与建议

- **真实用户可达性：不可达。** 两次 tap 必属两个宏任务，闸在第一次点击的栈展开后即已武装；
  E5 虽能绕过，但那是「同一同步块内程序化连发」，真实输入产生不了。
- **分级：P2，不是 P1。** 它是「防线比声明弱」，不是用户能撞的缺陷。
  但它把正确性押在「React 会在两次输入事件之间 flush」这个调度器实现细节上，
  而 `useRef` 把这个假设彻底移除、成本 3 行、无任何副作用。
- **建议：采纳 `useRef`（主理人的倾向我完全同意）**，并且**锁只放在 idle 分支内**——
  非 idle 只弹面板、一条命令都不发，被锁挡住就是「点了没反应」，正是本次需求的原始抱怨（P2-13）。
- **这两条现在已是真正的回归保护**：谁把锁退回 `useState`、或把锁移回 `startTodo` 首行，
  `TodoStartEdges.r2.test.tsx` 与 `ItemsPage.guard.test.tsx` 会立刻变红。

## R2-5. R1 问题清单的 R2 处置

| R1 编号 | 处置 |
| --- | --- |
| P1-1 归档口径不一致 | ✅ **已修**。三条口径全部与后端对齐（证据见 §R2-3 ①），并顺带修好一条 R1 没单列的：当前会话落在**归档事项**上时（`itemName` 回退「未归类」，行上仍显示「开始」），现在会走 `same.id === currentItemId → removeTodo`，不再造同名重复事项 |
| P2-1 连点两条 `todo_start` | ✅ **已修**（红条窗口消失）；其两个残留 P2-12 / P2-13 也已在 R2 末一并修掉（§R2-4c） |
| P2-5 暂停态文案 | ✅ 已修 |
| P2-8 无 role | ✅ 已加；残留 P2-14 |
| P2-2 / P2-3 / P2-4 / P2-6 / P2-7 / P2-9 / P2-10 / P2-11 | 未声称修，**仍然存在**。P2-4 已复测确认仍在 |

## R2-6. R2 新发现（两条已在 R2 内修掉）

| # | 位置 | 现象 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
| P2-12 | 原 `ItemsPage.tsx:81,113-122` | 锁是闭包快照：同 commit 内连发全部放行（实测 2 次，三次则 3 次） | 真实手势不可达，但「锁」名不副实，押注在 React 调度器实现细节上 | ✅ **已修**：`startingRef`（`useRef`），复验同 commit 只 1 次（§R2-4c） |
| P2-13 | 原 `ItemsPage.tsx:114-115` | 锁放在 idle 判断**之前**，把「非 idle → 弹选单」也挡住，实测 `sheet=null` + `notice=null` 零反馈 | 窗口是启动后三次 IPC（真机 50–150ms），「点了没反应」＝本需求原始抱怨复现 | ✅ **已修**：锁移进 idle 分支，复验点另一条正常弹选单（§R2-4c） |
| P2-14 | `TodoRowMobile.tsx:87` | `role="status"` 挂在**随内容一起新建**的节点上（而非常驻容器换文案）。live region 需「先存在、后变更」，部分读屏器（TalkBack/VoiceOver 版本差异）不会播报 | 播报不一定生效；静态文本仍可被读到，故只是降级 | ⬜ 仍在（文档级，低优先） |

## R2-7. 探针更新（含一处对你清单的纠正）

你列的 3 行里，只有第 2 行对应 R1 里**真实存在的断言**。逐条说明（不是找茬，是免得你以为漏改）：

| 你列的 | 实情 | 我做了什么 |
| --- | --- | --- |
| 「同名但已归档 → 新建同名事项」 | R1 探针 ⑤ **不是**这条：它模拟的是「全库都没有同名」→ 走 `createAndSwitch`，R2 后依然成立所以没红。归档场景 R1 只有**代码行号论证**，没有断言压着 | 新增 `TodoStartEdges.r2.test.tsx` ③ 两条：复用归档 id + `itemApi.list` 收到 `{includeArchived:true}` + 选择器 store 不被写回 + 同名多条取最小 id + `list` 返回的源数组不被 `.sort()` 打乱 + 读不到列表时收手 |
| 「暂停态显示计时中」 | R1 **没有**这条断言（P2-5 同样是代码阅读得出） | 新增 ④：paused + 两条同名 → 两个「已暂停」+ `role=status` + 0 个开始按钮 |
| 「连点两次 → 2 次」 | **它没有变红**（310/310 里我那条旧断言还在）。这不是漏改，而是 §R2-4 闭包陷阱的直接证据 | 先删除该条、拆成两条迁到 r2 文件；`useRef` 落地后把两次都翻成「只发 1 次」（含同 commit 场景），现为回归保护 |

`TodoStartEdges.test.tsx` 现为 6 条（原 8 条 − ⑦ 连点；①–⑥ 语义在 R2 后均未变）。

## R2-8. 路由判定

**NoOne** —— 无未关闭的阻断项：4 项修复 + P2-12 + P2-13 全部落地并复验，
门禁 `CHECK_EXIT=0`、`TEST_EXIT=0`（41 文件 / 318 用例），Rust 与 `android-app/` 零改动。

可交付。唯一建议是 P2-14 记进 CHANGELOG 的 Known Issues（`role="status"` 的播报在部分读屏器上不生效），
不需要再投改动。

---

## 1. 结论

**PASS WITH ISSUES**

用户拍板的 5 条交互语义（idle 直开 / 非 idle 弹选单 / active 静态标记 / 切换失败保留待办 / 已完成不给开始）
**全部实现且被测试钉住**，三条硬门禁（契约 67·16·11、单文件 ≤300 行、CSS 零字面量色值）全绿。

但有 **1 条 P1**：`startTodo` 在「不是 idle」时自己按标题在**已加载（= 未归档）**事项里找匹配，
而后端 `todo_start` 走 `item::find_by_name`（**不过滤归档**）。同一次操作的两条路径匹配口径不同 ——
正是用户抱怨的「逻辑不一致」，且计时中路径会**新建一条与归档事项同名的 active 事项**，
违反 `services/todo_start.rs` 头部写明的「避免出现同名两个事项」不变量。详见 §4 P1-1。

其余 11 条为 P2（含 1 条最可能被用户看见的：空闲态连点两下会弹一条无意义的「待办不存在」）。

---

## 2. 门禁与测试实测（真实退出码）

### 2.1 `npm run check`

```
$ npm run check > /tmp/check3.log 2>&1; echo "EXIT=$?"
CHECK_EXIT=0

[contract] OK — 命令：Rust 67 / IpcApi 67 / ipc.ts 67 / mock 67；错误码：Rust 16 / 前端 16；事件：后端 11 / 前端 11 / emit 点 11
[size]     OK — 扫描 439 个文件，上限 300 行
[version]  OK — 0.4.1（桌面六处口径一致；归档冻结 android-app: versionName=0.3.6 versionCode=9）
[layers]   OK — 7 条分层规则全部通过（扫描 396 个文件）
> eslint src --max-warnings=0
```

- ✅ 硬约束 1 **命令 67 / 错误码 16 / 事件 11**，一字不差，本轮**未新增任何 IPC 命令 / 事件 / 错误码**
- ✅ 硬约束 2 单文件 ≤300 行（本轮最大 244 行 `ItemsPage.tsx`；QA 新加测试 288 行）
- ✅ 硬约束 3 对 6 个改动文件做 `#[0-9a-f]{3,8}|rgba?\(|hsla?\(` 扫描 → **无字面量色值**；无 emoji
- `EXIT=0` 为 `npm run check` 自身的退出码（不是 `tail` 的）

### 2.2 `npm test`

```
$ npm test > /tmp/test3.log 2>&1; echo "EXIT=$?"
TEST_EXIT=0
 Test Files  39 passed (39)
      Tests  303 passed (303)
   Duration  3.14s
```

拆分口径（重要，与主理人给的数字有差异）：

| 口径 | 文件 | 用例 | 说明 |
| --- | --- | --- | --- |
| 工程师基线（我实测） | 38 | **295** | 主理人口径为 292 —— 同一 38 文件，差 3 条，疑为统计快照时间差 |
| + QA 补测 `TodoStartEdges.test.tsx` | +1 | +8 | 见 §3.C |
| 合计 | **39** | **303** | 全绿，`EXIT=0` |

### 2.3 硬约束 4 / 5：不许改 Rust、不许动 `android-app/`

```
$ git status --short src-tauri/ | grep -E "todo_start|repositories/item|services/timer|todo_cmd"
(none)
$ git status --short android-app/ | grep -v "^A "
(none)
```

- **硬约束 4 通过**：`src-tauri/` 现存改动全部是**上一轮「改名阶段一 + 数据迁移」遗留**
  （`Cargo.toml`、`Cargo.lock`、`appdata_migrate/`、`migration_cmd.rs`、`shell_open.rs`、`preboot.rs` 等），
  **没有任何一个属于本轮 12 文件清单**；尤其 `services/todo_start.rs`、`repositories/item.rs`、
  `services/timer.rs`、`commands/todo_cmd.rs` **零改动**（本轮纯前端改造，成立）。
- **硬约束 5 通过**：`android-app/` 下条目全部是 `A`（既有归档件已入暂存区），无 `M` / `?` / `D`。
- 本机 `cargo` 不可用（缺 MSVC），故以上为 git 层核实，非编译核实。

---

## 3. 逐条核实表

### A. 真实执行

| 项 | 结论 | 证据 |
| --- | --- | --- |
| `npm run check` | ✅ 通过 | §2.1，`CHECK_EXIT=0`，四行 OK 全齐 |
| `npm test` | ✅ 通过 | §2.2，`TEST_EXIT=0`，303/303 |

### B. 代码审查（找逻辑漏洞）

| # | 审查点 | 结论 | 证据 |
| --- | --- | --- | --- |
| B1 | `startTodo` 顺序：**切换成功才删待办** | ✅ 正确 | `mobileTimerActions.ts:122-127` —— `switched` 为假直接 `return false`，`removeTodo` 在 `if (!switched)` **之后**；`removeTodo`（`:34-46`）独立 try/catch，自身失败不外抛 |
| B2 | 失败路径有没有可能删待办 | ✅ 没有 | 三条失败出口（`:104` idle 抛错 / `:126` switched=false / `:142` createAndSwitch 抛错）全部 `return false` 且不触碰 `todoApi.remove`。`TodoSwitchSheet` 按返回值决策更保守：**只弹提示，不看返回值也不删**（`SwitchModeSheet.tsx:85-92`）。探针 ②④ 双向验证 |
| B3 | `switchTo` 的 `pause → switchItem → resume` 顺序 | ✅ 未被破坏 | `:62-68`：`needPause = wasRunning && mode==='end_and_start'` → `pause()` → `switchItem()` → 仅当 `wasRunning && next.status==='paused'` 才 `resume()`。与后端守卫吻合：`timer.rs:184-186` 对 running 会话的 `end_and_start` 直接 `TIMER_ALREADY_RUNNING`，所以先暂停是**必需**的。工程师单测 `mobileTimerActions.test.ts:216-226` 断言了 `pause < switchItem` 的调用序（我也复核了断言强度：用 `invocationCallOrder`，不是"都调过"） |
| B4 | `resume` 分支是否可达 | ⚠️ 观察（见 P2-10） | 依 `timer.rs:177-207`：`JustSwitch` 保留 `running_since` → 返回 running；`EndAndStart` 走 `session::end_and_start` 新开 running。**两种 mode 下 `next.status` 都不可能是 `paused`**，该分支在当前后端语义下不可达（防御性死代码，AGENTS.md 有"不留死代码"条）。cargo 不可用 → 只能推断，无法实测 |
| B5 | `Same.id === currentItemId` 时「只删待办不动秒表」 | ✅ 设计合理（但见 P2-5） | `:118-120`。UI 上不可达（active 时无按钮），是竞态兜底；暂停态语义成立 |
| B6 | `TodoSwitchSheet` 确认/取消 | ✅ 正确 | 取消 = 纯 `closeSheet`（`SwitchModeSheet.tsx:100`），零命令；确认有 `busy` 闸（`:86`）防二次提交；文案不吐枚举名（`SwitchModeSheet.tsx:28-31`，探针断言 `textContent` 不含 `end_and_start`） |
| B7 | Sheet 打开期间计时状态变化 | ⚠️ 逻辑正确 / 文案滞后（P2-6） | `startTodo` 在**确认那一刻**重读 `status`（`:90`），计时已结束则安全走 idle 路径 —— 探针 ③ 实测 `todoApi.start(3)` 且 `switchItem` 零调用、无错误提示。但面板正文写死「现在有一条正在计时」（`:109`），此时是假话 |
| B8 | `TodoRowMobile`：`active` 分支 / `onStart` 可选 / 长按 | ✅ 正确 | `:67-76` done 优先（`!done` 外层包住），active → `<span>`，否则 `onStart != null &&` 才渲染按钮；`:60` 长按只绑 `.m-todo__body`，**没有**绑到 `开始` 按钮 / 「计时中」span / 圆圈（diff 确认）→ 手指按住按钮不会误删 |
| B9 | `mobileUiStore.todoSwitch` 是纯本地 UI 状态吗 | ✅ 是 | `mobileUiStore.ts:30` 只有 `{ kind, todoId, title }`，`openSheet`（`:57`）纯 `set`，**不触发任何 ipc**；`check:contract` 命令数仍 67 就是最硬的证据 |
| B10 | `SheetHost` 新分支破坏返回键语义吗 | ✅ 结构上不可能 | `MobileShell.tsx:75-76` 只加一个 `case`；返回键由 `useMobileBackSheet(sheet != null)`（`:92`）统一驱动，与 `kind` 无关，新 Sheet **自动**纳入「返回键先关 Sheet」层级。真机行为无法验证（见 §5） |
| B11 | 桌面逻辑是否被带坏 | ✅ 没碰 | 本轮零 Rust 改动、`useTimerActions.ts` 未改；`mobileTimerActions` 是手机独有层（`git diff` 确认 `SwitchItemSheet` 仅把分段控件换成 `SwitchModeSeg`） |

### C. QA 补测边界（核心价值，8 条全绿）

新文件 `src/components/mobile/TodoStartEdges.test.tsx`（288 行，8 用例，`EXIT=0`）。
断言写的是**当前实际行为**，作用是防回归 —— 修好之后这些用例必须一起改，改动点就是这 8 处。

| # | 边界 | 结论 | 证据（用例 / 实测输出） |
| --- | --- | --- | --- |
| C1 | **两条同名待办**，点其中一条开始，另一条会不会误亮「计时中」 | ❌ 会，两行都亮（**P2-4**） | 用例 ⑥：`RUNNING(session.itemId=7)` + 两条 title 均为「写周报」→ `.m-todo__live` 数量 **= 2**，`button.m-btn--accent` 数量 **= 0**。根因 `ItemsPage.tsx:176`：`active = session != null && todo.title === activeName`，纯标题匹配，无 id 可区分 |
| C2 | 待办标题与**已归档**事项同名 → 两条路径是否不一致 | ❌ **不一致，且会造同名两条事项（P1-1）** | 代码铁证：`api.ts:46` `includeArchived: false` → `useItemStore.items` 只有 active；`mobileTimerActions.ts:114-116` 只在这个列表里找；后端 `repositories/item.rs:24-34` `find_by_name` **只过滤 `deleted_at`，不过滤 `status='archived'`**；`services/todo_start.rs:35-38` 用它。→ idle 路径命中归档事项并开计；非 idle 路径看不到它 → `item::create` 新建同名。用例 ⑤ 证实「不在已加载列表 → `itemApi.create({name:'写周报'})` 被调用」 |
| C3 | **切换失败**时待办是否真的保留 | ✅ 保留 | 用例 ②④：`switchItem` reject → `todoApi.remove` **零调用**、`notice.text='切不过去'`；工程师 `mobileTimerActions.test.ts:191-201` 同结论（断言正确，我复核后未改） |
| C4 | **paused** 点待办是否走选单、`pause` 会不会重复调 | ✅ 走选单；✅ 不重复调 | 页层：`ItemsPage.todoStart.test.tsx:184-194`（paused → `sheet.kind==='todoSwitch'`、`todo_start` 零调用）；动作层用例 ①：paused + `end_and_start` → `timerApi.pause` **未调用**（`needPause` 要求 `wasRunning`），`switchItem(7,'end_and_start')` 一次；paused + `just_switch` → pause / resume 均未调用（用户的暂停状态被尊重） |
| C5 | **Sheet 打开期间计时被结束**，confirm 是否安全回落 | ✅ 安全 | 用例 ③：面板开着 → 计时改 `idle` → 点「就这样切」→ `todoApi.start(3)` 被调、`switchItem`/`pause` 零调用、`notice === null` |
| C6 | **已完成待办**真的没有「开始」按钮 | ✅ 双层都成立 | 行层 `TodoRowMobile.test.tsx:110-133`（没传 `onStart` / 传了 `onStart` 但 `doneAt != null` → 都渲染 0 个按钮）；页层 `ItemsPage.todoStart.test.tsx:207-223`（展开「已完成 N 条」后断言 `.m-btn--accent` 为 null）。两层都覆盖，不是只靠 props 约定 |
| C7 | `createAndSwitch` 建了事项但切换失败 → 孤儿事项 | ⚠️ **证实存在（P2-3）** | 用例 ⑤：`itemApi.create` 已落地，`switchTo` 返回 false 后**没有任何删除/回滚调用**（`mobileTimerActions.ts:137-145` 的 catch 只 `notify` + `return false`）。影响评估：**可自愈** —— 用户重试时 `startTodo` 先 `reload` 拿到刚建的事项，按名命中后走 `switchTo`，不会二次新建。故 P2 而非 P1 |
| C8 | 其它回归（自找） | 3 条新发现 | ①**冒烟：空闲连点两下 → 两次 `todo_start`**（用例 ⑦，`[[3],[3]]`）。后端 `repositories/todo.rs:12-19` `find_by_id` 排除软删 → 第二发必然 `TODO_NOT_FOUND`，用户在一次成功的开始之后 0.1s 内收到「待办不存在」的红条。`SwitchItemSheet` 有 `busy` 闸、待办行**没有** → P2-1（**R2 已加闸；用例 ⑦ 拆成两条迁到 `TodoStartEdges.r2.test.tsx`，见 §R2-4**）。②**pause 成功 + switch 失败 → 秒表被静默暂停、无 resume 补偿**（用例 ②，`pause` 1 次 / `resume` 0 次）→ P2-2。③**暂停态该行显示「计时中」**，看不出秒表是停的 → P2-5（**R2 已修**） |

### D. 可访问性 / 交互细节

| # | 项 | 结论 | 证据 |
| --- | --- | --- | --- |
| D1 | `active` 用 `<span>` 替代 `<button>`，44px 命中区是否丢失 | ✅ **不算丢失**（无交互即无命中区要求） | 旧按钮 `min-height: var(--m-tap)`（`primitives.css:12-14, 56-59`，`--m-tap: 44px` 见 `shell.css:12`）→ 新的 `.m-badge`（`primitives.css:184-190`）高约 20px，但它是**纯静态文本**，不可点，44px 规则不适用。布局不会跳：`.m-todo` 有 `min-height: 56px`（`items.css:56-66`）兜住；`.m-todo__live` 只补 `flex: 0 0 auto` 防压扁（`items.css:126-130`） |
| D2 | 「计时中」静态标记的 aria 语义 | ⚠️ **缺（P2-8）** | `TodoRowMobile.tsx:69` 渲染 `<span class="m-badge m-badge--accent m-todo__live">计时中</span>`，无 `role`、无 `aria-live`。工程师自己的用例 `TodoRowMobile.test.tsx:106` 明确断言 `role === null`（**刻意**做成非按钮，这点是对的），但副作用是：秒表开始/切换导致这个标记**出现**时，屏幕阅读器不会播报（全壳唯一的 live region 是 `MobileNotice` 的 `role="status"`，`MobileShell.tsx:58`）。建议 `role="status"`，或给整行加 `aria-label` 描述当前状态 |
| D3 | 分段控件 `SwitchModeSeg` 的 a11y 有无退化 | ✅ 无退化，还略有增强 | 与 `SwitchItemSheet` 原实现逐字对比（`git diff`）：`role="radiogroup"` + `aria-label="切换方式"` + `role="radio"` + `aria-checked` + `data-on` **全部保留**；新增 `disabled={busy}`（切换进行中禁止再点，原实现没有）。文案单一来源 `SWITCH_MODES`（`SwitchModeSheet.tsx:28-31`），消灭了两处各写一份的分叉风险 |
| D4 | 长按删除仍只在文字区 | ✅ | `TodoRowMobile.tsx:60` `{...longPress}` 只在 `.m-todo__body` 上 |

### E. 工程师自述清单核对（发现行数不符）

| 文件 | 自述行数 | 实测 | 差 |
| --- | --- | --- | --- |
| `services/mobileTimerActions.ts` | 90 → 147 | 147 | ✅ |
| `components/mobile/ItemsPage.tsx` | 226 → 243 | **244** | ⚠️ +1 |
| `components/mobile/TodoRowMobile.tsx` | 62 → 69 | **79** | ⚠️ +10 |
| `components/mobile/SwitchItemSheet.tsx` | 127 → 102 | 102 | ✅ |
| `components/mobile/MobileShell.tsx` | 146 → 149 | 149 | ✅ |
| `stores/mobileUiStore.ts` | 56 → 61 | 61 | ✅ |
| `styles/mobile/items.css` | 188 → 194 | 194 | ✅ |
| `SwitchModeSheet.tsx`（新） | 113 | 113 | ✅ |
| `mobileTimerActions.test.ts`（新） | 227 | 227 | ✅ |
| `TodoRowMobile.test.tsx`（新） | 116 | **134** | ⚠️ +18 |
| `ItemsPage.todoStart.test.tsx`（新） | 205 | **224** | ⚠️ +19 |
| `TodoSwitchSheet.test.tsx`（新） | 182 | 182 | ✅ |

4 处不符（全部为"实际比自述多"），说明清单是**中间态快照**。不影响结论，但"4 个数字不对"本身不值得信以为真 —— 已用 `wc -l` 逐个复核（P2-11）。
另外 `MobileShell.tsx` 夹带了一处与本需求无关的改动：`pushState({tickbarRecover})` → `{timingRecover}`（改名阶段一遗留，grep 确认全仓已无 `tickbarRecover` 引用，无害）。
`docs/mobile/DESIGN-ANDROID-V1.md` 有 6 行改动，内容为 `android-app/` 归档说明，**与本需求无关**（不是第 13 个文件）。

---

## 4. 发现的问题清单

> **R2 补充**：P1-1 / P2-1 / P2-5 / P2-8 已在 R2 修复，逐条处置见 §R2-5；本节保留 R1 原始记录不改写。

### P0（阻断）—— 无

核心链路（idle 直开 / 非 idle 弹选单 / 切换成功才删待办 / 失败保留待办 / active 不可点 / 已完成无按钮）
全部正确，且有测试钉住。

### P1（应修）

#### P1-1 归档事项让「同一次操作」有两条不同口径的路径，并会造出同名两条事项

- **文件:行号**
  - `src/services/mobileTimerActions.ts:111-116`（前端在「已加载 = 未归档」列表里按名匹配）
  - `src/services/api.ts:46`（`itemApi.list` 默认 `includeArchived: false`）
  - `src-tauri/src/repositories/item.rs:24-34`（`find_by_name` **只** 过滤 `deleted_at IS NULL`，不过滤 `status`）
  - `src-tauri/src/services/todo_start.rs:35-38`（idle 路径用它）
  - `src-tauri/src/services/timer.rs:89-96`（`start` 只校验事项存在，不校验 `status` → 归档事项可被开计）
- **现象**：设存在已归档事项「写周报」，且当前正在计时别的件事。
  - **idle**：后端 `find_by_name` 命中那条**归档**事项 → `timer::start(归档 id)` → 记录写进归档事项（`timer::start` 不校验 status）。
  - **计时中**（本轮新增路径）：`items` 里看不到归档事项 → 判定"无同名" → `item::create('写周报')` → **新建一条同名 active 事项**。
- **影响**
  1. 两种入口对同一件事落进**不同**事项，是用户原话「逻辑不一致」的原样复现；
  2. 破坏 `services/todo_start.rs` 头部明文写下的不变量「避免出现同名两个事项」 —— 该文件注释正是为了防这件事而存在的；
  3. 之后 `find_by_name` 取 `ORDER BY id ASC LIMIT 1`（min id，通常是那条归档的），而前端 `items.find` 取的是 `is_pinned DESC, sort_order ASC, id ASC` 的第一条 —— **连"取哪一条"的口径也不一致**，同名事项一旦存在，两条路径可能命中不同实体；
  4. 记录被劈到两个同名事项上，今日汇总/统计看起来"少了一段"。
- **建议**（择一，均为源码改动，我不改）
  - (a) 最小改：`startTodo` 非 idle 路径先 `itemApi.list({ includeArchived: true })` 再按名匹配，命中归档则提示「该事项已归档，先恢复或改名」（**推荐**，纯前端，不动 Rust）；
  - (b) 治本：后端补一个 `todo_start_or_switch(todo_id, mode)`，把"匹配 + 分支"整条逻辑收回一处，前端彻底不算；
  - (c) 兜底：`timer::start` / `switch` 对 `status='archived'` 直接报错，杜绝"归档事项还能被开计"。
- **可达性**：需要「同名事项已归档 + 计时器非 idle」两个条件同时成立。不是每条链路都会撞，但一旦撞上就是数据分裂，按 **P1** 计。

### P2（可延后）

| # | 文件:行号 | 现象 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| P2-1 | `ItemsPage.tsx:106-112` / `TodoRowMobile.tsx:72` | 空闲态「开始」没有 `busy` 闸，连点两下发两次 `todo_start`（探针 ⑦ 实测 `[[3],[3]]`） | 第二发必然 `TODO_NOT_FOUND`（`repositories/todo.rs:12-19` 排除软删），用户在**成功开始之后**收到「待办不存在」红条，像失败 | 加按 id 的 `pendingStart` 集合（或乐观把该行切 active）；`SwitchItemSheet` 已有同样闸（`SwitchItemSheet.tsx:42-43`），照抄即可 |
| P2-2 | `mobileTimerActions.ts:62-76` | running + `end_and_start`：`pause()` 成功、`switchItem()` 抛错 → **秒表停在暂停态**，无 `resume` 补偿（探针 ② 实测 `pause=1 / resume=0`） | 计时类应用里"秒表被静默停掉"是最贵的事故；提示只说"切不过去"，没说"顺便把你暂停了" | catch 里 `if (needPause) await timerApi.resume().catch(...)`；**注意这是本轮之前就有的行为**（diff 里 pause 段未改），桌面 `useTimerActions.startOrSwitch:148-155` 同一模式，可一并修 |
| P2-3 | `mobileTimerActions.ts:137-145` | `createAndSwitch` 建好事项后切换失败 → 孤儿事项，无回滚（探针 ⑤） | 事项列表多一条同名空事项；**可自愈**（重试时按名命中，不会二次新建），故 P2 | 失败时 `itemApi.remove(item.id)` 回滚（若事项 API 支持），或直接走 P1-1 的建议 (b) 一并消掉 |
| P2-4 | `ItemsPage.tsx:176` | `active` 是纯标题匹配，两条同名待办会**同时**显示「计时中」，且两行都没有可点的入口（探针 ⑥：2 个 live / 0 个按钮） | 用户无法区分哪条被消费了；另一条从此只能"完成"或"长按删除"，无法开始 | 后端 `todo_start` 已经软删了被消费的那条，另一条本可以保持按钮；建议把 active 判定改成"该标题对应的待办只剩 0 条时才全部标记"，或在前端按 `sortOrder` 只标记第一条并给另一条加"同名"提示 |
| P2-5 | `ItemsPage.tsx:176` + `TodoRowMobile.tsx:67-76` | 计时器**暂停**时，对应待办行也显示「计时中」，不显示「已暂停」也无法继续 | 用户从事项页看不出秒表是停的；恢复入口只剩计时页 | `active && status==='paused'` 时改文案「已暂停」或提供「继续」动作（`timerActions.togglePause` 现成） |
| P2-6 | `SwitchModeSheet.tsx:109` | 面板打开后计时被结束，正文仍写「现在有一条正在计时」 | 文案与事实不符（确认逻辑已安全回落，探针 ③ 证明功能没问题） | 面板订阅 `useTimerStore` 的 status，`idle` 时换成「没有正在计时，直接开始」并把分段隐藏 |
| P2-7 | `SwitchModeSheet.tsx:85-92` | 切换**失败也关面板**（`:91` 无条件 `closeSheet`） | 用户要重新找到那条待办再点一次；与 `SwitchItemSheet.create`（`:55-57` 仅 `ok` 才关）不一致 | 改成 `const ok = await startTodo(...); if (ok) closeSheet()` |
| P2-8 | `TodoRowMobile.tsx:69` | 「计时中」标记无 `role` / `aria-live`，状态变化不播报 | 读屏用户感知不到"这行已经进入计时"（能读到文本，但无主动播报） | `role="status"`（最小）或 `aria-label="正在计时"`；注意别加回 `role="button"` |
| P2-9 | `docs/mobile/DESIGN-ANDROID-V1.md:105,193` | 设计文档仍是旧口径（只有"待办开始后当场移出待办区"），未记载「计时中弹模式选单」「计时中静态标记」「已完成无开始」 | 下一个人按文档实现会退回旧行为 | 补 §4 ② 的三条新语义；顺带修文档既有的「左滑删」漂移（实际是长按删除） |
| P2-10 | `mobileTimerActions.ts:66-68` | `if (wasRunning && next.status === 'paused') await resume()` 在当前后端语义下**不可达**（`timer.rs:184-207`：`JustSwitch` 保留 running、`EndAndStart` 新开 running） | 死代码（AGENTS.md「不留死代码」）；留着也不会有害，但会让人误以为后端可能返回 paused | 若要删，需先确认没有别的 SwitchMode 分支；cargo 不可用，我只能推断，**不建议本轮动** |
| P2-11 | 工程师交付说明 | 12 个文件里 4 个行数与实际不符（见 §3.E） | 清单是中间态快照，说明"自述"不能当验收依据（这也正是本轮要我独立验证的理由） | 交付说明以 `wc -l` 实测为准 |

---

## 5. 无法验证项（不含糊，逐条列出）

| # | 项 | 为什么无法验证 |
| --- | --- | --- |
| 1 | `cargo test` / Rust 侧任何行为 | 本机缺 MSVC（`BuildTools/VC/` 为空），`cargo` 一律跑不了。本文所有后端结论均为**读源码推断**（已标到行号），未经执行 |
| 2 | 安卓 APK 构建、真机安装 | 无 Android SDK / NDK / JDK |
| 3 | 真机手感：44px 实际命中、长按 500ms 阈值、Sheet 下滑关闭 | 无设备。CSS 与代码层面已核对（§3.D1 / D4），触感不可推断 |
| 4 | Android 返回键关「待办选单」Sheet | 结构上自动纳入 `useMobileBackSheet(sheet != null)`（`MobileShell.tsx:92`），但 `useMobileBackSheet` **没有单测**，history/popstate 在 WebView 的真实表现必须装机 |
| 5 | 浏览器 `npm run dev` 跑待办区 | `src/mocks/browserMock.ts` 不覆盖 todo 相关命令，路径走不通（已知限制，未尝试） |
| 6 | 「结束并新开」旧的短线是否被 `should_ignore` 丢弃 | 后端 `timer.rs:198` 依 `min_record_sec` 设置，属 Rust 执行路径，无法实测；与桌面同口径，非本轮引入 |
| 7 | 多窗口 / md-sync 并发下 `items` 是否过期 | 手机侧单窗，非本轮范围；桌面并发不在用户诉求内 |

---

## 6. 路由判定

**→ Engineer**（只针对 **P1-1**）

- 判定依据：核心链路全部正确、门禁与 303 条测试全绿、待办在**所有**失败路径下都保住了（硬约束满足），
  所以**不是**回归级问题；但 P1-1 是**本轮新增路径引入的数据一致性缺陷**（同名两条事项 / 同一操作两种口径），
  属于源码层判断，我不改源码，交工程师评估。
- 建议措辞给工程师：**优先选 P1-1 的建议 (a)**（前端 `includeArchived: true` 匹配一次），
  纯前端、零 Rust 改动、不碰 IPC 契约（仍然 67/16/11），一个函数内可改完。
- **P2-1 / P2-2 / P2-7 建议同批顺手修**（都在同一两个文件，各 3~5 行）。
  若主理人认为本轮只交付主路径，则这些可整体降级为 Known Issues 记入 CHANGELOG，下一轮再收。
- **不需要 → QA**：本轮未发现测试代码自身的断言错误。工程师 4 个测试文件的断言我逐条复核过
  （`invocationCallOrder` 的顺序断言写法正确、失败路径断言方向正确），未做修改。
- QA 新增产出：`src/components/mobile/TodoStartEdges.test.tsx`（288 行 / 8 用例），
  已随 `npm run check`（`EXIT=0`）与 `npm test`（`EXIT=0`，39 文件 / 303 用例）验证通过。

---

## 附：本轮验证新增/改动文件

- 新增（QA）：`src/components/mobile/TodoStartEdges.test.tsx` —— 8 条边界探针，全绿
- 新增（QA）：`docs/mobile/VERIFY-TODO-TIMER-v0.5.0.md` —— 本报告
- **未改动任何源码**（`src/` 下源码、`src-tauri/`、`android-app/` 均零改动）
