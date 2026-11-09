//! `app_metadata.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::{
    is_shell_value_cache_entry_fresh, read_shell_value_cache, select_display_name,
    select_packaged_icon, shell_display_name_cache, shell_icon_cache,
    should_skip_window_icon_fallback, write_shell_value_cache, ShellValueCacheEntry,
    SHELL_PRESENTATION_CACHE_MAX_ENTRIES,
};

fn cache_test_guard() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap()
}

#[test]
fn cache_clock_rollback_invalidates_shell_presentation() {
    let cache = std::sync::Mutex::new(std::collections::HashMap::new());
    for value in [Some("presentation".into()), None] {
        write_shell_value_cache(&cache, "old".into(), value.clone(), 1_000_000);
        assert!(read_shell_value_cache(&cache, "old", 1_000_001).is_some());
        assert!(read_shell_value_cache(&cache, "old", 100_000).is_none());
        assert!(read_shell_value_cache(&cache, "old", 1_000_001).is_none());
        write_shell_value_cache(&cache, "old".into(), value.clone(), 1_000_000);
        write_shell_value_cache(&cache, "fresh".into(), value, 100_000);
        assert!(!cache.lock().unwrap().contains_key("old"));
        assert!(read_shell_value_cache(&cache, "fresh", 100_001).is_some());
    }
}

#[test]
fn explorer_shell_surface_skips_window_icon_fallback() {
    assert!(should_skip_window_icon_fallback("explorer.exe", "Progman"));
    assert!(should_skip_window_icon_fallback("explorer.exe", "WorkerW"));
    assert!(!should_skip_window_icon_fallback(
        "explorer.exe",
        "CabinetWClass"
    ));
    assert!(!should_skip_window_icon_fallback("Code.exe", "Progman"));
}

#[test]
fn packaged_display_name_prefers_shell_then_file_metadata() {
    assert_eq!(
        select_display_name(Some("Microsoft Store".into()), || panic!(
            "unused file lookup"
        )),
        Some("Microsoft Store".into())
    );
    assert_eq!(
        select_display_name(Some("  ".into()), || Some("WinStore".into())),
        Some("WinStore".into())
    );
}

#[test]
fn delayed_window_icon_rejects_missing_changed_and_reused_processes() {
    for after in [None, Some((2, "a.exe".into())), Some((1, "b.exe".into()))] {
        let mut identities = [Some((1, "a.exe".into())), after].into_iter();
        assert_eq!(
            super::verified_icon_read(|| identities.next().flatten(), || Some("icon".into())),
            None
        );
    }
    assert_eq!(
        super::verified_icon_read(|| None, || panic!("unknown window must not be read")),
        None
    );
    assert_eq!(
        super::verified_icon_read(|| Some((1, "a.exe".into())), || Some("icon".into())),
        Some("icon".into())
    );
}

#[test]
fn packaged_icon_stops_after_the_first_available_real_application_source() {
    use std::cell::Cell;

    let file_calls = Cell::new(0);
    let window_calls = Cell::new(0);
    assert_eq!(
        select_packaged_icon(
            Some("shell".into()),
            || {
                file_calls.set(file_calls.get() + 1);
                Some("file".into())
            },
            || {
                window_calls.set(window_calls.get() + 1);
                Some("window".into())
            },
        ),
        Some("shell".into())
    );
    assert_eq!(file_calls.get(), 0);
    assert_eq!(window_calls.get(), 0);

    assert_eq!(
        select_packaged_icon(
            None,
            || {
                file_calls.set(file_calls.get() + 1);
                Some("file".into())
            },
            || {
                window_calls.set(window_calls.get() + 1);
                Some("window".into())
            },
        ),
        Some("file".into())
    );
    assert_eq!(file_calls.get(), 1);
    assert_eq!(window_calls.get(), 0);

    assert_eq!(
        select_packaged_icon(
            None,
            || None,
            || {
                window_calls.set(window_calls.get() + 1);
                Some("window".into())
            },
        ),
        Some("window".into())
    );
    assert_eq!(window_calls.get(), 1);
}

#[test]
fn missing_shell_value_retries_quickly() {
    let entry = ShellValueCacheEntry {
        value: None,
        cached_at_ms: 1_000,
    };

    assert!(is_shell_value_cache_entry_fresh(&entry, 20_000));
    assert!(!is_shell_value_cache_entry_fresh(&entry, 31_001));
}

#[test]
fn resolved_shell_value_uses_positive_ttl() {
    let entry = ShellValueCacheEntry {
        value: Some("App".into()),
        cached_at_ms: 1_000,
    };

    assert!(is_shell_value_cache_entry_fresh(&entry, 600_000));
    assert!(!is_shell_value_cache_entry_fresh(&entry, 601_001));
}

#[test]
fn shell_value_cache_stays_bounded() {
    let _guard = cache_test_guard();
    let cache = shell_display_name_cache();
    cache.lock().unwrap().clear();
    for index in 0..(SHELL_PRESENTATION_CACHE_MAX_ENTRIES + 8) {
        write_shell_value_cache(
            cache,
            format!("publisher.app{index}!main"),
            Some(format!("App {index}")),
            700_000 + index as u64,
        );
    }

    assert_eq!(
        cache.lock().unwrap().len(),
        SHELL_PRESENTATION_CACHE_MAX_ENTRIES
    );
    assert_eq!(
        read_shell_value_cache(
            cache,
            &format!(
                "publisher.app{}!main",
                SHELL_PRESENTATION_CACHE_MAX_ENTRIES + 7
            ),
            700_500,
        )
        .flatten(),
        Some(format!("App {}", SHELL_PRESENTATION_CACHE_MAX_ENTRIES + 7))
    );
}

#[test]
fn shell_cache_rejects_oversized_values_and_evicts_by_bytes() {
    let cache = std::sync::Mutex::new(std::collections::HashMap::new());
    for index in 0..20 {
        write_shell_value_cache(
            &cache,
            format!("app-{index}"),
            Some("x".repeat(1024 * 1024)),
            index,
        );
    }
    assert!(
        super::shell_cache_bytes(&cache.lock().unwrap())
            <= super::SHELL_PRESENTATION_CACHE_MAX_BYTES
    );
    assert!(cache.lock().unwrap().len() < 20);
    write_shell_value_cache(
        &cache,
        "oversized".into(),
        Some("x".repeat(super::SHELL_PRESENTATION_CACHE_MAX_BYTES)),
        30,
    );
    assert!(!cache.lock().unwrap().contains_key("oversized"));
}

#[test]
fn display_name_cache_does_not_suppress_icon_resolution() {
    let _guard = cache_test_guard();
    let display_cache = shell_display_name_cache();
    let icon_cache = shell_icon_cache();
    display_cache.lock().unwrap().clear();
    icon_cache.lock().unwrap().clear();
    write_shell_value_cache(
        display_cache,
        "publisher.app!main".into(),
        Some("App".into()),
        1_000,
    );

    assert_eq!(
        read_shell_value_cache(display_cache, "publisher.app!main", 2_000).flatten(),
        Some("App".into())
    );
    assert!(read_shell_value_cache(icon_cache, "publisher.app!main", 2_000).is_none());
}
