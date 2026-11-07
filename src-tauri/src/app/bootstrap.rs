//! 启动装配（composition root）：把平台能力、业务服务、调度器按固定顺序接起来。
//!
//! 顺序是**有依赖的**，改之前先看注释：
//! 1. 日志：必须最先，后面任何一步失败才有记录可查；
//! 2. 建库 + 迁移：读 `settings.schema.version` 决定要不要跑 `0002`；
//! 3. 默认设置：`ensure_defaults` 只在缺行时写，幂等；
//! 4. 注入 `AppState`（只有 SqlitePool）；
//! 5. 托盘：菜单内容依赖状态快照，先建出来；
//! 6. 窗口钳制：window-state 插件已在窗口创建时回填过位置，此刻纠正越界；
//! 7. 诊断快照：落一份启动现场，出问题时让用户直接发文件；
//! 8. 调度器：monitor / flusher / reminder / countdown / md_sync；
//! 9. 便利贴打开标记归零（V0.3.9 起不再自动恢复便利贴窗口，见第 9 步注释）。
//!
//! 每一步都打一条 `boot_timing::mark`：启动慢的时候能直接看出卡在第几步
//! （见 `platform/boot_timing.rs` 的口径说明）。

use tauri::{AppHandle, Manager};

// `app::tray` / `app::diagnostics` 都是桌面独占模块，移动端这个叶子导入会空着。
#[cfg(desktop)]
use crate::app;
use crate::infra::db;
#[cfg(desktop)]
use crate::infra::window;
use crate::jobs;
use crate::platform::boot_timing;
use crate::services;
use crate::state::AppState;

/// 应用启动流程（供 `Builder::setup` 调用）。
pub fn setup(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    /* [V0.11.6] 数据根不再从 Tauri 拿：落点决策在 `lib.rs` 的
    `app::portable_boot::prepare()`（`Builder::run()` 之前）已经做完并注入
    `platform::app_dir`。移动端没有那一层，必须在这里把系统沙箱注入一次
    （`Roots::sandbox`：数据根 = 沙箱，插件根 = 沙箱/plugins）。 */
    #[cfg(mobile)]
    {
        let sandbox = app.path().app_data_dir()?;
        crate::platform::app_dir::set(crate::platform::app_dir::Roots::sandbox(sandbox));
    }
    let data_root = crate::platform::app_dir::data_root();

    // ① 日志最先：后续任何一步 panic / 失败都要留痕。
    crate::platform::log::init(&data_root);
    boot_timing::set_dir(&data_root.join("logs"));
    boot_timing::mark("log_ready");
    // 平台标识入日志：用户报障时第一眼要能分清是桌面还是手机（能力面不同）。
    // [V0.11.6] 追加便携标记：同一句里就能看出数据在哪、是不是回退到 AppData。
    crate::log_info!(
        "startup on {} ({}), portable={}",
        crate::platform::host::OS,
        data_root.display(),
        crate::platform::app_dir::is_portable()
    );

    /* ①' [V0.5.0] 迁移结果补记 + 路径一致性自检 + 自启接管。
    迁移跑在本函数之前（`lib.rs::run()` 开头），那时还没有日志文件可写，
    所以结果缓存在 `infra::appdata_migrate`，这里补记（ARCHITECTURE §7 N11）。 */
    #[cfg(desktop)]
    {
        record_migration(&app);
        boot_timing::mark("migrate_recorded");
    }

    // ①'' [V0.11.6] 落点搬运的结果与回退原因（同一条链路：启动期只缓存，这里补记）。
    #[cfg(desktop)]
    {
        record_portable();
        boot_timing::mark("portable_recorded");
    }

    // ①' [V0.4.1] Markdown 落点写前留底目录（md-sync 覆写用户日记前存原内容）。
    //     放在数据根而不是 vault 里：不在 Obsidian 的库里堆 .bak。
    crate::infra::md_backup::set_root(data_root.join("backups").join("md"));
    // [V0.11.13] WebDAV 应用密码的密文落点（DPAPI / Keystore）+ 出厂 Obsidian 落点登记。
    crate::infra::secret::install_from_data_root(&data_root);
    crate::infra::md_backup::register_root(data_root.join("md"), "obsidian");

    // ② 建库（含迁移）+ ③ 默认设置
    let pool = tauri::async_runtime::block_on(db::init_pool(&data_root))?;
    boot_timing::mark("db_ready");
    tauri::async_runtime::block_on(services::settings::ensure_defaults(&pool))?;
    app.manage(AppState::new(pool.clone()));
    boot_timing::mark("defaults_ready");

    // ④' 移动端通知通道：API 26+ 没有通道的通知会被系统静默丢弃，必须在第一次
    //    发送前建好（倒计时 / 提醒都走这条通道）。
    #[cfg(target_os = "android")]
    crate::infra::notify::ensure_channel(&app);

    // ⑤ 托盘（桌面独占：Android 无托盘，跳过）
    #[cfg(desktop)]
    {
        app::tray::build(&app)?;
        boot_timing::mark("tray_ready");
    }

    // ⑥ 启动即钳制：AC-23①。window-state 插件的 on_window_ready 早于本 setup 回调，
    //    所以此刻窗口位置已是「上次的」，越界要在这里纠正。
    //    移动端只有一个系统管理的全屏 Activity，没有可钳制的窗口。
    #[cfg(desktop)]
    {
        if let Err(err) = window::reclamp_main(&app) {
            crate::log_warn!("startup reclamp failed: {err}");
        }
        boot_timing::mark("reclamped");

        // ⑦ 诊断快照（失败不致命；要枚举显示器与窗口，移动端无意义）
        app::diagnostics::write_snapshot(&app, &data_root);
        boot_timing::mark("diagnostics_done");
    }

    // ⑧ 常驻调度
    #[cfg(desktop)]
    jobs::monitor::spawn_watch(app.clone());
    jobs::flusher::spawn_flusher(app.clone());
    jobs::reminder::spawn_reminder_watcher(app.clone());
    jobs::nudge::spawn_nudge_watcher(app.clone());
    jobs::countdown::spawn_countdown_watcher(app.clone());
    /* [V0.12.0] md 同步：桌面直接读写文件路径；手机先由原生侧把当天文件镜像进沙箱，
    再跑同一套合并逻辑（见 `app::md_sync_mobile`）。 */
    #[cfg(desktop)]
    jobs::md_sync::spawn_md_sync_watcher(app.clone());
    #[cfg(mobile)]
    jobs::md_sync_mobile::spawn_md_sync_watcher(app.clone());
    boot_timing::mark("jobs_spawned");

    // 移动端跳过了托盘 / 钳制 / 诊断，补一个标记点：启动耗时报告里段落不缺项，
    // 一眼能看出「不是卡住，是这三步本来就不跑」。
    #[cfg(mobile)]
    boot_timing::mark("mobile_skip_desktop");

    // ⑨ [V0.3.9] 不再恢复上次打开的便利贴窗口（用户口径：启动不要「默认存在一张」）。
    //    `is_open` 只在点黄点收纳时归零，退出时不清；启动统一清零，避免残留标记占满
    //    「最多同时开 20 张」的额度。便利贴一律由清单 / 手柄 / 右键显式打开。
    if let Err(err) = tauri::async_runtime::block_on(services::note::reset_open(&pool)) {
        crate::log_warn!("reset note open flags failed: {err}");
    }

    boot_timing::mark("setup_done");
    crate::log_info!("startup complete");
    // 兜底汇总：如果前端首帧迟迟没来（窗口被托盘隐藏启动 / WebView 未渲染），
    // 也要留下这次的 setup 耗时，不能白跑一趟。
    boot_timing::report("setup");
    Ok(())
}

/// 迁移结果的补记与自启接管（桌面独占）。
///
/// 三件事，顺序不能换：
/// 1. **路径一致性自检**：`run()` 阶段没有 `AppHandle`，迁移目标只能靠
///    `dirs::data_dir()` + identifier 复刻。推错时的表现是「用户看不到自己的数据，
///    而日志一片安静」——最坏的一种。不一致必须留 ERROR（ARCHITECTURE §7 N12）。
/// 2. **结果补记**：六条文案逐字可 grep（§6.3）。
/// 3. **自启接管**：只有真的迁移过才动注册表。
///
/// [V0.11.6] 自检的比对对象换成「**品牌改名迁移**的目标」（`dirs::data_dir()` +
/// identifier），**不是**当前数据根：便携模式下数据根是 `<exe>\data`，拿它比对会让
/// 每次启动都报一条假 ERROR（ADR-050 §4 末尾那个坑）。
#[cfg(desktop)]
fn record_migration(app: &AppHandle) {
    use crate::infra::appdata_migrate::{self as mig, MigrationOutcome};

    let brand_target = {
        let identifier = app.config().identifier.clone();
        crate::platform::app_dir::appdata_dir(&identifier)
    };
    if let Some(used) = mig::paths_used() {
        if brand_target
            .as_deref()
            .is_some_and(|target| used.target != target)
        {
            crate::log_error!(
                "appdata mismatch: migrate target={} authoritative={}",
                used.target.display(),
                brand_target
                    .as_deref()
                    .map(|dir| dir.display().to_string())
                    .unwrap_or_else(|| "<未知>".into())
            );
        }
    }
    if mig::cleaned_leftover_temp() {
        crate::log_info!("migrate: cleaned leftover temp");
    }

    match mig::outcome() {
        Some(outcome @ MigrationOutcome::Migrated(_)) => {
            if let MigrationOutcome::Migrated(info) = &outcome {
                crate::log_info!(
                    "migrate: ok from={} rows={} bytes={} wal={}",
                    info.source.display(),
                    info.row_counts.summary(),
                    info.db_bytes,
                    info.wal_copied
                );
            }
            /* 标记文件写不进去时数据其实已经搬好（`appdata_migrate` 里已降级为告警），
            这里补一条 WARN 让它在日志里可查。标记恒在**品牌迁移目标**里
            （`%APPDATA%\com.timing.app`），不是 `<exe>\data`。 */
            if brand_target
                .as_deref()
                .is_some_and(|dir| mig::read_marker(dir).is_none())
            {
                crate::log_warn!(
                    "migrate: ok but marker file missing; 详见旧目录 migration-failed.txt"
                );
            }
            if let Err(err) = app::autostart_takeover::run(app, &outcome) {
                crate::log_warn!("autostart takeover failed: {err}");
            }
        }
        Some(MigrationOutcome::Skipped) => {
            crate::log_info!("{}", app::preboot::skip_reason());
        }
        Some(MigrationOutcome::AlreadyPresent(target)) => {
            crate::log_info!(
                "migrate: skip, already migrated target={}",
                target.display()
            );
        }
        Some(MigrationOutcome::TargetOccupied(source)) => {
            crate::log_warn!(
                "migrate: skip, target db exists; legacy={}（未采用）",
                source.display()
            );
        }
        Some(MigrationOutcome::NoLegacy) => {
            crate::log_info!("migrate: no legacy data");
        }
        Some(MigrationOutcome::Failed(failure)) => {
            crate::log_error!(
                "migrate failed: stage={} reason={}",
                failure.stage.as_str(),
                failure.reason
            );
            /* 失败明细已在 `preboot` 写进旧目录；这里显式说明「旧目录在哪」，
            用户报障时能直接把路径发过来。
            [V0.11.6] 用 `legacy_dir()` 而不是 `legacy_dir_of(数据根)`：便携模式下
            后者会算出 `<exe>\<品牌改名前的 app 标识>`（一个永不存在的路径），报障时误导用户。 */
            if let Some(legacy) = mig::legacy_dir() {
                crate::log_error!(
                    "migrate failed: legacy dir kept intact at {}",
                    legacy.display()
                );
            }
        }
        /* 没跑迁移（移动端 / 拿不到 data_dir）：什么都不记，避免噪声。 */
        None => {}
    }
}

/// 落点决策的补记（桌面独占，V0.11.6）。
///
/// 启动期（`platform::log::init` 之前）不能写日志，`portable_boot` 只把事实缓存在
/// 自己的 `Mutex` 里；这里在日志就绪后逐条补记。**一次决策必须落盘可查**
/// （设计 §7）：`portable-optout.json` + 日志一行 + `diagnostics.txt` 两行。
#[cfg(desktop)]
fn record_portable() {
    use crate::infra::portable_migrate::{self as pm, Outcome};

    if let Some(note) = app::portable_boot::note() {
        /* [V0.11.15] `data root:` 是排障 grep 的稳定前缀（设计 §8-8）：一行同时给出最终
        落点、是不是便携、以及**为什么**（`source`）。 */
        crate::log_info!(
            "data root: {} portable={} source={} fallback={}",
            note.data.display(),
            note.portable,
            note.source,
            note.fallback.unwrap_or("-")
        );
    }
    /* 指针在、但这次用户选了「按默认流程启动」：这一句是那条路的唯一书面证据。 */
    if let Some(skipped) = app::data_root_boot::skipped() {
        crate::log_warn!("data root: pointer skipped this run, unusable at {skipped}");
    }

    match pm::outcome() {
        Some(Outcome::Migrated(facts)) => crate::log_info!(
            "portable migrate: ok from={} rows={} bytes={} wal={}",
            facts.source.display(),
            facts.row_counts.summary(),
            facts.db_bytes,
            facts.wal_copied
        ),
        Some(Outcome::AlreadyPresent(target)) => crate::log_info!(
            "portable migrate: skip, data dir already has db at {}",
            target.display()
        ),
        Some(Outcome::NoLegacy) => crate::log_info!("portable migrate: no legacy db"),
        Some(Outcome::Failed { stage, reason }) => {
            crate::log_error!("portable migrate failed: stage={stage} reason={reason}")
        }
        None => {}
    }
}
