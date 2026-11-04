# 参考 Timing v1.7.3 → 本项目 功能对等验收矩阵

> 本矩阵是实现与验收边界，不把“存在入口”视为“1:1 完成”。状态：实现中；尚未完成逐项桌面实测。

## 当前已接入

- 悬浮条 Ring/Time/Task/Grip 基础左右键分区、拖动隔离、右键菜单、倒计时卡与常用事项入口。
- 今日事项摘要：按本地日期聚合计时、每日 pending/done 状态、行右键菜单、开始/切换/删除记录。
- 今日计时独立窗口、今日日记配置/打开入口、只读 Timer 窗口路由。
- 倒计时卡滚轮五分钟调整、持久化设定、运行中锁定；倒计时菜单仍需逐项桌面验收。
- 保存计时与同名未完成待办的事务联动；丢弃计时不删除待办；运行中禁止 EndAndStart。

## 仍需验收或存在差异

- 参考设置 DTO 与实际运行逻辑（TimerWindowEnabled、待办开关、自动落档等）需完成接线；设置页不能仅保存未消费字段。
- Task 任意状态右键、Grip 最新便利贴/最近五条、事项备注镜像、多屏/DPI 拖动尚未逐项桌面验收。
- 今日计时的逐行编辑模式、工作日期切换、日记导入与待办配置开关尚未证明等价。
- 参考主菜单的只读 Timer、今日日记、主题和托盘隐藏已接入口，但窗口同步、只读性、失败路径需实测。
- 参考的双击 Task、主条滚轮/键盘无副作用、320/420ms 离开收起、倒计时九档及分秒输入需实测。

## 验证记录

- `npm.cmd run typecheck`：通过。
- `npm.cmd run build`：通过。
- MSVC 环境 `cargo test`：168 passed；新增 `daily_status` 过滤测试：4 passed。
- 未操作真实鼠标；未启动参考 Timing 程序；未 push。

## 参考来源

`D:\101-Workshop\261015-Timing\Timingv1.7.3\src\ElioTimer.Ui\MainForm.cs`、`TodoDigestPanel.cs`、`TodoListPanel.cs`、`CountdownPanel.cs`。
