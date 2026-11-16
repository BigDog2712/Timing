# Timing 工程评审报告

- 评审日期：2026-11-16
- 目标版本：桌面 0.12.3 / 移动端 0.12.9（版本真源见 `scripts/platform-versions.json`）
- 评审范围：数据模型与迁移、同步/离线、计时与提醒核心链路、Android 使用统计、隐私安全、架构维护、性能、测试、CI 与发布
- 方法：静态代码检查、项目文档核对、并行专项代码审查、前端全量门禁与测试、事件流 Rust 定向测试
- 结论等级：有条件通过内部迭代；在修复下列 P1 前，不建议把跨设备同步称为高可靠或依赖其保护唯一数据副本。

## 结论摘要

Timing 的工程基础较扎实：Rust 与 React/TypeScript 分层清楚，业务库使用 SQLite，迁移与 IPC 契约受门禁保护；事件流有稳定 UID、设备维度、JSONL 分段、重复事件去重、失败停游标等设计。计时状态由 Rust 持有，提醒为查询式调度，源码也包含迁移、备份与凭据保护用例。

当前主要风险集中在同步失败边界和暂停倒计时语义：分片可能被部分写入后当作成功处理；事件已写入但物化失败时，重试可能跳过重新折叠；倒计时暂停期间仍被算入计划结束时间。这些会造成记录缺失、历史状态错误或日期归属错误，优先级高于代码风格与包体积优化。

## 发现

### P1 - 分片部分写入可能被当成完整成功并永久跳过

`Transport::Folder::put_if_absent` 先检查最终目标是否存在，之后直接 `std::fs::write` 到最终路径，没有临时文件与原子 rename。在共享文件夹/同步盘场景，若进程或设备在写入过程中退出，另一端可读到空文件或已写出的有效 JSONL 前缀。`decode_segment` 对空白行/空内容返回成功；pull 只要解码与应用返回成功，就推进 `last_seq`。序号推进后，缺失的事件不会再被拉取。WebDAV 分段也缺少应用层事件数/校验和校验，不能依赖传输端必然原子写入。

证据：[transport.rs:26](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/transport.rs:26)、[segment.rs:74](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/segment.rs:74)、[pull.rs:59](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/pull.rs:59)。同步编排实际调用该路径：[round_folder.rs:75](/D:/101-Workshop/261116-Timing/src-tauri/src/services/md_cloud/round_folder.rs:75)、[round_webdav.rs:114](/D:/101-Workshop/261116-Timing/src-tauri/src/services/md_cloud/round_webdav.rs:114)。

建议：本地分片写入临时文件，完整写入并 flush 后再原子 rename；格式增加可验证的事件数和校验值，拒绝空分段及缺少完整性标记的分段。补充在写入中断、空文件、有效前缀截断等故障注入测试，断言游标不前进。

### P1 - 远端事件部分应用后失败，重试可能留下陈旧 time_records

`apply_and_fold` 逐条插入 `timer_ops`，仅在插入新行时将会话标为 dirty；后续才读取全部会话并物化到 `time_records`。整个应用/物化过程没有共用一个数据库事务。若部分事件或物化写入后发生数据库错误，pull 会保留旧游标并重试；但 UID 冲突使已插入事件 `rows_affected=0`，不会再次标记对应会话 dirty。重试可能返回成功、推进游标，却没有重新折叠此前部分应用的会话。

证据：[apply.rs:17](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/apply.rs:17)、[apply.rs:30](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/apply.rs:30)、[apply.rs:80](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/apply.rs:80)、[pull.rs:69](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/pull.rs:69)、[pull.rs:96](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/pull.rs:96)。

建议：将一段的事件 upsert、折叠、物化与游标推进置于同一事务；或使应用流程对重复事件也能重新折叠相应会话。用 SQLite 触发器/约束故障注入，验证事务回滚后重试可以收敛。

### P1 - 倒计时暂停后结束时间早于真实到点时刻

倒计时 tick 用 `timer::live_duration` 判定是否到点，但实际结束时间固定为 `active.started_at + target_sec * 1000`。暂停时间不会计入 live duration，却仍被这个绝对结束时间隐含排除，造成两套时间口径不一致。运行 30 秒、暂停一小时、恢复运行 30 秒的 60 秒倒计时，会在检测到到点后按开始后一分种落档，而不是恢复后一分种；若跨日，记录结束时间/拆分日期可能错误。

证据：[countdown.rs:93](/D:/101-Workshop/261116-Timing/src-tauri/src/services/countdown.rs:93)、[countdown.rs:103](/D:/101-Workshop/261116-Timing/src-tauri/src/services/countdown.rs:103)、[timer_split.rs:107](/D:/101-Workshop/261116-Timing/src-tauri/src/services/timer_split.rs:107)。现有到点测试只回拨连续运行记录，未覆盖暂停恢复：[countdown.rs tests:100](/D:/101-Workshop/261116-Timing/src-tauri/src/tests/countdown.rs:100)。

建议：以累计的运行区间确定实际语义结束时刻，或维护会随暂停/恢复调整的倒计时 deadline；增加暂停、长暂停、跨午夜与系统休眠组合测试。

### P1 - 隐私承诺与可选网络功能相矛盾

README 英文称“100% local … no network calls”，中文称运行期间“不产生一个网络请求”；同一 README 又提供 Markdown/WebDAV 同步。实现中已有 WebDAV GET/PUT，Android manifest 声明 INTERNET。用户可能据此误以为启用同步后数据仍完全不出设备。

证据：[README.md:26](/D:/101-Workshop/261116-Timing/README.md:26)、[README.md:54](/D:/101-Workshop/261116-Timing/README.md:54)、[README.md:71](/D:/101-Workshop/261116-Timing/README.md:71)、[mod.rs:137](/D:/101-Workshop/261116-Timing/src-tauri/src/infra/md_webdav/mod.rs:137)、[AndroidManifest.xml:4](/D:/101-Workshop/261116-Timing/src-tauri/gen/android/app/src/main/AndroidManifest.xml:4)。

建议：改为准确区分“默认本地、无遥测”和“用户显式配置同步后向所选落点传输”；列出各同步通道传输的数据类别、明文/加密边界、关闭及删除方法。特别明确应用使用追踪的数据不会因开启计时记录同步而意外外传。

### P2 - WebDAV 设备目录名未按设备 ID 约束验证

PROPFIND XML 的 href 被百分号解码并取末段作为子项名；pull 将所有非本机名称作为 peer，直接插入分片路径。正常信任的 WebDAV 服务上不容易触发，但异常/恶意目录名中的 `?`、`#` 等可按 URL query/fragment 语义解释，造成该 peer 不可读取或同步循环受阻。

证据：[stream.rs:97](/D:/101-Workshop/261116-Timing/src-tauri/src/infra/md_webdav/stream.rs:97)、[pull.rs:33](/D:/101-Workshop/261116-Timing/src-tauri/src/services/sync_stream/pull.rs:33)、[mod.rs:110](/D:/101-Workshop/261116-Timing/src-tauri/src/infra/md_webdav/mod.rs:110)。

建议：仅接受与设备身份格式一致的 12 位小写十六进制名称；对非法子项记录可见、可诊断的同步错误，并继续处理其他有效 peer。

### P2 - Android 使用统计存在静默事件数量上限

Android 原生使用统计每次最多读取 20,000 个事件，循环到上限后仍把当前打开的活动区间关闭到窗口结束，并将聚合结果照常返回/落库，没有 `truncated` 信号。极重度使用或较大查询范围可能产生不完整统计，但界面会呈现为完整结果。

证据：[UsageStats.kt:65](/D:/101-Workshop/261116-Timing/src-tauri/gen/android/app/src/main/java/com/timing/app/native/UsageStats.kt:65)、[UsageStats.kt:201](/D:/101-Workshop/261116-Timing/src-tauri/gen/android/app/src/main/java/com/timing/app/native/UsageStats.kt:201)、[usage_cmd.rs:68](/D:/101-Workshop/261116-Timing/src-tauri/src/commands/usage_cmd.rs:68)。

建议：分段/分页读取事件，或显式返回截断状态并避免把不完整聚合覆盖为权威日数据；添加达到上限及跨窗口续读测试。

### P2 - 全量 Rust 测试存在 Windows 稳定性失败

专项审查报告称全量 `cargo test --manifest-path src-tauri/Cargo.toml` 两次均以 1981 passed / 1 failed / 17 ignored 结束，但两次失败在不同用例：并行运行时 `scheduled_export::tests::sqlite_validation_rejects_selected_field_schema_drift` 清理 SQLite 文件遇到 Windows OS error 32（文件占用）；串行运行时 `infra::activity::web_activity_bridge::tests::retrying_listener_recovers_without_runtime_restart` 在 500ms 超时内未恢复。该证据说明测试套件有 Windows 文件句柄/时序敏感性，尚不能据此断定任一根因。

证据：[scheduled_export.rs:1092](/D:/101-Workshop/261116-Timing/src-tauri/src/services/activity/data/scheduled_export.rs:1092)、[scheduled_export.rs:1094](/D:/101-Workshop/261116-Timing/src-tauri/src/services/activity/data/scheduled_export.rs:1094)、[web_activity_bridge.rs:583](/D:/101-Workshop/261116-Timing/src-tauri/src/infra/activity/web_activity_bridge.rs:583)、[ci.yml:134](/D:/101-Workshop/261116-Timing/.github/workflows/ci.yml:134)。CI 当前以默认并行度运行完整 cargo test。

建议：修复并发测试对 SQLite 文件关闭/删除的竞态；对 500ms 恢复断言改用可控时钟、同步屏障或有依据的超时预算。将全量 Rust 测试在 CI 的重试/多次运行结果纳入观测，确保不是通过盲目加大超时掩盖问题。

### P2 - Android 原生使用统计缺少自动化验证

未发现与 Kotlin `UsageStats` 对应的 `src/test` 或 `androidTest` 覆盖；当前 CI 的后端测试是桌面 Windows cargo test，没有 Android Gradle build 或设备/模拟器测试。Rust rollup 测试不能覆盖 Kotlin 事件配对、20,000 事件上限、UsageStats 权限状态及 NativeBridge 序列化。

建议：把 Activity event parsing 与区间合并抽为纯 Kotlin 单元可测逻辑，至少覆盖 RESUMED/PAUSED 配对、锁屏收段、重复/缺失事件、上限截断；CI 增加 Android 编译与 JVM 单测，真机发布验收覆盖权限与后台行为。

### P2 - 发布链尚未形成当前版本的自动可复现交付

CI workflow 仅对 master push 与 PR 运行；没有 tag/release 发布 job，也未见 Android 构建、签名、制品校验和 provenance 流水。README 明确写当前主线 0.12.3 尚未出包，最近桌面包为 0.12.1。构建脚本支持生成构建身份、版本门禁和 Android 签名，但仍主要依赖人工执行。

证据：[ci.yml:3](/D:/101-Workshop/261116-Timing/.github/workflows/ci.yml:3)、[android-apk.mjs:233](/D:/101-Workshop/261116-Timing/scripts/android-apk.mjs:233)、[README.md:104](/D:/101-Workshop/261116-Timing/README.md:104)。

建议：建立受保护 tag 驱动的发布流水，固定工具链与依赖、构建并签名产物、发布校验和与构建身份，增加升级/回滚和数据库迁移恢复演练。若暂不自动发布，至少建立受控的人工发布清单及制品验证记录。

### P2 - 性能有体积信号，缺端到端基准

生产构建可成功，分析窗主 JS chunk 为约 637 KB（gzip 约 190 KB），分析窗 CSS 约 274 KB（gzip 约 41 KB）。当前有代码分块，但没有本轮可核实的冷启动、首屏、长历史数据量或低端 Android 指标，因此这只是需测量的风险，不据此判定已有性能缺陷。

建议：定义桌面/Android 首屏和冷启动预算；用真实或合成的 1 年/多年活动数据测量查询、趋势计算、渲染；将性能基准纳入发布验收。

## 评审维度

### 数据结构与架构可维护性

正向：宿主 `timing.db` 与活动统计库分别维护；版本化迁移、UID/设备维度、按层依赖约束与 IPC 契约门禁明确；核心 timer 状态归 Rust；Rust/前端存在单测和共享时间公式用例。

风险：`timer_ops` 与 `time_records` 是事件事实和物化读模型两套状态，必须保证原子应用及可重建能力。单文件 ≤300 行冻结基线仍有 136 条豁免，超限文件约占源码行数 26%；尺寸棘轮能防继续恶化，但维护负担尚未消除。建议优先降低生产路径中关键聚合模块的复杂度，而非为满足行数做机械拆分。

迁移检查：当前活动库迁移注册表与业务库迁移编号在已检查范围内未见碰撞；`npm run check` 中版本与契约门禁通过。

### 同步、离线与一致性

优点：同步关闭时可保持本地可用；文件/WebDAV 通道、事件 JSONL、UID 去重、游标与错误状态已有实现；坏分段设计意图是停止游标并重试。`sync_stream` 现有测试覆盖 push/pull、重复拉取、事件完整性常见路径。

缺口：本报告 P1 #1/#2 说明完整性不变量没有覆盖部分写入及部分数据库应用故障；同一轮还运行 Markdown 快照同步，用户界面需明确它与事件流在语义上的关系。建议增加同步状态中心：最近成功时间、待处理 peer/分段、永久失败/暂缓状态、手动重试和导出诊断信息。

对照成熟产品：Todoist 官方说明离线期间允许新增/修改/删除任务，并在恢复连接后自动同步；Toggl Track Windows 桌面端说明本地保存、联网后发送，并对未同步条目提供显式标志及手动同步入口。Timing 的同步底层方向合理，但应补齐可观测性与恢复 UX，不能只依赖后台日志。

### 跨端体验一致性

当前 Android 原生 Kotlin 工程已归档；活动移动端来自 Tauri/mobile 路径，而非 Android Kotlin 源码继续与桌面同步演进。桌面依赖 Win32 悬浮条、托盘与窗口几何；手机有自身导航、权限和后台限制。应将产品定位为“业务规则部分共享、平台交互专属”，并定义跨端契约矩阵：开始/暂停/恢复/结束、切换事项、跨日、休眠唤醒、提醒授权、同步配置、数据库升级。

活动统计只在 Android 有系统 UsageStats 能力；桌面 `usage_stats_get` 明确返回 unsupported。应用标题/进程采集的隐私边界需要产品层清楚呈现。

### 安全与数据隐私

正向：前端没有 SQL/Store 直连能力；CSP 配置存在；WebDAV 认证使用 Basic Auth API，Debug 输出隐藏密码，URL userinfo 被拒绝或清洗；备份凭据使用平台安全存储路径。

待补：README 的网络声明必须修正；对用户数据外发通道做完整清单，区分 Markdown 记录、应用使用统计、诊断与远程备份；验证 TLS 失败、证书更新、凭据轮换及删除行为。WebDAV 同步内容可由用户自己的远端服务读取，不能把“HTTPS”描述为端到端加密。

### 测试与发布运维

本轮验证：

- `npm run check`：通过，包含类型检查、Vite 生产构建、契约/版本/分层/尺寸/品牌等门禁、ESLint 与 Vitest。
- Vitest：249 个测试文件、1933 条测试通过。
- Rust `services::sync_stream` 定向测试：13 条通过。
- 构建产物：Vite 转换 2760 个模块，分析窗主 chunk gzip 约 190 KB。

测试输出出现部分 IPC mock 错误日志与 React `act(...)` 警告；用例通过，但建议治理噪声，以免真实失败被淹没。没有运行完整 `cargo test`、真机 Android 测试、真实 WebDAV 服务端互操作、跨时区/夏令时矩阵或发布安装升级测试；不能据本轮结果声称这些路径已验证。

建议发布前最低门槛：全量 `cargo test` 与 clippy；桌面安装/覆盖升级/卸载保留数据测试；Android 真机通知与后台/UsageStats 权限测试；WebDAV 断网、429、412、半写、重试、换设备恢复演练；备份损坏与迁移回滚演练；校验发布包版本、签名、SHA-256、构建 commit 和 dirty 状态。

## 建议修复顺序

1. 修复同步分片原子发布与完整性校验；验证空/截断分段永不推进游标。
2. 将事件应用、物化和游标推进事务化，添加中途 SQL 故障注入/重试收敛测试。
3. 修复倒计时暂停/恢复语义，覆盖跨日及休眠场景。
4. 对 peer ID 做严格格式校验，非法项不影响其他设备同步。
5. 修正文案并补隐私/数据流说明；确认应用追踪数据不会通过未预期的同步路径外传。
6. 处理 Android 事件截断并给 UI 可见状态。
7. 增加端到端性能基准、真实 WebDAV 互操作、桌面/Android 发布与升级验证。

## 处置记录（2026-11-16 同日）

四条 P1 全部已修，两条 P2 已修，其余三条 P2 属基础设施/测量，未做（理由见下）。核心判断：**P1 #1 / #2 与倒计时那条是同一个形状——失败被当成成功**，所以三者的判据都写成「故障注入 → 必须报错且不推进 / 不落档」。

| 编号 | 处置 | 关键位置 |
|---|---|---|
| **P1-1** 分片部分写入被当成完整成功 | **已修**。本地通路改「临时文件 + `sync_all` + 原子发布」（`hard_link`，不支持则 `rename`）；段格式追加 `{"integrity":{"count":N,"sha256":…}}` 尾标，`decode_segment` 对**缺尾标 / 指纹不符 / 条数不符**一律拒绝（游标不前进）。WebDAV 用同一份尾标在读回时校验。 | `sync_stream/transport.rs::publish_atomic`、`sync_stream/segment.rs::decode_segment` |
| **P1-2** 事件部分应用后重试留下陈旧 `time_records` | **已修**。`apply_and_fold` 改收 `&mut SqliteConnection`；`pull` 按「一段一个事务」把事件 upsert + 折叠 + 物化 + **游标推进**包在一起。仓储加 `materialize_in` / `repository::upsert_in` / `load_session(conn)`。 | `sync_stream/apply.rs`、`sync_stream/pull.rs::apply_segment` |
| **P1-3** 倒计时暂停后结束时间早于真实到点 | **已修**。新增 `timer_time::countdown_end_at` = `now - (live - target)`（等价「这一段跑满 `target - accumulated` 秒」），暂停中退化为 `now`（≤1 tick 误差）。ADR-011 §5 已同步修订。 | `services/timer_time.rs`、`services/countdown.rs`、`docs/decisions/ADR-011.md` |
| **P1-4** 隐私承诺与可选网络功能矛盾 | **已修**。README 双语改成「默认不发任何请求，只有显式配置的同步/备份会发，且只发到你填的落点」；新增「数据去哪了 / Where your data goes」表（四条通道 × 何时/传什么/传到哪/怎么关），并写明无账号无遥测、HTTPS 非端到端加密、使用统计与计时记录是两套数据。 | `README.md` |
| **P2-1** WebDAV 设备目录名未校验 | **已修**。`pull` 只接受 `identity::is_valid`（12 位小写 hex），非法项记一条可见错误、其它 peer 照常同步。 | `sync_stream/pull.rs::peers_of` |
| **P2-2** Android 使用统计静默截断 | **已修**。Kotlin `queryDay` 回 `truncated`（`scanned >= MAX_EVENTS && events.hasNextEvent()`）；桥透传；宿主**跳过落库**（`rollup` 是「先删再插」的重扫语义，拿不完整聚合去写会把完整的那天改小）；`UsageDay.truncated` 给到界面，日视图标一句「不完整」。 | `UsageStats.kt`、`TimingNativePlugin.kt`、`models/usage.rs`、`commands/usage_cmd.rs`、`UsageDayView.tsx` |
| **P2-3** 全量 Rust 测试 Windows 稳定性失败 | **已修（两处真因）**。① `validate_sqlite` 从不显式 `close()`，sqlx 的 `Drop` 不等句柄释放 ⇒ 「校验完立刻删文件」撞 `os error 32`；逻辑搬到 `scheduled_export_validate` 并显式 `close().await`（原文件是冻结基线，不给加行）。② 重试用例预算 `10ms × 5`＝50ms，而用例要先观察 `RetryWait` 再释放端口，满载时那一步就超预算 ⇒ 红在「没恢复」；预算放宽到 2000 次。连续两轮全量各 1987 passed / 1 failed（唯一红为沙箱拦 `reg.exe`）。 | `scheduled_export_validate.rs`、`web_activity_bridge.rs` |
| **P2-4** Android 原生统计缺自动化验证 | **未做**。需要 Android Gradle build + JVM 单测进 CI；本轮环境没有 Android 工具链，写不了也验不了。建议独立一批：把 `collectSpans` 的配对/合并抽成纯 Kotlin 可测函数。 |
| **P2-5** 发布链无自动可复现交付 | **未做**。tag 驱动的签名发布流水属发布工程，且与「谁来持有签名」耦合（O1 未做）；本批不碰。 |
| **P2-6** 性能缺端到端基准 | **未做**。需要在真机 / 一年以上真实数据上测冷启动与首屏；本轮只能给出构建体积（沿用报告结论，不据此判定缺陷）。 |

判据与自证（全部在 `npm run check` 链或 `cargo test --lib` 里）：

- `sync_stream/tests_integrity.rs` 7 条，其中新增：`interrupted_write_never_publishes_a_partial_segment`（写完临时文件、发布前失败 ⇒ 最终路径**不存在**）、`failed_apply_leaves_no_half_state_and_retry_converges`（触发器让 INSERT ABORT ⇒ 事件/记录/游标三者都回滚，故障消失后重试收敛并与源端逐位一致）、`non_device_dir_is_reported_without_blocking_real_peers`、`published_segment_leaves_no_temp_files`。
- `segment.rs::incomplete_segments_are_rejected`：空文件、缺尾标、正文被改、条数说谎。
- `tests/countdown_pause.rs`（新）：暂停后到点落在恢复点之后；跨零点按真实到点时刻拆天。
- 变异四段（注入 → 点名红 → 撤销 → 绿 + `MUTATION` 零残留）：绕过原子发布、吞掉折叠错误、去掉 peer 校验、倒计时退回旧口径，各自红在对应的那条判据上。

仍未做的一条 P1 级遗留（不在本报告内，来自上一份评审）：**O1 正式签名**，需要拥有者持有 keystore，用户明确本轮不动。

## 参考资料

- Todoist 离线使用说明（官方）：https://www.todoist.com/zh-CN/help/todoist/features/use-todoist-while-offline-4rbaZw
- Toggl Track Windows 离线与同步说明（官方）：https://support.toggl.com/en-us/article/toggl-track-desktop-app-for-windows-5w1y5/
- Toggl 本地应用数据说明（官方）：https://support.toggl.com/en-us/article/what-data-do-our-locally-installed-apps-store-1hq4kn7/
