use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(test)]
mod resource_tests;
use image::{ImageBuffer, Rgba};
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::Cursor;
use std::os::windows::ffi::OsStrExt;
use std::sync::{Mutex, OnceLock};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, GetDC, GetDIBits, GetObjectA, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassLongPtrW, GetIconInfo, SendMessageTimeoutW, GCLP_HICON, GCLP_HICONSM, HICON, ICON_BIG,
    ICON_SMALL, ICON_SMALL2, SMTO_ABORTIFHUNG, SMTO_BLOCK, WM_GETICON,
};

use crate::patina::platform::windows::handles::{MemoryDcGuard, OwnedBitmap, OwnedIcon, ScreenDcGuard};

const ICON_RESULT_CACHE_MAX_ENTRIES: usize = 128;
const ICON_RESULT_CACHE_MAX_BYTES: usize = 16 * 1024 * 1024;
const ICON_RESULT_CACHE_TTL_MS: u64 = 10 * 60 * 1000;
const ICON_RESULT_NEGATIVE_CACHE_TTL_MS: u64 = 60 * 1000;

#[derive(Clone)]
struct IconResultCacheEntry {
    cached_at_ms: u64,
    value: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct IconResultCacheStats {
    pub estimated_bytes: usize,
    pub max_bytes: usize,
    pub entries: usize,
    pub positive_entries: usize,
    pub negative_entries: usize,
    pub max_entries: usize,
    pub ttl_ms: u64,
    pub negative_ttl_ms: u64,
}

pub fn get_icon_base64(exe_path: &str) -> Option<String> {
    let cache_key = file_cache_key(exe_path);
    if let Some(cached) = cache_key
        .as_ref()
        .and_then(|key| read_icon_result_cache(key, now_ms()))
    {
        return cached;
    }

    let result = get_icon_base64_uncached(exe_path);
    if let Some(cache_key) = cache_key {
        write_icon_result_cache(cache_key, result.clone(), now_ms());
    }
    result
}

fn file_cache_key(path: &str) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    Some(format!(
        "file:{}:{}:{:?}",
        path.trim().to_ascii_lowercase(),
        metadata.len(),
        metadata.modified().ok()?
    ))
}

fn get_icon_base64_uncached(exe_path: &str) -> Option<String> {
    unsafe {
        let path_wide: Vec<u16> = OsStr::new(exe_path).encode_wide().chain(Some(0)).collect();

        let mut icon_large = HICON::default();
        let mut icon_small = HICON::default();

        let extracted = ExtractIconExW(
            windows::core::PCWSTR(path_wide.as_ptr()),
            0,
            Some(&mut icon_large),
            Some(&mut icon_small),
            1,
        );

        if extracted == 0 || extracted == u32::MAX {
            return None;
        }

        let icon_large = OwnedIcon::new(icon_large);
        let icon_small = OwnedIcon::new(icon_small);

        let hicon = if let Some(icon_large) = icon_large.as_ref() {
            icon_large.raw()
        } else {
            icon_small.as_ref()?.raw()
        };

        hicon_to_base64(hicon)
    }
}

pub(crate) fn get_window_icon_base64_from_hwnd(hwnd: HWND) -> Option<String> {
    unsafe {
        let hicon = query_window_icon_handle(hwnd)?;
        hicon_to_base64(hicon)
    }
}

pub(crate) fn parse_hwnd(hwnd_text: &str) -> Option<HWND> {
    let trimmed = hwnd_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let raw_value = if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        usize::from_str_radix(hex, 16).ok()?
    } else {
        trimmed.parse::<usize>().ok()?
    };

    if raw_value == 0 {
        None
    } else {
        Some(HWND(raw_value as *mut core::ffi::c_void))
    }
}

unsafe fn query_window_icon_handle(hwnd: HWND) -> Option<HICON> {
    for icon_type in [ICON_BIG, ICON_SMALL2, ICON_SMALL] {
        let mut message_result = 0usize;
        let response = SendMessageTimeoutW(
            hwnd,
            WM_GETICON,
            WPARAM(icon_type as usize),
            LPARAM(0),
            SMTO_BLOCK | SMTO_ABORTIFHUNG,
            100,
            Some(&mut message_result),
        );

        if response.0 != 0 && message_result != 0 {
            return Some(HICON(message_result as *mut core::ffi::c_void));
        }
    }

    let class_icon = GetClassLongPtrW(hwnd, GCLP_HICON);
    if class_icon != 0 {
        return Some(HICON(class_icon as *mut core::ffi::c_void));
    }

    let class_small_icon = GetClassLongPtrW(hwnd, GCLP_HICONSM);
    if class_small_icon != 0 {
        return Some(HICON(class_small_icon as *mut core::ffi::c_void));
    }

    None
}

unsafe fn hicon_to_base64(hicon: HICON) -> Option<String> {
    let mut icon_info = std::mem::zeroed();
    if GetIconInfo(hicon, &mut icon_info).is_err() {
        return None;
    }
    let _mask_bitmap = OwnedBitmap::new(icon_info.hbmMask);
    let color_bitmap = OwnedBitmap::new(icon_info.hbmColor)?;

    bitmap_to_base64(color_bitmap.raw())
}

pub(crate) fn owned_hbitmap_to_base64(bitmap: HBITMAP) -> Option<String> {
    let bitmap = OwnedBitmap::new(bitmap)?;
    unsafe { bitmap_to_base64(bitmap.raw()) }
}

unsafe fn bitmap_to_base64(bitmap: HBITMAP) -> Option<String> {
    // GetObjectA works for BITMAP (no string fields, identical to W variant)
    let mut bm: BITMAP = std::mem::zeroed();
    let got = GetObjectA(
        bitmap.into(),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut _ as *mut _),
    );
    if got == 0 {
        return None;
    }

    let width = bm.bmWidth as u32;
    let height = bm.bmHeight.unsigned_abs();
    if width == 0 || height == 0 || width > 512 || height > 512 {
        return None;
    }

    let hdc = ScreenDcGuard::new(None, GetDC(None))?;
    let mem_dc = MemoryDcGuard::new(CreateCompatibleDC(Some(hdc.raw())))?;

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..std::mem::zeroed()
        },
        ..std::mem::zeroed()
    };

    let mut pixels: Vec<u8> = vec![0u8; (width * height * 4) as usize];
    let lines = GetDIBits(
        mem_dc.raw(),
        bitmap,
        0,
        height,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    if lines == 0 {
        return None;
    }

    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    let img = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, pixels)?;
    let mut png_bytes = Cursor::new(Vec::new());
    img.write_to(&mut png_bytes, image::ImageFormat::Png).ok()?;

    let b64 = STANDARD.encode(png_bytes.into_inner());
    Some(format!("data:image/png;base64,{}", b64))
}

fn read_icon_result_cache(cache_key: &str, now_ms: u64) -> Option<Option<String>> {
    let mut cache = icon_result_cache().lock().ok()?;
    let entry = cache.get(cache_key)?;

    if is_icon_result_cache_entry_fresh(entry, now_ms) {
        Some(entry.value.clone())
    } else {
        cache.remove(cache_key);
        None
    }
}

fn write_icon_result_cache(cache_key: String, value: Option<String>, now_ms: u64) {
    if let Ok(mut cache) = icon_result_cache().lock() {
        prune_expired_icon_result_cache(&mut cache, now_ms);
        cache.remove(&cache_key);
        let bytes = cache_key.len() + value.as_ref().map_or(0, String::len);
        if bytes > ICON_RESULT_CACHE_MAX_BYTES {
            return;
        }
        while cache.len() >= ICON_RESULT_CACHE_MAX_ENTRIES
            || icon_cache_bytes(&cache) + bytes > ICON_RESULT_CACHE_MAX_BYTES
        {
            if let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.cached_at_ms)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest_key);
            }
        }

        cache.insert(
            cache_key,
            IconResultCacheEntry {
                cached_at_ms: now_ms,
                value,
            },
        );
    }
}

fn icon_cache_bytes(cache: &HashMap<String, IconResultCacheEntry>) -> usize {
    cache
        .iter()
        .map(|(key, entry)| key.len() + entry.value.as_ref().map_or(0, String::len))
        .sum()
}

fn is_icon_result_cache_entry_fresh(entry: &IconResultCacheEntry, now_ms: u64) -> bool {
    let ttl_ms = if entry.value.is_some() {
        ICON_RESULT_CACHE_TTL_MS
    } else {
        ICON_RESULT_NEGATIVE_CACHE_TTL_MS
    };

    now_ms >= entry.cached_at_ms && now_ms.saturating_sub(entry.cached_at_ms) <= ttl_ms
}

fn prune_expired_icon_result_cache(cache: &mut HashMap<String, IconResultCacheEntry>, now_ms: u64) {
    cache.retain(|_, entry| is_icon_result_cache_entry_fresh(entry, now_ms));
}

fn icon_result_cache() -> &'static Mutex<HashMap<String, IconResultCacheEntry>> {
    static ICON_RESULT_CACHE: OnceLock<Mutex<HashMap<String, IconResultCacheEntry>>> =
        OnceLock::new();
    ICON_RESULT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn icon_result_cache_stats() -> IconResultCacheStats {
    let (entries, positive_entries, negative_entries, estimated_bytes) = icon_result_cache()
        .lock()
        .map(|mut cache| {
            prune_expired_icon_result_cache(&mut cache, now_ms());
            let entries = cache.len();
            let positive_entries = cache.values().filter(|entry| entry.value.is_some()).count();
            (
                entries,
                positive_entries,
                entries.saturating_sub(positive_entries),
                icon_cache_bytes(&cache),
            )
        })
        .unwrap_or((0, 0, 0, 0));

    IconResultCacheStats {
        estimated_bytes,
        max_bytes: ICON_RESULT_CACHE_MAX_BYTES,
        entries,
        positive_entries,
        negative_entries,
        max_entries: ICON_RESULT_CACHE_MAX_ENTRIES,
        ttl_ms: ICON_RESULT_CACHE_TTL_MS,
        negative_ttl_ms: ICON_RESULT_NEGATIVE_CACHE_TTL_MS,
    }
}

fn now_ms() -> u64 {
    crate::patina::platform::clock::unix_timestamp_millis_u64()
}

#[cfg(test)]
#[path = "icon_mod_tests.rs"]
mod tests;
