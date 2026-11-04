# Timing v0.1.1 发布说明

- 发布日期：2026-11-04
- 版本：**0.1.1**（0.1.0 之后的第一轮功能迭代）
- 产品名：**Timing**（原名 TickBar，本版起全面统一）
- 契约：命令 **68** / 事件 **11** / 错误码 **16**（0.1.0 是 65 / 11 / 16；本版新增 3 条命令，事件与错误码未动）

---

## 0. 改名说明（TickBar → Timing）

代码、安装包、进程名、数据目录、安卓包名统一改为 **Timing**，没有功能变化，
但**数据会搬家**，先看这一节再装：

| 项 | 原名 | 新名 |
| --- | --- | --- |
| 显示名 / 进程 | `TickBar` | `Timing` |
| 数据目录 | `%APPDATA%\com.tickbar.app` | `%APPDATA%\com.timing.app` |
| 数据库文件 | `tickbar.db` | `timing.db` |
| 安卓包名 | `com.tickbar.droid` | `com.timing.droid` |
| Rust crate | `tickbar` / `tickbar_lib` | `timing` / `timing_lib` |

**桌面端会自动搬家**：启动时若新目录还没有库、旧目录存在，就把旧目录整份复制过来
（含 `timing.db` 的 `-wal` / `-shm`、`plugins/`、`backups/`、窗口位置），
再把 `tickbar.db` 改名成 `timing.db`。**旧目录不删**，确认没问题后可自行清理。
已在用新名字的机器不会被覆盖（判据是新目录里已有 `timing.db`）。

两处不会自动跟着走的：

- **开机自启**：旧的 Run 项名是 `TickBar`，指向旧 exe。装新版后到设置里把自启关一次再打开即可，
  或手动删 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\TickBar`。
- **安卓端**：包名变了，系统把它当另一个应用，旧数据读不到。需要旧数据请先卸载前导出，
  或者继续用 `0.1.0` 的 APK。

主题（深/浅色）会从旧键 `tickbar.theme` 自动读一次，不用重设。

## 1. 装哪个包

| 平台 | 文件 | 状态 | 说明 |
| --- | --- | --- | --- |
| Windows 10/11 x64 | `release/Timing-0.1.1-portable.exe` | ✅ 已产出 6.17 MB | 绿色版：双击即用，不写注册表 |
| Windows 10/11 x64 | `release/Timing_0.1.1_x64-setup.exe` | ⚠️ 待出包 | NSIS 安装器。本机 `tauri build --bundles nsis` 下载 NSIS 失败（GitHub 502），未装 makensis |
| Android 8.0+ | `release/Timing-android-0.1.1.apk` | ⚠️ 待出包 | 本机无 Android SDK / JDK，未编译。代码已改成 0.1.1 / versionCode 11 |

```
Timing-0.1.1-portable.exe    SHA-256  7022a60f686e4793976e1cfff13101a8cebe5dada8e0d51435e0067d72c3b673
```

覆盖安装/替换旧版即可：数据库结构未变（迁移版本 v4），0.1.0 与 0.1.1 可互相读写。

## 2. 这一版做了什么

本轮两条主线加一条目录调整，都是「让插件这个词名副其实」。

1. **Markdown 同步不再是插件**（ADR-036）。它要读写任意路径、后台定时、写库，属于特权能力，
   不该由插件当配置携带者。三条落点搬回宿主 `services/md_sync/config.rs` 的 `default_bindings()`，
   `plugins/md-sync/` 目录移除。**已保存的落点照旧优先，老用户不用重配。**
2. **插件补上真正的扩展面**（ADR-037，`apiVersion` 3）。原先插件只能往摸鱼菜单填预设项，
   现在可以声明一扇独立窗口：`contributes.panels` 里写 `text` / `stats` / `list` / `actions` 四种块，
   数据来自宿主白名单（`records.byItem` / `todos.pending`），按钮调白名单动作
   （`timer.start` / `timer.pause` / `todo.add` / `note.create`）。**插件仍然不执行任何代码。**
3. **插件目录移到程序旁边**（ADR-038）。用户插件目录从 `%APPDATA%\com.timing.app\plugins`
   改成 **exe 同级 `plugins/`**：绿色版解压到哪、插件就跟到哪，换机器拷一个文件夹就够。
   设置页路径、`docs/plugin-spec.md` §2 的来源表、安装器都跟着改了。

## 3. 验收记录（本机实跑）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 前端门禁 | `npm run check` | 全绿：契约 `68/68/68/68 · 16/16 · 11/11/emit 11`；size 425 文件；version 0.1.1；layers 7 条（381 文件）；lint 0 告警 |
| 前端测试 | `npm test` | **270 passed**（34 文件） |
| 后端测试 | `cargo test` | **364 passed / 0 failed** |
| 后端静态检查 | `cargo clippy --all-targets` | 0 warning |
| 桌面 Release 编译 | `cargo build --release --features custom-protocol` | 2 min 15 s，产物 `timing.exe` 6.17 MB |
| 插件目录 | `cargo test plugin_fs` | `user_plugin_dir_sits_next_to_the_exe` / `scan_roots_does_not_scan_the_same_dir_twice` 两条新用例通过 |
| 启动冒烟 | 直接跑 `release/Timing-0.1.1-portable.exe` | `Timing v0.1.1 start` → `startup complete` → `boot[first_frame] first_frame=595ms`，窗口正常 |
| 旧数据迁移 | 同上（本机旧目录里有 81920 字节的 `tickbar.db`） | 日志 `legacy data adopted: com.tickbar.app -> com.timing.app`；新库待办 8 / 便利贴 20 / 事项 18，与旧库逐个对齐 |
| 安装包 | `tauri build --bundles nsis` | **失败**：`Downloading nsis-3.13.zip` → `io: unexpected end of file`（网络） |
| 安卓编译 | `gradlew assembleDebug` | **未跑**：本机无 `ANDROID_HOME` / `java` |

> **一个必须记住的坑**：`cargo build --release` **不带 `--features custom-protocol`** 时，
> 二进制会去连 `devUrl`（`http://localhost:1420`），脱离 dev server 就是白窗 + Edge 的
> 「嗯… 无法访问此页面」，日志里也只有 `startup complete`、**没有 `boot[first_frame]`**。
> 本版第一次出包就踩了这个坑：`scripts/build-release.cmd` / `build-installer.cmd` 里都写对了特性，
> 手动敲命令时漏了。判断包好没好，看日志有没有 `boot[first_frame]` 这一行即可。

## 4. 已知限制

1. **只有绿色版**。安装器与安卓包没出，见 §1。要出包时：桌面用 `scripts/build-installer.cmd`
   （需 `makensis` 在 PATH 或 `MAKENSIS` 环境变量），安卓用 `gradlew assembleDebug`。
2. **插件面板无状态**：没有插件私有存储区，数据块每次打开重查、不缓存，面板之间不能跳转。
3. **手机端不显示面板入口**，安卓端也没有插件机制（手机上没有 `plugin.json` 扫描）。
4. **插件能力只到「读统计 + 触发内置动作」**，不能自定义样式、不能联网、不能读写文件。
5. **交互未代跑**：计时 / 面板按钮 / 托盘都会写真实数据库，本机没替你点。
6. **安卓端仍未真机验证**，与 0.1.0 相同。
7. **插件目录要可写**：装在 `C:\Program Files` 这类受保护目录时，「打开目录」会报错。
   换绿色版，或给该目录写权限——不会静默退回 `%APPDATA%`（那等于又把目录搬回去了）。
8. **卸载会删掉插件**：`plugins/` 现在在程序目录里，NSIS 卸载会 `RMDir /r` 整个目录。
   自己写的插件请先备份。

## 5. 人工验收清单（10 分钟）

- [ ] 跑 `release/Timing-0.1.1-portable.exe`，小条正常出现，日志首行是 `Timing v0.1.1 start`
- [ ] 设置 → 同步：落点还在（0.1.0 配过的路径不应丢），手动「立即同步」能写进当天日记
- [ ] 设置 → 插件：列表里不再有「Markdown 同步」这一项（它现在是内建功能）
- [ ] 设置 → 插件：顶上显示的路径是**exe 同级**的 `...\plugins`，不是 `%APPDATA%`
- [ ] 在 `release\plugins\weekly-board\plugin.json` 放一个面板插件（见下），点「重新加载」
- [ ] 插件行出现「打开」按钮，点开窗口能看到排行与按钮；点「开始摸鱼」后主界面开始计时
- [ ] 故意把 `source` 改成 `records.unknown`，重新加载 → 插件显示加载失败并列出可用数据源

最小面板插件：

```json
{
  "id": "weekly-board",
  "name": "本周看板",
  "version": "1.0.0",
  "apiVersion": 3,
  "contributes": {
    "panels": [{
      "id": "weekly",
      "title": "本周概览",
      "blocks": [
        { "type": "text", "text": "最近 7 天各事项投入。" },
        { "type": "stats", "source": "records.byItem", "label": "各事项", "params": { "days": 7 } },
        { "type": "actions", "items": [
          { "label": "开始摸鱼", "action": "timer.start", "params": { "item": "摸鱼" } }
        ]}
      ]
    }]
  }
}
```

## 6. 回退

- 桌面：换回 `release/Timing-0.1.0-portable.exe` 即可。数据库未变，配置未变；
  0.1.0 里 Markdown 同步的落点存在 `settings` KV，0.1.1 读的还是同一份。
- 安卓：仍装 `release/Timing-android-0.1.0.apk`（本版没出新包）。
