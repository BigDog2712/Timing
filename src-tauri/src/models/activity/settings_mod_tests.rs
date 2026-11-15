//! `settings.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::{
    parse_boolean_setting, parse_close_behavior, parse_web_activity_port, CloseBehavior,
    DesktopBehaviorSettings, RemoteStatusBridgeSettings, StartupSource, StartupUiStrategy,
    WebActivityBridgeSettings, WebActivitySettings, DEFAULT_LAUNCH_AT_LOGIN,
    DEFAULT_START_MINIMIZED, DEFAULT_WEB_ACTIVITY_PORT,
};

#[test]
fn parse_desktop_behavior_keeps_invalid_values_conservative() {
    assert_eq!(parse_close_behavior("tray"), CloseBehavior::Tray);
    assert_eq!(parse_close_behavior("unknown"), CloseBehavior::Exit);
}

#[test]
fn parse_boolean_setting_supports_common_raw_values() {
    assert!(parse_boolean_setting("1", false));
    assert!(parse_boolean_setting("YES", false));
    assert!(!parse_boolean_setting("0", true));
    assert!(!parse_boolean_setting("off", true));
    assert!(parse_boolean_setting("invalid", true));
    assert!(!parse_boolean_setting("invalid", false));
}

#[test]
fn web_activity_bridge_settings_parse_defaults_and_invalid_port() {
    assert_eq!(
        WebActivityBridgeSettings::from_storage_values(None, None, None),
        WebActivityBridgeSettings::default()
    );
    assert_eq!(
        WebActivityBridgeSettings::from_storage_values(Some("80"), None, None),
        WebActivityBridgeSettings {
            enabled: false,
            port: DEFAULT_WEB_ACTIVITY_PORT,
            token: String::new(),
        }
    );
    assert_eq!(
        WebActivityBridgeSettings::from_storage_values(Some("18080"), Some("1"), Some("   "),),
        WebActivityBridgeSettings {
            enabled: false,
            port: 18_080,
            token: String::new(),
        }
    );
    assert_eq!(
        WebActivityBridgeSettings::from_storage_values(Some("18080"), Some("1"), Some("web")),
        WebActivityBridgeSettings {
            enabled: true,
            port: 18_080,
            token: "web".to_string(),
        }
    );
    assert_eq!(parse_web_activity_port("65535"), Some(65_535));
    assert_eq!(parse_web_activity_port("1023"), None);
}

#[test]
fn web_activity_settings_require_a_token_to_enable() {
    assert_eq!(
        WebActivitySettings::from_storage_values(Some("1"), Some("   ")),
        WebActivitySettings {
            enabled: false,
            token: String::new(),
        }
    );
    assert_eq!(
        WebActivitySettings::from_storage_values(Some("1"), Some("secret")),
        WebActivitySettings {
            enabled: true,
            token: "secret".to_string(),
        }
    );
}

#[test]
fn remote_status_bridge_requires_url_and_token_to_enable() {
    assert_eq!(
        RemoteStatusBridgeSettings::from_storage_values(
            Some("1"),
            Some(""),
            Some("secret"),
            Some("machine")
        ),
        RemoteStatusBridgeSettings {
            enabled: false,
            url: String::new(),
            token: "secret".to_string(),
            machine_id: "machine".to_string(),
        }
    );
    assert_eq!(
        RemoteStatusBridgeSettings::from_storage_values(
            Some("1"),
            Some("wss://worker.example/ws"),
            Some("secret"),
            Some("machine"),
        ),
        RemoteStatusBridgeSettings {
            enabled: true,
            url: "wss://worker.example/ws".to_string(),
            token: "secret".to_string(),
            machine_id: "machine".to_string(),
        }
    );
}

#[test]
fn with_methods_keep_settings_updates_explicit() {
    let defaults = DesktopBehaviorSettings::default();
    let updated = defaults
        .with_close_behavior(CloseBehavior::Tray)
        .with_launch_behavior(false, true);

    assert_eq!(updated.close_behavior, CloseBehavior::Tray);
    assert!(!updated.launch_at_login);
    assert!(updated.start_minimized);
    assert_eq!(defaults.launch_at_login, DEFAULT_LAUNCH_AT_LOGIN);
}

#[test]
fn from_storage_values_applies_defaults_and_domain_parsing() {
    let defaults = DesktopBehaviorSettings::from_storage_values(None, None, None);
    assert_eq!(defaults, DesktopBehaviorSettings::default());

    let merged =
        DesktopBehaviorSettings::from_storage_values(Some("tray"), Some("no"), Some("invalid"));
    assert_eq!(merged.close_behavior, CloseBehavior::Tray);
    assert!(!merged.launch_at_login);
    assert_eq!(merged.start_minimized, DEFAULT_START_MINIMIZED);
}

#[test]
fn tray_visibility_and_launch_rules_follow_settings_semantics() {
    let defaults = DesktopBehaviorSettings::default();
    assert!(defaults.should_keep_tray_visible());
    assert!(defaults.start_minimized);

    let close_to_exit = defaults.with_close_behavior(CloseBehavior::Exit);
    assert!(!close_to_exit.should_keep_tray_visible());

    let no_autostart_minimize = defaults.with_launch_behavior(false, true);
    assert!(no_autostart_minimize.start_minimized);
}

#[test]
fn raw_desktop_behavior_update_stays_inside_domain() {
    let updated = DesktopBehaviorSettings::default().with_raw_close_behavior("tray");
    assert_eq!(updated.close_behavior, CloseBehavior::Tray);
}

#[test]
fn manual_and_autostart_launches_share_the_start_minimized_preference() {
    let settings = DesktopBehaviorSettings::default().with_close_behavior(CloseBehavior::Tray);

    assert_eq!(
        settings.startup_ui_strategy(StartupSource::Manual),
        StartupUiStrategy::OptimizeHidden
    );
    assert_eq!(
        settings.startup_ui_strategy(StartupSource::Autostart),
        StartupUiStrategy::OptimizeHidden
    );

    let visible_start = settings.with_launch_behavior(false, false);
    assert_eq!(
        visible_start.startup_ui_strategy(StartupSource::Manual),
        StartupUiStrategy::Show
    );
    assert_eq!(
        visible_start.startup_ui_strategy(StartupSource::Autostart),
        StartupUiStrategy::Show
    );
}

#[test]
fn explicit_restarts_and_settings_recovery_show_the_main_window() {
    let settings = DesktopBehaviorSettings::default();

    for source in [
        StartupSource::UpdateRestart,
        StartupSource::StorageRestart,
        StartupSource::SettingsRecovery,
    ] {
        assert_eq!(
            settings.startup_ui_strategy(source),
            StartupUiStrategy::Show
        );
    }
}

#[test]
fn launch_at_login_only_controls_registration() {
    let settings = DesktopBehaviorSettings::default().with_launch_behavior(false, true);

    assert_eq!(
        settings.startup_ui_strategy(StartupSource::Manual),
        StartupUiStrategy::OptimizeHidden
    );
    assert_eq!(
        settings.startup_ui_strategy(StartupSource::Autostart),
        StartupUiStrategy::OptimizeHidden
    );
}
