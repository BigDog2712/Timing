//! `web_activity.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;

#[test]
fn active_tab_sanitizer_preserves_full_url_for_export() {
    let sanitized = sanitize_active_tab_payload(BrowserActiveTabPayload {
        browser_client_id: Some("client-1".into()),
        browser_kind: Some("Chrome".into()),
        extension_version: Some("0.1.0".into()),
        tab_id: Some(1),
        window_id: Some(2),
        url: Some("https://GitHub.com/Ceceliaee/patina/issues/6".into()),
        title: Some("Issue #6".into()),
        fav_icon_url: Some("https://github.com/favicon.ico".into()),
        incognito: Some(false),
        captured_at_ms: Some(123),
        event_reason: Some("activated".into()),
    })
    .unwrap()
    .unwrap();

    assert_eq!(sanitized.normalized_domain, "github.com");
    assert_eq!(sanitized.browser_kind, "chrome");
    assert_eq!(
        sanitized.url.as_deref(),
        Some("https://GitHub.com/Ceceliaee/patina/issues/6")
    );
    assert_eq!(sanitized.title.as_deref(), Some("Issue #6"));
}

#[test]
fn active_tab_sanitizer_ignores_non_web_and_incognito_tabs() {
    let mut payload = BrowserActiveTabPayload {
        browser_client_id: None,
        browser_kind: None,
        extension_version: None,
        tab_id: None,
        window_id: None,
        url: Some("chrome://extensions".into()),
        title: None,
        fav_icon_url: None,
        incognito: Some(false),
        captured_at_ms: None,
        event_reason: None,
    };
    assert!(sanitize_active_tab_payload(payload.clone())
        .unwrap()
        .is_none());

    payload.url = Some("https://example.com".into());
    payload.incognito = Some(true);
    assert!(sanitize_active_tab_payload(payload).unwrap().is_none());
}

#[test]
fn domain_override_defaults_to_enabled() {
    assert!(parse_domain_override_enabled("{}"));
    assert!(!parse_domain_override_enabled(r#"{"enabled":false}"#));
    assert!(parse_domain_override_enabled("not-json"));
}

#[test]
fn supported_browser_exe_excludes_opera_gx() {
    assert!(resolve_web_activity_browser_family("opera.exe").is_some());
    assert!(!resolve_web_activity_browser_family("opera_gx.exe").is_some());
}

#[test]
fn supported_browser_exe_includes_confirmed_360_browsers() {
    assert!(resolve_web_activity_browser_family("360ChromeX.exe").is_some());
    assert!(resolve_web_activity_browser_family(" 360chromex.exe ").is_some());
    assert!(resolve_web_activity_browser_family("360SE.exe").is_some());
    assert!(resolve_web_activity_browser_family(" 360se.exe ").is_some());
    assert!(!resolve_web_activity_browser_family("360chrome.exe").is_some());
}

#[test]
fn supported_browser_exe_resolves_chromium_family() {
    for exe_name in [
        "chrome.exe",
        "msedge.exe",
        "brave.exe",
        "opera.exe",
        "vivaldi.exe",
        "arc.exe",
        "chromium.exe",
        "qqbrowser.exe",
        "360chromex.exe",
        "360se.exe",
        "quark.exe",
        "thorium.exe",
        "centbrowser.exe",
        "catsxp.exe",
        "tabbit browser.exe",
    ] {
        assert_eq!(
            resolve_web_activity_browser_family(exe_name),
            Some(WebActivityBrowserFamily::Chromium),
            "{exe_name} should be treated as Chromium family",
        );
    }
}

#[test]
fn supported_browser_exe_resolves_firefox_family() {
    for exe_name in ["firefox.exe", "zen.exe", "floorp.exe", "iceweasel.exe"] {
        assert_eq!(
            resolve_web_activity_browser_family(exe_name),
            Some(WebActivityBrowserFamily::Firefox),
            "{exe_name} should be treated as Firefox family",
        );
    }
}

#[test]
fn supported_browser_exe_normalizes_case_and_space() {
    assert_eq!(
        resolve_web_activity_browser_family(" Firefox.EXE "),
        Some(WebActivityBrowserFamily::Firefox),
    );
    assert_eq!(
        resolve_web_activity_browser_family(" Thorium.EXE "),
        Some(WebActivityBrowserFamily::Chromium),
    );
    assert_eq!(
        resolve_web_activity_browser_family(" QQBrowser.EXE "),
        Some(WebActivityBrowserFamily::Chromium),
    );
    assert_eq!(
        resolve_web_activity_browser_family(" Tabbit Browser.EXE "),
        Some(WebActivityBrowserFamily::Chromium),
    );
    assert_eq!(
        resolve_web_activity_browser_family(" Quark.EXE "),
        Some(WebActivityBrowserFamily::Chromium),
    );
}

#[test]
fn unsupported_browser_exe_keeps_candidates_out_until_confirmed() {
    for exe_name in [
        "tor.exe",
        "librewolf.exe",
        "waterfox.exe",
        "noraneko.exe",
        "ungoogled-chromium.exe",
        "helium.exe",
        "supermium.exe",
        "edge.exe",
        "egde.exe",
    ] {
        assert_eq!(
            resolve_web_activity_browser_family(exe_name),
            None,
            "{exe_name} should remain unsupported",
        );
    }
}
