## Timing v0.5.0 — 品牌归位

产品名由 **TickBar** 变更为 **Timing**。这是品牌归位，**数据格式与业务语义零变化**。

## Windows 用户：升级即用，数据自动迁移

首次启动会自动把 `%APPDATA%\com.tickbar.app` 下的全部数据迁移到 `%APPDATA%\com.timing.app`：

- 计时记录、事项、待办、便利贴
- 设置与主题
- 窗口位置
- 插件与日志

迁移是**复制，不是移动**：旧目录 `%APPDATA%\com.tickbar.app` 原样保留，确认无误后可手动删除。迁移结果可在 **设置 → 通用 → 数据来源** 查看，并可直接打开旧数据目录。

## 安卓用户：本轮无安卓产物

构建环境缺 Android SDK / NDK，**未构建、未验证**安卓包，因此本次 Release 不含任何 `.apk`。

包名将从 `com.tickbar.app` 变更为 `com.timing.app`，这意味着**从旧版升级必须卸载重装**（应用内数据会随之清除，请自行备份）。完整说明见仓库 `docs/rename-v0.5.0/PRD.md` §5。

## 接口口径

**命令 65 → 67**（新增 `get_migration_info` / `open_legacy_dir`，用于设置页显示数据来源与打开旧数据目录）；**事件 11 / 错误码 16 / DB schema v4 全部不变**。

## 变更明细

- **品牌层**：显示名、安装产物名、主窗口与 4 个子窗口标题、托盘提示、诊断标题
- **标识符**
  - identifier `com.tickbar.app` → `com.timing.app`
  - 数据库 `tickbar.db` → `timing.db`（WAL 侧 `-wal` / `-shm` 一并搬迁）
  - 日志 `tickbar-YYYY-MM-DD.log` → `timing-YYYY-MM-DD.log`
  - 环境变量 `TICKBAR_LOG` → `TIMING_LOG`（旧名仍回落生效并打 WARN）
  - 5 个 localStorage 键（新键优先，回落老键并回写）
- **安卓**：包名 `com.timing.app`、主题名 `Theme.timing`、Kotlin 源码包目录搬迁
- **手机端**：待办可直接开始计时；计时中点另一条会弹出「结束并新开 / 仅改归属」；已完成待办不再显示无效的开始按钮

## 安装形态

本轮**仅提供绿色单文件 exe**（`Timing.exe`），未提供 `.msi` / NSIS 安装包——打包器需要联网下载 NSIS 工具链，构建环境网络不可达。解压即用，双击启动。

## 校验和

附件 `SHA256SUMS.txt`。`Timing.exe` 的 sha256 前 8 位：`418b9b4c`

## 已知代价

- 旧 TickBar 与 Timing 可并存（Windows 安装目录不同），**建议先卸载旧版**再安装 Timing
- 安卓需卸载重装（本轮不涉及，无安卓产物）

## 回滚

如遇问题：卸载 Timing，装回 TickBar 0.4.1。数据仍完整保存在 `%APPDATA%\com.tickbar.app`，因为迁移只复制、未移动。

---

首个发布（此前无 tag）。
