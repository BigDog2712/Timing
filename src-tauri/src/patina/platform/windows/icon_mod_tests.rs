//! `icon.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;

#[test]
fn monochrome_icon_conversion_releases_mask_bitmaps() {
    const CHILD_ENV: &str = "PATINA_ICON_RESOURCE_TEST_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        // GDI counts belong to the process; isolate them from parallel tests.
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "platform::windows::icon::tests::monochrome_icon_conversion_releases_mask_bitmaps",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }

    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS,
    };
    use windows::Win32::UI::WindowsAndMessaging::CreateIcon;
    unsafe {
        let mask = [0xff_u8; 128];
        let pixels = [0_u8; 128];
        let icon = OwnedIcon::new(
            CreateIcon(None, 32, 32, 1, 1, mask.as_ptr(), pixels.as_ptr()).unwrap(),
        )
        .unwrap();
        let mut info = Default::default();
        GetIconInfo(icon.raw(), &mut info).unwrap();
        assert!(info.hbmColor.is_invalid());
        let mask_guard = OwnedBitmap::new(info.hbmMask).unwrap();
        let before = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
        assert!(before > 0);
        for _ in 0..64 {
            assert!(hicon_to_base64(icon.raw()).is_none());
        }
        let after = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
        assert_eq!(after, before, "monochrome conversion retained GDI objects");
        drop(mask_guard);
    }
}

fn cache_test_guard() -> std::sync::MutexGuard<'static, ()> {
    static CACHE_TEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
        std::sync::OnceLock::new();
    CACHE_TEST_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap()
}

fn clear_icon_result_cache_for_tests() {
    icon_result_cache().lock().unwrap().clear();
}

#[test]
fn cache_clock_rollback_invalidates_icon_results() {
    let _guard = cache_test_guard();
    clear_icon_result_cache_for_tests();
    for value in [Some("icon".into()), None] {
        write_icon_result_cache("old".into(), value.clone(), 1_000_000);
        assert!(read_icon_result_cache("old", 1_000_001).is_some());
        assert!(read_icon_result_cache("old", 100_000).is_none());
        assert!(read_icon_result_cache("old", 1_000_001).is_none());
        write_icon_result_cache("old".into(), value.clone(), 1_000_000);
        write_icon_result_cache("fresh".into(), value, 100_000);
        assert!(!icon_result_cache().lock().unwrap().contains_key("old"));
        assert!(read_icon_result_cache("fresh", 100_001).is_some());
    }
}

#[test]
fn parse_hwnd_accepts_hex_and_decimal() {
    let hex = parse_hwnd("0x100").unwrap();
    let dec = parse_hwnd("256").unwrap();
    assert_eq!(hex.0 as usize, 0x100);
    assert_eq!(dec.0 as usize, 256);
}

#[test]
fn parse_hwnd_rejects_invalid_or_zero() {
    assert!(parse_hwnd("").is_none());
    assert!(parse_hwnd("0x0").is_none());
    assert!(parse_hwnd("not-a-hwnd").is_none());
}

#[test]
fn icon_result_cache_expires_positive_entries_after_ttl() {
    let _guard = cache_test_guard();
    clear_icon_result_cache_for_tests();
    write_icon_result_cache("file:test.exe".to_string(), Some("icon".to_string()), 1_000);

    assert_eq!(
        read_icon_result_cache("file:test.exe", 60_000),
        Some(Some("icon".to_string()))
    );
    assert_eq!(read_icon_result_cache("file:test.exe", 601_001), None);
}

#[test]
fn icon_cache_bytes_are_bounded_and_file_replacement_invalidates_keys() {
    let _guard = cache_test_guard();
    clear_icon_result_cache_for_tests();
    for index in 0..20 {
        write_icon_result_cache(
            format!("large-{index}"),
            Some("x".repeat(1024 * 1024)),
            index,
        );
    }
    let cache = icon_result_cache().lock().unwrap();
    assert!(icon_cache_bytes(&cache) <= ICON_RESULT_CACHE_MAX_BYTES);
    assert!(cache.len() < 20);
    drop(cache);
    let path = std::env::temp_dir().join(format!("patina-icon-key-{}", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"a").unwrap();
    let before = file_cache_key(path.to_str().unwrap()).unwrap();
    std::fs::write(&path, b"bb").unwrap();
    assert_ne!(file_cache_key(path.to_str().unwrap()).unwrap(), before);
    std::fs::remove_file(&path).unwrap();
    assert!(file_cache_key(path.to_str().unwrap()).is_none());
}

#[test]
fn icon_result_cache_expires_negative_entries_quickly() {
    let _guard = cache_test_guard();
    clear_icon_result_cache_for_tests();
    write_icon_result_cache("file:missing.exe".to_string(), None, 1_000);

    assert_eq!(
        read_icon_result_cache("file:missing.exe", 30_000),
        Some(None)
    );
    assert_eq!(read_icon_result_cache("file:missing.exe", 61_001), None);
}

#[test]
fn icon_result_cache_prunes_expired_entries_before_writing() {
    let _guard = cache_test_guard();
    clear_icon_result_cache_for_tests();
    write_icon_result_cache(
        "file:old.exe".to_string(),
        Some("old-icon".to_string()),
        1_000,
    );
    write_icon_result_cache(
        "file:new.exe".to_string(),
        Some("new-icon".to_string()),
        601_001,
    );

    assert_eq!(read_icon_result_cache("file:old.exe", 601_001), None);
    assert_eq!(
        read_icon_result_cache("file:new.exe", 601_001),
        Some(Some("new-icon".to_string()))
    );
}

#[test]
fn icon_result_cache_keeps_a_bounded_number_of_entries() {
    let _guard = cache_test_guard();
    clear_icon_result_cache_for_tests();
    for index in 0..(ICON_RESULT_CACHE_MAX_ENTRIES + 8) {
        write_icon_result_cache(
            format!("file:app-{index}.exe"),
            Some(format!("icon-{index}")),
            700_000 + index as u64,
        );
    }

    assert_eq!(read_icon_result_cache("file:app-0.exe", 700_500), None);
    assert_eq!(
        read_icon_result_cache(
            &format!("file:app-{}.exe", ICON_RESULT_CACHE_MAX_ENTRIES + 7),
            700_500,
        ),
        Some(Some(format!("icon-{}", ICON_RESULT_CACHE_MAX_ENTRIES + 7)))
    );
}
