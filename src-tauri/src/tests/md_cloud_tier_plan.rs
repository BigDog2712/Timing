//! [V0.11.21] 手机端与桌面共用的节奏分派判据（PRD P4 / P5，设计 §三）。
//!
//! `plan_of` 是纯函数：喂一份配置，断言「这一条同步链本圈按哪套节奏判」。
//! 它存在的原因是**手机 watcher 与桌面云端链要同一份判定**，而两边的循环形状不同
//! （手机没有 `tray_sync` 防重入闸）。写成两份必然漂移：一处认 `usable`、另一处
//! 只看 `enabled`，就会出现「界面说云端在用、手机却按 15 分钟 md 轮询跑」。
//!
//! 变异自证：把 `plan_of` 的 `SyncPlan::Cloud` 分支改成 `Legacy`，
//! `cloud_usable_config_plan_is_cloud` 与 `auto_is_carried_through_verbatim` 两条必红。

use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::models::md_sync_config::MdSyncConfig;
use crate::services::md_cloud::tier::{decide, mobile_rounds, plan_of, SyncPlan, TierState};

fn binding() -> MdSyncBinding {
    MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: String::new(), // 手机端从不填根目录，镜像目录接管
        file: "{date}.md".into(),
        heading: "#### 事项计时".into(),
    }
}

fn webdav() -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        local_root: String::new(),
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "me@example.com".into(),
        auto: None,
    }
}

fn config(enabled: bool, cloud: Option<MdSyncCloud>) -> MdSyncConfig {
    MdSyncConfig {
        enabled,
        poll_secs: 900,
        bindings: vec![binding()],
        cloud,
    }
}

/// 老配置（没有 `cloud` 键）：走 `Legacy`，且 `poll_secs` 原值透传。
#[test]
fn legacy_config_keeps_poll_secs() {
    let mut cfg = config(true, None);
    cfg.poll_secs = 777;
    assert_eq!(plan_of(&cfg), SyncPlan::Legacy { poll_secs: 777 });
}

/// 总开关关着：即使云端填全了也不许跑（`round` 里本地那半会早退，云端那半不该单独跑）。
#[test]
fn disabled_master_switch_falls_back_to_legacy() {
    let cfg = config(false, Some(webdav()));
    assert_eq!(plan_of(&cfg), SyncPlan::Legacy { poll_secs: 900 });
}

/// 「开了但没填全」不是云端：与 `md_cloud::usable` 逐条对齐（账号空即不可用）。
#[test]
fn incomplete_cloud_falls_back_to_legacy() {
    let mut cloud = webdav();
    cloud.user = "  ".into();
    assert_eq!(
        plan_of(&config(true, Some(cloud))),
        SyncPlan::Legacy { poll_secs: 900 }
    );
}

/// 填全了就是 `Cloud`，且老配置没有 `auto` 键时按「智能 + 15」解释。
#[test]
fn cloud_usable_config_plan_is_cloud() {
    match plan_of(&config(true, Some(webdav()))) {
        SyncPlan::Cloud { auto } => {
            assert_eq!(auto.schedule, CloudSchedule::Smart);
            assert_eq!(auto.interval_minutes, 15);
        }
        other => panic!("填全的云端配置必须走三档，实得 {other:?}"),
    }
}

/// `auto` 逐字段透传：定时 30 不许被默认值盖掉（PRD §15.2.1 H-2 的同一条口径）。
#[test]
fn auto_is_carried_through_verbatim() {
    let mut cloud = webdav();
    cloud.auto = Some(MdCloudAuto {
        schedule: CloudSchedule::Interval,
        interval_minutes: 30,
    });
    match plan_of(&config(true, Some(cloud))) {
        SyncPlan::Cloud { auto } => {
            assert_eq!(auto.schedule, CloudSchedule::Interval);
            assert_eq!(auto.interval_secs(), 30 * 60);
        }
        other => panic!("实得 {other:?}"),
    }
}

/// `Cloud` 分支之后仍要过 `decide`：档位 = 关闭时自动路径一轮都不跑（PRD P8）。
/// 这条防的是「分派对了、判定漏了」——只看 `plan_of` 会以为关闭档还在跑。
#[test]
fn off_schedule_never_fires_even_when_cloud_is_ready() {
    let state = TierState {
        startup_ms: 0,
        ..TierState::default()
    };
    assert_eq!(decide(&state, CloudSchedule::Off, 900, 60 * 60 * 1_000, 0), None);
}

/* ============================================================ [V0.11.22] 手机端只走云端 */

/// `Cloud` 是手机上唯一会真的跑一轮的规划（PRD P1）。
#[test]
fn mobile_runs_cloud_plan() {
    assert!(mobile_rounds(&plan_of(&config(true, Some(webdav())))));
}

/// `Legacy`（没配云端 / 总开关关着）在手机上**什么都不跑**（PRD P1/P5）。
///
/// 这条是「界面下线了、调度还在跑」那个坑的判据：只要它变绿成 `true`，
/// 说明有人把 SAF 那一轮又接回手机 watcher 了。
#[test]
fn mobile_does_not_run_legacy_plan() {
    assert!(!mobile_rounds(&SyncPlan::Legacy { poll_secs: 900 }));
}

/// 三档里的「关闭」仍算 `Cloud` 规划——它跑不跑由 `decide` 判，不是 `mobile_rounds`。
/// 两层混为一谈会让「关闭档」被读成「手机不同步」，于是手动同步也得跟着禁用。
#[test]
fn mobile_off_schedule_is_still_a_cloud_plan() {
    let mut cloud = webdav();
    cloud.auto = Some(MdCloudAuto {
        schedule: CloudSchedule::Off,
        interval_minutes: 15,
    });
    assert!(mobile_rounds(&plan_of(&config(true, Some(cloud)))));
}
