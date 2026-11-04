# Timing v0.1.0 发布说明

- 发布日期：2026-11-04
- 版本：**0.1.0**（首个对外发布版；内部迭代号 0.4.1 与安卓 0.3.6 的合流）
- 契约：命令 **65** / 事件 **11** / 错误码 **16** —— 与内部 0.4.1 逐条一致，本版未新增或删除任何一条

---

## 1. 装哪个包

| 平台 | 文件 | 大小 | 说明 |
| --- | --- | --- | --- |
| Windows 10/11 x64 | `Timing_0.1.0_x64-setup.exe` | 2.41 MB | **推荐**。按用户安装到 `%LOCALAPPDATA%\Programs\Timing`，免管理员，带开始菜单 / 桌面快捷方式与卸载项 |
| Windows 10/11 x64 | `Timing-0.1.0-portable.exe` | 6.09 MB | 绿色版：直接双击运行，不写注册表 |
| Android 8.0+ | `Timing-android-0.1.0.apk` | 823 KB | 原生 Kotlin 版：系统级悬浮条 + 前台服务 + Obsidian 双向同步 |

SHA-256 前 16 位（完整值用 `certutil -hashfile <文件> SHA256` 复核）：

```
Timing_0.1.0_x64-setup.exe    8de655f81d8b509f...
Timing-0.1.0-portable.exe     e372b9d68d553cc3...
Timing-android-0.1.0.apk      33039569325d93ab...
```

安装包不写系统目录、不动注册表 HKLM：

- 程序目录：`%LOCALAPPDATA%\Programs\Timing\`（含 `plugins\md-sync`）
- 用户数据：`%APPDATA%\com.timing.app\`（`timing.db` / `logs` / `backups` / `.window-state.json`）
- **卸载只删程序，不删数据**——重装后记录与设置原样回来

## 2. 这一版做了什么

本版**不改业务代码**，只做四件事：

1. **两库合流**：以 `261102-Timing`（0.4.1，含原生安卓工程）为准，逐目录比对确认它是 `261017-Timing`（0.4.0）
   的**严格超集**——`src/`、`src-tauri/src/`、`plugins/`、`tests/` 的差异全部是前者新增或更新，
   没有任何文件只存在于旧库。`scripts/dev-desktop.cmd` 与五道门禁原样保留。
2. **版本重编号**：内部迭代号 `0.4.1`（桌面）/ `0.3.6`（安卓）统一为发布口径 `0.1.0`。
   桌面六处由 `npm run check:version` 断言；安卓 `versionCode` 9 → 10，可覆盖安装旧包。
3. **工程整理**：构建缓存（`target` 44 G / `node_modules` / `dist` / `.gradle` / `app/build`）、
   调试脚本与截图（`.workbuddy/`）、旧版 APK 全部不进发布目录；v0.2.0 与 v1 阶段文档归入
   `docs/archive/`，`docs/` 只留现行正本。
4. **出包链路**：新增 `scripts/installer/Timing.nsi` 与 `scripts/build-installer.cmd`，
   在 GitHub 不可达、`npm run tauri build` 拉不到 NSIS/WiX 的机器上也能产出安装包。

## 3. 验收记录（本机实跑）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 前端门禁 | `npm run check` | 全绿：契约 `65/65/65/65 · 16/16 · 11/11/emit 11`；size 412 文件；version 0.1.0；layers 7 条（369 文件）；lint 0 告警 |
| 前端测试 | `npm test` | **257 passed**（32 文件） |
| 后端测试 | `cargo test --offline` | **338 passed / 0 failed** |
| 桌面 Release 编译 | `cargo build --release --features custom-protocol` | 2 min 55 s，0 warning 输出 |
| 安装包编译 | `makensis -DAPP_ROOT=... -DAPP_VERSION=0.1.0` | 无 warning，产物 2.41 MB |
| 安装实测 | 安装器 `/S /D=<临时目录>` | 落盘正确：`Timing.exe` + `plugins\md-sync` + `uninstall.exe`，注册表与快捷方式齐全 |
| **真机启动（发布版）** | 直接跑 `release/Timing-0.1.0-portable.exe` 与安装后的 exe | 日志 `Timing v0.1.0 start` → `startup complete`，`first_frame=527ms`，0 ERROR / 0 WARN |
| 安卓编译 | `gradlew assembleRelease --offline` | BUILD SUCCESSFUL（31 s）；`aapt dump badging` → `com.timing.droid` / versionCode 10 / versionName 0.1.0 / minSdk 26 |

## 4. 已知限制（请当成未验证，不要当成没问题）

1. **卸载路径没有实测**：本机安全策略拦截了 `uninstall.exe` 的自我复制启动（NSIS 卸载器会把自己
   复制到 `%TEMP%` 再运行），所以「删文件 + 清注册表 + 删快捷方式」这段只做了代码审查，没有实跑。
   **请人工过一遍**：装 → 从「设置 → 应用」卸载 → 确认 `%LOCALAPPDATA%\Programs\Timing` 已消失、
   `%APPDATA%\com.timing.app` 仍在。
2. **没有 MSI**：`npm run tauri build` 的 WiX 与 NSIS 都要从 GitHub 下载，本机网络拉不到
   （`CONNECT tunnel failed, response 502`）。安装包改用标准 NSIS 3.04 自建，功能等价但没有 MSI。
   网络通的时候直接 `npm run tauri build` 就会额外产出 `Timing_0.1.0_x64_zh-CN.msi`。
3. **安卓包是 debug keystore 签名**：能装能跑，**不能上架**。换机器重装会因签名不同而冲突，需先卸载。
   正式分发请在 `android-app/app/build.gradle.kts` 加 `signingConfigs` 换成自备 keystore。
4. **安卓端仍未真机验证**：悬浮窗手势、通知栏按钮、SQLite 实际读写、SAF 目录授权都只有编译级证据，
   60 条 JVM 单测覆盖的是纯逻辑（状态机 / 时钟落库 / 天周计算 / 时间格式 / 区块解析 / 三方合并）。
5. **交互路径没有代跑**：计时 / 暂停 / 托盘菜单 / 便利贴都会写真实数据库，本机未替你点。
6. **WebView2 依赖**：安装器只检测不内嵌（原配置的 `embedBootstrapper` 需要联网下载
   `MicrosoftEdgeWebview2Setup.exe`）。Win11 与已更新的 Win10 自带；缺失时会弹提示。

## 5. 人工验收清单（15 分钟）

- [ ] 双击 `Timing_0.1.0_x64-setup.exe`：目录页默认指向 `%LOCALAPPDATA%\Programs\Timing`，可改；装完自动拉起
- [ ] 小条出现在屏幕边缘，显示 `00:00 | 新建事项`；点圆点开始正计时
- [ ] 右键数字唤起托盘/摸鱼菜单；倒计时设 30 秒，到点自动结束并写入记录
- [ ] 设置 → 同步：选一个 Markdown 目录，确认当天日记出现「事项计时」区块
- [ ] 设置 → 通用：开机自启开关生效（注册表 `HKCU\...\Run`）
- [ ] 关机重启：窗口回到上次位置
- [ ] 卸载：控制面板能卸载干净，数据保留
- [ ] 手机：`adb install -r Timing-android-0.1.0.apk` → 授权「显示在其他应用上层」→ 悬浮条出现 → 计时 → 记录页有数据

## 6. 回退

- 桌面：卸载 0.1.0 后装回 `261102-Timing/release/Timing.exe`（0.4.1 便携版）；
  数据库结构未变（迁移版本 v4），新旧版本可互相读写。
- 安卓：`adb uninstall com.timing.droid` 后装回 `261102-Timing/release/Timing-android-0.3.6.apk`。
  版本号从 0.1.0 回 0.3.6 属于降级，需先卸载（versionCode 10 > 9）。
