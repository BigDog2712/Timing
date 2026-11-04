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
    let app_data_dir = app.path().app_data_dir()?;

    // ① 日志最先：后续任何一步 panic / 失败都要留痕。
    crate::platform::log::init(&app_data_dir);
    boot_timing::set_dir(&app_data_dir.join("logs"));
    boot_timing::mark("log_ready");
    // 平台标识入日志：用户报障时第一眼要能分清是桌面还是手机（能力面不同）。
    crate::log_info!(
        "startup on {} ({})",
        crate::platform::host::OS,
        app_data_dir.display()
    );

    // ①' [V0.4.1] Markdown 落点写前留底目录（md-sync 覆写用户日记前存原内容）。
    //     放在 app_data 而不是 vault 里：不在 Obsidian 的库里堆 .bak。
    crate::infra::md_backup::set_root(app_data_dir.join("backups").join("md"));

    // ② 建库（含迁移）+ ③ 默认设置
    let pool = tauri::async_runtime::block_on(db::init_pool(&app_data_dir))?;
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
        app::diagnostics::write_snapshot(&app, &app_data_dir);
        boot_timing::mark("diagnostics_done");
    }

    // ⑧ 常驻调度
    #[cfg(desktop)]
    jobs::monitor::spawn_watch(app.clone());
    jobs::flusher::spawn_flusher(app.clone());
    jobs::reminder::spawn_reminder_watcher(app.clone());
    jobs::nudge::spawn_nudge_watcher(app.clone());
    jobs::countdown::spawn_countdown_watcher(app.clone());
    // md-sync 落点是桌面文件路径，移动端要 SAF（本轮不做，设计 §1.4）
    #[cfg(desktop)]
    jobs::md_sync::spawn_md_sync_watcher(app.clone());
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
