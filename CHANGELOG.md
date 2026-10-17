# Changelog

本文件记录本仓库的版本变更。版本语义 `MAJOR.MINOR.PATCH`，与 `src-tauri/tauri.conf.json` 的 `version` 同步。

## [0.2.8] — 2026-10-17

浮层身份收尾这一轮：所有浮层窗口都不再出现在任务栏，事项窗也跟随指针离开而隐藏。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **事项窗指针离开即隐藏**：新增 `src/hooks/useWindowLeaveHide.ts` 与 `WINDOW_LEAVE_HIDE_MS = 420`（`src/lib/constants.ts`），配合 `hideCurrentWindow()`（`src/lib/window.ts`）。在 `documentElement` 上听 `pointerleave` / `mouseleave` 起 420ms 计时，`pointerenter` / `mouseenter` 取消，到点 `hide()`——不销毁窗口，再点「事项窗口」立即原位显示，滚动位置与未提交的编辑都还在。**必须先「进来过」才允许「离开即收」**：窗口刚显示时指针往往不在它上面，否则会收到一个立刻触发的 `pointerleave` 让窗口一闪就没。

### 变更

- **设置窗与事项窗不再上任务栏**：`src-tauri/src/infra/window_spec.rs` 的 `SETTINGS.skip_taskbar` 与 `TODOS.skip_taskbar` 由 `false` 改 `true`（便利贴与主窗本来就是 `true`）。tao 的 `skip_taskbar` 走 `ITaskbarList::DeleteTab`（只能删已存在的按钮），窗口 `show()` 之后外壳可能把按钮加回来，所以 `showCurrentWindowOnReady()`（`src/lib/window.ts`）在显示后再对设置窗 / 事项窗补一次 `setSkipTaskbar(true)`（capability 增 `core:window:allow-set-skip-taskbar`）。至此 TickBar 的所有窗口都只在桌面上出现，任务栏里只留托盘图标。
- **便利贴不受影响**：仍是独立窗口，点圆点隐藏、拖右下角缩放；设置窗也不自动消失（编辑到一半不能丢）。

## [0.2.7] — 2026-10-17

浮层「指针离开即收」这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **指针离开浮层自动收起**：新增 `src/hooks/useHoverClose.ts` 与 `HOVER_CLOSE_GRACE_MS = 420`（`src/lib/constants.ts`）。挂在 `GlassMenu`（主菜单 / 事项菜单 / 倒计时菜单 / 常用事项 / 便利贴清单 / 事项窗内行菜单）、`ItemPicker`、`RecordsPanel`、`ReminderPopover`、`CountdownCustom` 上；判定容器为 `.pill, .menu, .panel, .records, .reminder, .note`——指针在这些容器上不计时，离开后 420ms 才收，期间回到任一容器立即取消。
- **便利贴不在其列**：便利贴是独立窗口（`note-{id}`，各有一份文档），结构上不会走到这段逻辑；点圆点隐藏、拖右下角缩放照旧。

### 变更

- 浮层不再「一直挂着等点外部」：从菜单移到桌面、移到别的窗口，浮层都会自己收掉；从小条拖窗（指针离开）时开着的浮层同样收起。
## [0.2.6] — 2026-10-17

悬浮条操作语义 1:1 对齐 Timing v1.7.3 这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

参照 `D:\101-Workshop\261015-Timing\Timingv1.7.3\src\ElioTimer.Ui\MainForm.cs`：`ZoneOf()`（1717-1738）把条面切成 圆环 / 时间 / 事项 / 手柄 / 空白 五个热区，`OnMouseUp()`（1846-1965）与 `OnRingLeft()`（3948）、`OnRingRight()`、`ToggleCountdownMode()`（4043）、`ShowCommonMenu()`（1975-2050）决定每个区左键/右键做什么。

### 新增

- **五个热区各自的手势**：圆环 / 时间数字 / 事项区 / 便利贴手柄 / 空白处，左键与右键都按参照表分派（`PillBar.tsx`、`MainButton.tsx` 的 `onMenu`、`TimerDisplay.tsx` 的 `onActivate`）。
- **时间数字左键 = 正计时 ⇄ 倒计时**：空闲态点时间切到«倒计时 · 第一档»（浮层提示），再点切回正计时；对位 `ToggleCountdownMode()`。
- **圆环左键计时中 = 先暂停、再摊开常用事项菜单**：对位 `OnRingLeft()` 的 `Pause` + `ShowCommonMenu()`；菜单本身已是 `name · 正计时 / 倒计时 N 分` +「其他事项…」，与参照同构。
- **圆环右键计时中 = 结束并保存**（空闲 = 主菜单）：对位 `OnRingRight()`。
- **主菜单重排**：前段对齐参照 `MenuRows()`（3293-3360）——便利贴清单、事项窗口、切到深色/浅色、设置…、隐藏到托盘；分隔后保留 TickBar 自己的计时动作（开始计时 / 结束并保存 / 倒计时… / 提醒… / 常用事项… / 新建事项… / 便利贴… / 微调开始时间 / 丢弃本次记录 / 保持置顶 / 收起为圆点）。
- **事项区右键 = 展开事项窗口**（参照 `Task → ToggleTodoPanel()`）；事项级菜单仍在窗内逐行给。
- **菜单内部滚动条收敛**：行数超过窗口高度时（主菜单 16 行）不再出现亮灰实心滚动条，改 8px `--line-3` 圆角细条。

### 变更

- `PillBar.handlePointerUp` 的右键兜底归一为「空白处 = 主菜单」，各热区由子组件的 `onMenu` 拦截（不再把右键一律当结束并保存）。

### 修复

- **便利贴聚焦时的蓝色边框**：`app.css` 的通用 `:where(button, input, select, [tabindex]):focus-visible { box-shadow: var(--focus-ring) }` 会给正文输入框套一圈 accent 蓝环，`note.css` 末尾显式清零（`outline: none; box-shadow: none`）。
## [0.2.5] — 2026-10-17

便利贴外形与倒计时口径这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **便利贴右下角缩放手柄**：`NoteWindow` 末尾 `.note__resize`（14×14，两道斜纹，悬停现形），按下即 `startResizeDragging('SouthEast')` 交给系统做 nwse 缩放；依赖新增 capability `core:window:allow-start-resize-dragging`，`src/lib/window.ts` 增 `startCurrentWindowResize()`（`ResizeDirection` 在 `@tauri-apps/api` 未导出，故按同构联合重声明 `ResizeDir`）。
- **倒计时「先设定、再开始」**：新增 `src/stores/countdownArm.ts`（`armedSec`，localStorage `tickbar.countdownArm.v1`）。`CountdownMenu` 点档位只**设定**时长（当前档位勾选），另加「开始倒计时」「改为正计时」两行；空闲且已设定时小条直接显示该时长（对位 Timing v1.7.3 的 `TimeText()` / `CountdownMenuRows()`），点圆环才真正开始倒数。

### 变更

- **便利贴圆点移入正文框**：`.note__head` 改绝对定位到 `.note__body` 右上角内侧（`top/right: var(--note-pad)`），不再独占一行高度。
- **便利贴正文框悬停显影**：显影选择器由 `.note:hover` 改为 `.note__body:hover, .note__body:focus-within`，只有鼠标进到文字框里才亮底板、才露出圆点与缩放手柄。
- **小条右键在计时中/暂停一律给事项菜单**：`PillBar.handlePointerUp` 不再把右键直接当「结束并保存」（事项名只有几十像素宽，右键常落在空白处，表现为「右键没菜单」）；结束与保存改为菜单里的显式点选。

## [0.2.4] — 2026-10-17

右键语义与小条手感这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **右键时间数字 = 倒计时菜单**：小条里的计时数字右击直接展开时长菜单（预设 + 自定义），不再被当成「结束并保存」。对位 Timing v1.7.3 的 `CountdownMenuRows()`（`MainForm.cs:4083-4120`）与时钟区触发热区（`TimeZoneScreenRect()`）。菜单锚点贴到小条下沿 +4px，不再盖住小条本身。
- **空闲态右键事项区也有事项菜单**：`NewItemEntry` 补上右键处理，空闲时右击「新建事项」同样弹出事项菜单（此前只有运行态的事项名绑了右键）。

### 变更

- **便利贴悬停恢复正文底板**：悬停 / 聚焦时 `.note__body` 浮出玻璃底板（`--note-body-bg`），外层 `.note` 仍保持零边框全透明。
- **长菜单内部滚动**：`.menu` 增加 `max-height: calc(100vh - 16px)` + `overflow-y: auto`，倒计时 8 行以上的菜单在小条 384×360 的窗口里不再被裁掉。

### 修复

- **右键菜单点一下关不掉**：小条窗口只有 384×360，`.menu-scrim` 覆盖不到窗口外的桌面，点到外面事件根本进不来。现监听窗口 `blur`（`src/main.tsx`），失焦即 `resetTransient()` 收起全部浮层。

## [0.2.3] — 2026-10-17

小条的「快捷添加」与「事项级菜单」这一轮。命令 / 事件 / 错误码零变更，零数据库迁移。

### 新增

- **事项菜单（右键事项名）**：`src/components/menu/ItemMenu.tsx`，结构对齐 Timing v1.7.3 的事项行菜单——开始·停止计时 / 编辑事项 / 开·关提醒 ｜ 新建便利贴 / 便利贴清单 ｜ 删除事项（两步确认，走软删除，历史记录保留）。系统事项的「开始计时」「删除事项」置灰。
- **小条内联命名**：`src/components/pill/InlineNameEntry.tsx`，事项名位置直接长出输入框，`Enter` 落地、`Esc` 放弃、失焦即取消；新建后立即开始计时（计时中则结束当前并切换）。
- **完整表单入口回收**：右键菜单新增「新建事项…」→ 原 `ItemPicker` 面板（选颜色等仍在）。

### 变更

- **左键事项 = 快捷添加**：idle 时点「新建事项」、运行中点事项名，都改为就地命名，不再弹出添加工单。
- **小条更靠左**：`.layer__stack` 左内缩由 `--snap-margin`(16px) 改为 `--pill-inset`(6px)，事项名与手柄整体左移 10px。
- **便利贴彻底无底板**：悬停 / 聚焦也不再显影底板与投影，只留文字 + 右上角两枚圆点（圆点仍随悬停出现）。
- **状态管理收敛**：`uiStore` 用一个 `CLOSED` 常量统一清空所有浮层（面板 / 菜单 / 倒计时 / 常用事项 / 便利贴清单 / 事项菜单 / 内联命名），避免新增浮层后漏清导致叠层。

## [0.2.2] — 2026-10-17

悬浮条与便利贴的一轮交互打磨。命令 / 事件 / 错误码零变更，零数据库迁移；`cargo test` 164 绿。

### 新增

- **便利贴清单浮层**：小条右侧手柄右键弹出当前事项的便利贴列表（按更新时间倒序，最多 8 条，空态一行提示，末尾「写一张新的…」）。见 `src/components/note/NotesListPopover.tsx`。
- **设置 · 外观不透明度**：新增「文字不透明度」「背景不透明度」两条滑杆（`src/components/ui/Slider.tsx`）。背景不透明度作用于小条、菜单、面板、快捷条、便利贴，设置面板与托盘菜单不参与；两项为本机偏好（`localStorage`，见 `src/stores/appearanceStore.ts`），不入数据库。
- **便利贴轻量 markdown 列表**：行首 `-` 按空格自动变成 `• `，`Enter` 续行继承缩进与圆点，`Tab` / `Shift+Tab` 对选中行做 2 空格缩进 / 反缩进。文本变换在 `src/lib/noteText.ts`（纯函数）。
- **构建脚本** `scripts/build-release.cmd`：加载 MSVC 环境 → 前端构建 → `cargo clean` + release 构建 → 复制到 `release\TickBar.exe`。

### 变更

- **小条手柄**：由「折叠」改为便利贴入口——左键打开（无则新建）当前事项的便利贴，右键弹出清单；折叠入口移到右键菜单「收起为圆点」。
- **小条拖动**：去掉 `data-tauri-drag-region`，改自绘指针拖动（4px 阈值 + 240ms 吞点击），拖动不再误触按钮。
- **小条排版**：内容由居中改左对齐贴齐；`+` 新建入口与「新建事项」合并为纯文字；计时数字与色环共用中心线、字号 20px → 18px、整体上移 1px。
- **收窄留白**：`--pill-pad-l/r`、事项名内边距压缩，idle 小条宽 188 → 175px。
- **便利贴零文字**：标题、页脚、关联事项、删除确认条全部移除，只剩正文框 + 右上角两枚圆点（红删除 / 黄隐藏）；删除为两步确认（3.5s 内二次点击生效）。
- **透明化**：小条底板与便利贴未悬停时背景全透明（只剩文字/圆点），悬停或聚焦才显影为玻璃板；文字浓淡不再随悬停变化，改由设置里的「文字不透明度」控制。
- **右键**：屏蔽 WebView2 原生右键菜单（捕获阶段 `preventDefault`），自绘菜单照常。

### 修复

- `src-tauri/Cargo.toml` 缺 `custom-protocol` 特性：release 版会去连 `http://localhost:1420` 导致白屏，补后走 `http://tauri.localhost/` 内嵌资源。
- `src/lib/window.ts::currentWindowKind()` 不认 `note` 这个 label（浏览器 dev 用 `?w=note`），便利贴路由落到主条。
- 运行态色环弧比轨道小一圈：`.ring__arc` 由 `inset:0` 改为居中 50% + 负 margin，两环同径同宽。

### 移除

- `src/components/pill/CollapseHandle.tsx`、`src/components/note/NoteConfirm.tsx`。

## [0.2.1] — 2026-10-17

仓库整理与升版。功能面与 0.2.0 一致（零命令 / 事件 / 错误码变更，零数据库迁移）。

### 变更

- **仓库结构**：应用源码从 `Timing_Rustv0.2.0/tickbar/` 平铺到仓库根（`src/`、`src-tauri/`、`package.json` 等），与既有 `docs/agents/` 合并成单一文档树。
- **版本号**：五处同步升到 `0.2.1` —— `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。此前三处填的是占位值 `1.0.0`，与产品版本号（V0.2.0）脱节。
- **文档归档**：v1 阶段文档（`Spec-v1` / `PRD-v1` / `ARCHITECTURE-v1` / `UIUX-v1` / `DESIGN.md` / `design/pages/*` / v1 令牌 / `schema.sql` / `QA-REPORT.md`）移入 `docs/archive/v1/`，现行 v0.2.0 文档留在原位。
- **`.gitignore` 重写**：原文件是 GBK 编码（UTF-8 下为乱码）且规则与布局不符（`**/target/` 未生效、产物路径缺失）。改为 UTF-8，按根布局覆盖 `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/schemas/`、`release/*.exe` 等。
- **文档内路径**：`tickbar/src/...` 一类旧前缀统一改为 `src/...`，与平铺后的布局一致。

### 移除（未纳入本仓库）

- `release/TickBar.exe`、`release/TickBar.new.exe`：构建产物；两者字节数相同（6,192,640 B），可重新构建。
- `src-tauri/gen/schemas/*.json`（`acl-manifests` / `desktop-schema` / `windows-schema`，共 375 KB）：Tauri 构建期生成，已入 `.gitignore`。
- `docs/design/_archive/`、`_ac53_*.mjs`、`_contrast_check.py`：一次性自检脚本。
- `.workbuddy/memory/`：团队工作记忆，不属于仓库内容（源目录仍保留）。

### 新增

- `README.md`：项目说明、技术栈、目录、开发 / 打包命令、文档索引。
- `CHANGELOG.md`：本文件。
- `docs/archive/v1/README.md`：归档说明与「归档 → 现行」对照表。

## [0.2.0] — 2026-10-16

批 2「重功能」+ 小条 UI 统一 + Timing 全面对齐优化轮。交付常用事项、倒计时、便利贴、提醒铃四组功能与托盘 IA 扩展；IPC 命令 29 → 52，事件 +6，错误码 +5；零新增迁移（`0002_v020.sql` 已前瞻建好）。QA verdict = PASS，`cargo test` 164 绿。详见 `docs/overview-V0.2.0.md`。
