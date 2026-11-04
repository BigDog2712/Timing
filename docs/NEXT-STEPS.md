# 后续完善建议 · v0.1.0 之后

按「不解决就会挡住下一版」到「锦上添花」排序。每条都写了**现状证据**与**验收口径**，
可以直接拆成 issue（标签见 `docs/agents/triage-labels.md`）。

---

## P0 · 发布级阻断项（不做完不宜对外分发）

### 1. 签名：桌面 Authenticode + 安卓正式 keystore

- **现状**：安卓包用 `~/.android/debug.keystore`（口令 `android`）签名，`build.gradle.kts` 里
  `signingConfig = signingConfigs.getByName("debug")`，注释也写明「不能上架」。桌面 exe 完全未签名。
- **后果**：手机上换机重装会因签名冲突装不上；Windows 首次运行弹 SmartScreen「未知发布者」。
- **做法**：安卓自备 keystore（`keytool -genkey -v -keystore timing-release.jks -alias timing -validity 10000`），
  在 `build.gradle.kts` 加 `signingConfigs { create("release") { storeFile = file(System.getenv("TB_KEYSTORE")) … } }`，
  口令走环境变量或 `local.properties`（**不要入库**）；桌面买一张代码签名证书（或先用自签 + 内部分发说明）。
- **验收**：`apksigner verify --print-certs` 显示自家证书；`signtool verify /pa` 通过。

### 2. 卸载与交互的人工验收（本版唯一的真空档）

- **现状**：卸载脚本只做了代码审查（本机安全策略拦掉了卸载器自启）；计时 / 暂停 / 托盘 / 便利贴
  均未代跑（会写真实数据库）。
- **做法**：照 `RELEASE-NOTES-v0.1.0.md` §5 的 8 条清单走一遍，重点看「卸载后
  `%APPDATA%\com.timing.app` 仍在、`%LOCALAPPDATA%\Programs\Timing` 已清空」。
- **验收**：清单全勾，异常记到 issue。

### 3. 安卓端真机验收

- **现状**：`android-app/README.md` 自己写着「未做真机验证」，60 条单测只覆盖纯逻辑
  （状态机 / 时钟落库 / 天周计算 / 区块解析 / 三方合并）。
- **重点**：悬浮窗在 MIUI / HyperOS / ColorOS 上的「后台存活 + 悬浮权限 + 电池优化白名单」三件套，
  各家策略差异最大；通知栏三键（暂停 / 结束 / 打开）在锁屏下的可见性。
- **验收**：三台不同厂商机型各跑一天，记录被系统杀掉的次数与恢复行为。

### 4. 自动更新

- **现状**：没有 updater。发新版只能让用户手动下载重装。
- **建议**：`tauri-plugin-updater` + GitHub Releases（或自建静态 JSON）。桌面沿用 Tauri 那套；
  **安卓端只有原生 Kotlin 一套，Tauri 的 updater 用不上**，需要自己做「检查更新 → 下载 APK → 拉起安装」（约 150 行）。
  两端共用同一份静态 `version` 清单，避免两套发布逻辑。
- **验收**：装 0.1.0 → 发 0.1.1 → 应用内点「检查更新」能装上新版且数据不丢。

---

## P1 · 工程债（影响迭代速度，不影响本次可用）

### 5. 三份源码漂移（当前最大风险）

- **现状**：`261017-Timing`（0.4.0）、`261102-Timing`（0.4.1）、`261104-Timing`（0.1.0）三份同源工程并存。
  本轮已确认后者是前两者的严格超集，但下次改动只会在其中一份上发生。
- **建议**：`261104-Timing` 定为唯一主线并推到远端仓库；另两份降级为只读归档（或直接删除，
  历史已在 git 里）。`README` 顶部标注「唯一有效工程」。
- **验收**：`git remote -v` 指到正式仓库，另两份不再有提交。

### 6. 安卓端与桌面端的逻辑重复

- **现状**：计时状态机在 Rust（`src-tauri/src/services/timer.rs`）与 Kotlin（`TimerCore.kt`）各写一遍；
  共享的只有 `tests/fixtures/timer-formula.json` 这份黄金用例，但 **Kotlin 侧没有读它**。
- **做法**：让 android-app 的单测加载同一份 JSON（Gradle 里配 `sourceSets.test.resources.srcDirs += "../../tests/fixtures"`），
  双端跑同一组断言；再补 md 区块格式的用例（`MdSection` 与 `md_sync` 对同一段文本的解析结果应一致）。
- **验收**：改黄金用例的任一条，两端测试同时红。

### 7. CI 只覆盖了一半

- **现状**：`.github/workflows/ci.yml` 跑前端门禁与测试；后端 `cargo test` / `clippy` / `fmt`
  与安卓 `assembleRelease` 都没有自动化。
- **建议**：加两个 job——`backend`（windows-latest，`cargo test` + `clippy -D warnings` + `fmt --check`）、
  `android`（`setup-java 17` + `gradlew assembleDebug` + 上传 APK 为 artifact）。
- **验收**：PR 上三个 job 全绿才算过。

### 8. 依赖冲突导致 `npm ci` 失败

- **现状**：`@eslint/js@^10.0.1` 要求 `eslint@^10`，仓库钉的是 `eslint@^9.39.5`，`npm ci` 直接 `ERESOLVE`。
  本目录沿用了旧的 `node_modules` 才能跑。
- **建议**：二选一——升 `eslint` 到 10（连带 `typescript-eslint` 一起升），或把 `@eslint/js` 回到 `^9`。
  修完在 CI 里跑一次 `npm ci` 作为回归。
- **验收**：干净目录 `npm ci && npm run check` 通过，不再需要 `--legacy-peer-deps`。

### 9. 安卓代码没有体积门禁

- **现状**：前端/Rust 有「单文件 ≤300 行」的机械门禁，`android-app` 完全没有；`MainActivity.kt`
  这类文件容易长成巨型类。
- **建议**：给 `scripts/check-size.mjs` 加 `.kt` 分支（同一 300 行上限 + allowlist），
  顺手把已有超限文件列进 allowlist 带 `expires`。
- **验收**：故意把某个 .kt 写成 320 行，`npm run check:size` 变红。

---

## P2 · 产品功能（决定「愿不愿意天天用」）

### 10. 双端能力补齐

| 缺口 | 桌面 | 安卓 |
|---|---|---|
| 便利贴 | 有 | 无（窗口模型不同，建议做「便签页」而非悬浮） |
| 插件体系 | 有（v1 摸鱼预设 / v2 mdSync） | 无 |
| 四色主题自定义 | 有 | 只有深/浅 |
| 提醒铃 | 有 | 只有计时到点通知 |

建议顺序：**安卓补「提醒」→ 桌面补「记录导出」→ 安卓再谈便签**。插件不必移植。

### 11. 同步冲突太"暴力"

- **现状**：「冲突最后写入者胜」，被覆盖的那一份不落盘。
- **做法**：检测到双侧都改过时，把落败方写成 `<日期>.conflict-<时间戳>.md` 并在设置页列出来，
  给一个「保留哪个」的选择。改动集中在 `services/md_sync/`，不影响契约。
- **验收**：两端同时改同一条记录，能找回被覆盖的那一份。

### 12. 数据出口

- **现状**：只有 SQLite + `backups/` 目录，没有导出。换机、做月报、丢掉电脑都会疼。
- **建议**：设置里加「导出 CSV / JSON（全量或按日期区间）」，桌面与安卓各一个按钮；
  顺手加「导入」做校验后再落库。
- **验收**：导出 → 清库 → 导入 → 记录与总时长一致。

### 13. 记录页的「看趋势」

- **现状**：日 / 周视图有分布与明细，没有跨周对比。
- **建议**：周视图加「本周 vs 上周」同比条，月视图加事项占比堆叠。纯前端，不碰后端。

### 14. 首次运行引导

- **现状**：装完直接是一条 `00:00 | 新建事项`，新用户不知道右键能唤出菜单、不知道「最短记录时长」。
- **建议**：首次启动走 3 步（建第一个事项 / 试一次计时 / 选托盘还是自启），可跳过，
  状态存 `settings`（无需新表）。

### 15. i18n

- **现状**：界面文案全硬编码中文，`tauri.conf.json` 里 `nsis` 语言也未配。
- **建议**：抽 `src/i18n/zh-CN.ts` 一层（先只做中文，结构留好），后续加 `en-US` 只补文件。
  顺手把安装器语言段（现在是 SimpChinese + English 双语）与界面语言对齐。

---

## P3 · 维护性小项

16. **`versionCode` 手工对齐**：`check:version` 只查桌面六处，安卓的 `versionName` 靠人肉同步。
    给门禁加一条：读 `android-app/app/build.gradle.kts` 的 `versionName` 与 `package.json` 比对。
17. **`docs/phase2/` 名字已过时**（那是 v0.2 阶段的目录名，现在装的是全量契约）。
    建议 `git mv` 到 `docs/contract/`，同步改 `README` / `AGENTS.md` 的引用。
18. **产物校验和**：加 `scripts/checksums.cmd`，出包后自动生成 `release/SHA256SUMS.txt`，
    发布说明直接引用，避免手抄摘要（本轮就是手抄的）。
19. **离线安装的 WebView2**：`embedBootstrapper` 需要联网拉运行时。要覆盖内网机器就换成
    `offlineInstaller`（内嵌 ~130 MB 的 Evergreen Standalone），代价是安装包从 2.4 MB 涨到 ~130 MB。
20. **诊断包一键导出**：日志、`boot-timing.tsv`、库文件版本、系统信息打成一个 zip。
    安卓已有 `Crash.kt` 落盘，桌面有 `logs/`，缺的是「打包 + 展示路径」这十行。
