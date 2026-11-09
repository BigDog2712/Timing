use super::{icon, packaged_app};
#[cfg(test)]
mod resource_tests;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FOLDERID_AppsFolder, IShellItem, IShellItemImageFactory, SHCreateItemInKnownFolder,
    KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};

const VERSION_INFO_NAME_KEYS: [&str; 3] = ["FileDescription", "ProductName", "CompanyName"];
const SHELL_ICON_SIZE: i32 = 64;
const SHELL_PRESENTATION_CACHE_MAX_ENTRIES: usize = 128;
const SHELL_PRESENTATION_CACHE_MAX_BYTES: usize = 16 * 1024 * 1024;
const SHELL_PRESENTATION_CACHE_TTL_MS: u64 = 10 * 60 * 1000;
const SHELL_PRESENTATION_PARTIAL_CACHE_TTL_MS: u64 = 30 * 1000;
const VERSION_INFO_MAX_BYTES: u32 = 4 * 1024 * 1024;

#[derive(Clone)]
struct ShellValueCacheEntry {
    value: Option<String>,
    cached_at_ms: u64,
}

#[derive(Clone, Copy)]
enum ShellPresentationKind {
    DisplayName,
    Icon,
}

struct ComApartmentGuard {
    owns_initialization: bool,
}

impl ComApartmentGuard {
    fn initialize() -> Option<Self> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            Some(Self {
                owns_initialization: true,
            })
        } else if result == RPC_E_CHANGED_MODE {
            Some(Self {
                owns_initialization: false,
            })
        } else {
            None
        }
    }
}

impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        if self.owns_initialization {
            unsafe { CoUninitialize() };
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct LangAndCodePage {
    language: u16,
    code_page: u16,
}

pub fn resolve_process_display_name(process_path: &str) -> Option<String> {
    super::native_probe::name(process_path, "")
}

fn resolve_process_display_name_native(process_path: &str) -> Option<String> {
    if process_path.trim().is_empty() {
        return None;
    }

    let path_wide: Vec<u16> = OsStr::new(process_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut handle = 0u32;
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(path_wide.as_ptr()), Some(&mut handle)) };
    if size == 0 || size > VERSION_INFO_MAX_BYTES {
        return None;
    }

    let mut version_data = vec![0u8; size as usize];
    unsafe {
        GetFileVersionInfoW(
            PCWSTR(path_wide.as_ptr()),
            Some(0),
            size,
            version_data.as_mut_ptr().cast(),
        )
        .ok()?;
    }

    for (language, code_page) in iter_version_translations(&version_data) {
        for key in VERSION_INFO_NAME_KEYS {
            if let Some(value) = query_version_string(&version_data, language, code_page, key) {
                if !value.trim().is_empty() {
                    return Some(value);
                }
            }
        }
    }

    None
}

pub fn resolve_app_display_name(process_path: &str, app_user_model_id: &str) -> Option<String> {
    super::native_probe::name(process_path, app_user_model_id)
}

pub(super) fn resolve_app_display_name_native(
    process_path: &str,
    app_user_model_id: &str,
) -> Option<String> {
    select_display_name(resolve_shell_app_display_name(app_user_model_id), || {
        resolve_process_display_name_native(process_path)
    })
}

pub fn resolve_icon_base64(
    process_id: u32,
    process_path: &str,
    exe_name: &str,
    app_user_model_id: &str,
    window_class: &str,
    root_owner_hwnd: &str,
    hwnd: &str,
) -> Option<String> {
    super::native_probe::icon(super::native_probe::IconRequest {
        process_id,
        process_path: process_path.to_owned(),
        exe_name: exe_name.to_owned(),
        app_user_model_id: app_user_model_id.to_owned(),
        window_class: window_class.to_owned(),
        root_owner_hwnd: root_owner_hwnd.to_owned(),
        hwnd: hwnd.to_owned(),
    })
}

pub(super) fn resolve_icon_base64_native(
    process_id: u32,
    process_path: &str,
    exe_name: &str,
    app_user_model_id: &str,
    window_class: &str,
    root_owner_hwnd: &str,
    hwnd: &str,
) -> Option<String> {
    if !app_user_model_id.trim().is_empty() {
        return select_packaged_icon(
            resolve_shell_app_icon(app_user_model_id),
            || {
                resolve_icon_source_path(process_path, exe_name)
                    .and_then(|icon_source_path| icon::get_icon_base64(&icon_source_path))
            },
            || {
                icon::parse_hwnd(root_owner_hwnd)
                    .and_then(|root_owner_hwnd| {
                        packaged_app::find_descendant_window_for_process(
                            root_owner_hwnd,
                            process_id,
                        )
                    })
                    .and_then(|window| verified_window_icon(window, process_id, process_path))
            },
        );
    }

    let file_icon = resolve_icon_source_path(process_path, exe_name)
        .and_then(|icon_source_path| icon::get_icon_base64(&icon_source_path));
    if file_icon.is_some() || should_skip_window_icon_fallback(exe_name, window_class) {
        return file_icon;
    }

    [root_owner_hwnd, hwnd].into_iter().find_map(|value| {
        icon::parse_hwnd(value)
            .and_then(|window| verified_window_icon(window, process_id, process_path))
    })
}

fn verified_window_icon(
    window: windows::Win32::Foundation::HWND,
    process_id: u32,
    process_path: &str,
) -> Option<String> {
    if process_id == 0 || process_path.trim().is_empty() {
        return None;
    }
    let identity = || {
        let mut owner = 0;
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                window,
                Some(&mut owner),
            );
        }
        if owner != process_id {
            return None;
        }
        super::foreground::process_identity(owner)
            .filter(|(_, path)| path.eq_ignore_ascii_case(process_path))
    };
    verified_icon_read(identity, || icon::get_window_icon_base64_from_hwnd(window))
}

fn verified_icon_read(
    mut identity: impl FnMut() -> Option<(u64, String)>,
    read: impl FnOnce() -> Option<String>,
) -> Option<String> {
    let before = identity()?;
    let icon = read()?;
    (identity().as_ref() == Some(&before)).then_some(icon)
}

fn select_display_name(
    shell_display_name: Option<String>,
    file_display_name: impl FnOnce() -> Option<String>,
) -> Option<String> {
    shell_display_name
        .filter(|name| !name.trim().is_empty())
        .or_else(|| file_display_name().filter(|name| !name.trim().is_empty()))
}

fn select_packaged_icon(
    shell_icon: Option<String>,
    file_icon: impl FnOnce() -> Option<String>,
    app_window_icon: impl FnOnce() -> Option<String>,
) -> Option<String> {
    shell_icon.or_else(file_icon).or_else(app_window_icon)
}

fn resolve_shell_app_display_name(app_user_model_id: &str) -> Option<String> {
    resolve_shell_value(
        app_user_model_id,
        ShellPresentationKind::DisplayName,
        shell_display_name_cache(),
    )
}

fn resolve_shell_app_icon(app_user_model_id: &str) -> Option<String> {
    resolve_shell_value(
        app_user_model_id,
        ShellPresentationKind::Icon,
        shell_icon_cache(),
    )
}

fn resolve_shell_value(
    app_user_model_id: &str,
    kind: ShellPresentationKind,
    cache: &Mutex<HashMap<String, ShellValueCacheEntry>>,
) -> Option<String> {
    let cache_key = app_user_model_id.trim().to_ascii_lowercase();
    if cache_key.is_empty() {
        return None;
    }
    let now_ms = now_ms();
    if let Some(cached) = read_shell_value_cache(cache, &cache_key, now_ms) {
        return cached;
    }

    let value = super::native_probe::shell(
        app_user_model_id,
        matches!(kind, ShellPresentationKind::Icon),
    );
    write_shell_value_cache(cache, cache_key, value.clone(), now_ms);
    value
}

fn request_shell_value(app_user_model_id: &str, kind: ShellPresentationKind) -> Option<String> {
    // This runs inside the one-shot Shell helper. Keep the COM call on this STA so
    // the parent's deadline kills the actual work, not merely its waiter.
    #[cfg(test)]
    resource_tests::mark("before-com");
    let apartment = ComApartmentGuard::initialize()?;
    #[cfg(test)]
    resource_tests::mark("after-com");
    let value = resolve_shell_value_on_current_thread(app_user_model_id, kind);
    #[cfg(test)]
    resource_tests::mark("after-interfaces-drop");
    drop(apartment);
    #[cfg(test)]
    resource_tests::mark("after-com-uninitialize");
    value
}

pub(super) fn request_shell_value_native(app_user_model_id: &str, icon: bool) -> Option<String> {
    request_shell_value(
        app_user_model_id,
        if icon {
            ShellPresentationKind::Icon
        } else {
            ShellPresentationKind::DisplayName
        },
    )
}

fn resolve_shell_value_on_current_thread(
    app_user_model_id: &str,
    kind: ShellPresentationKind,
) -> Option<String> {
    let aumid_wide = OsStr::new(app_user_model_id)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let shell_item: IShellItem = unsafe {
        SHCreateItemInKnownFolder(
            &FOLDERID_AppsFolder,
            KF_FLAG_DEFAULT,
            PCWSTR(aumid_wide.as_ptr()),
        )
        .ok()?
    };
    #[cfg(test)]
    resource_tests::mark("after-shell-item");
    resolve_shell_item_value(shell_item, kind)
}

fn resolve_shell_item_value(shell_item: IShellItem, kind: ShellPresentationKind) -> Option<String> {
    match kind {
        ShellPresentationKind::DisplayName => {
            let value = unsafe { shell_item.GetDisplayName(SIGDN_NORMALDISPLAY) }.ok()?;
            let display_name = unsafe { value.to_string().ok() };
            unsafe { CoTaskMemFree(Some(value.0.cast())) };
            display_name.filter(|name| !name.trim().is_empty())
        }
        ShellPresentationKind::Icon => {
            let factory = shell_item.cast::<IShellItemImageFactory>().ok()?;
            #[cfg(test)]
            resource_tests::mark("after-factory");
            let bitmap = unsafe {
                factory
                    .GetImage(
                        SIZE {
                            cx: SHELL_ICON_SIZE,
                            cy: SHELL_ICON_SIZE,
                        },
                        SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
                    )
                    .ok()
            };
            #[cfg(test)]
            resource_tests::mark("after-image");
            drop(factory);
            #[cfg(test)]
            resource_tests::mark("after-factory-drop");
            let result = bitmap.and_then(icon::owned_hbitmap_to_base64);
            #[cfg(test)]
            resource_tests::mark("after-bitmap-dc-drop");
            result
        }
    }
}

fn read_shell_value_cache(
    cache: &Mutex<HashMap<String, ShellValueCacheEntry>>,
    cache_key: &str,
    now_ms: u64,
) -> Option<Option<String>> {
    let mut cache = cache.lock().ok()?;
    let entry = cache.get(cache_key)?;
    if is_shell_value_cache_entry_fresh(entry, now_ms) {
        Some(entry.value.clone())
    } else {
        cache.remove(cache_key);
        None
    }
}

fn write_shell_value_cache(
    cache: &Mutex<HashMap<String, ShellValueCacheEntry>>,
    cache_key: String,
    value: Option<String>,
    now_ms: u64,
) {
    if let Ok(mut cache) = cache.lock() {
        prune_shell_value_cache(&mut cache, now_ms);
        cache.remove(&cache_key);
        let bytes = cache_key.len() + value.as_ref().map_or(0, String::len);
        if bytes > SHELL_PRESENTATION_CACHE_MAX_BYTES {
            return;
        }
        while cache.len() >= SHELL_PRESENTATION_CACHE_MAX_ENTRIES
            || shell_cache_bytes(&cache) + bytes > SHELL_PRESENTATION_CACHE_MAX_BYTES
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
            ShellValueCacheEntry {
                value,
                cached_at_ms: now_ms,
            },
        );
    }
}

fn shell_cache_bytes(cache: &HashMap<String, ShellValueCacheEntry>) -> usize {
    cache
        .iter()
        .map(|(key, entry)| key.len() + entry.value.as_ref().map_or(0, String::len))
        .sum()
}

pub(super) fn shell_cache_stats() -> (usize, usize) {
    [shell_display_name_cache(), shell_icon_cache()]
        .into_iter()
        .filter_map(|cache| cache.try_lock().ok())
        .fold((0, 0), |(entries, bytes), cache| {
            (entries + cache.len(), bytes + shell_cache_bytes(&cache))
        })
}

fn is_shell_value_cache_entry_fresh(entry: &ShellValueCacheEntry, now_ms: u64) -> bool {
    let ttl_ms = if entry.value.is_some() {
        SHELL_PRESENTATION_CACHE_TTL_MS
    } else {
        SHELL_PRESENTATION_PARTIAL_CACHE_TTL_MS
    };
    now_ms >= entry.cached_at_ms && now_ms.saturating_sub(entry.cached_at_ms) <= ttl_ms
}

fn prune_shell_value_cache(cache: &mut HashMap<String, ShellValueCacheEntry>, now_ms: u64) {
    cache.retain(|_, entry| is_shell_value_cache_entry_fresh(entry, now_ms));
}

fn shell_display_name_cache() -> &'static Mutex<HashMap<String, ShellValueCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ShellValueCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn shell_icon_cache() -> &'static Mutex<HashMap<String, ShellValueCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ShellValueCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    crate::infra::insight::clock::unix_timestamp_millis_u64()
}

fn resolve_icon_source_path(process_path: &str, exe_name: &str) -> Option<String> {
    let trimmed_path = process_path.trim();
    if !trimmed_path.is_empty() {
        return Some(trimmed_path.to_string());
    }

    let exe = exe_name.trim();
    if exe.is_empty() {
        return None;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(
            Path::new(&local_app_data)
                .join("Microsoft")
                .join("WindowsApps")
                .join(exe),
        );
    }
    if let Ok(windows_dir) = std::env::var("WINDIR") {
        candidates.push(Path::new(&windows_dir).join("System32").join(exe));
        candidates.push(Path::new(&windows_dir).join(exe));
    }

    for path in candidates {
        if path.is_file() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    Some(exe.to_string())
}

fn should_skip_window_icon_fallback(exe_name: &str, window_class: &str) -> bool {
    exe_name.eq_ignore_ascii_case("explorer.exe")
        && !matches!(
            window_class.to_ascii_lowercase().as_str(),
            "cabinetwclass" | "explorewclass"
        )
}

fn iter_version_translations(version_data: &[u8]) -> Vec<(u16, u16)> {
    let mut translations = Vec::new();
    let translation_key: Vec<u16> = "\\VarFileInfo\\Translation"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut buffer_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut buffer_len = 0u32;

    let found_translation = unsafe {
        VerQueryValueW(
            version_data.as_ptr().cast(),
            PCWSTR(translation_key.as_ptr()),
            &mut buffer_ptr,
            &mut buffer_len,
        )
        .as_bool()
    };

    if found_translation
        && !buffer_ptr.is_null()
        && buffer_len >= std::mem::size_of::<LangAndCodePage>() as u32
    {
        let count = buffer_len as usize / std::mem::size_of::<LangAndCodePage>();
        let table =
            unsafe { std::slice::from_raw_parts(buffer_ptr as *const LangAndCodePage, count) };
        for entry in table {
            let pair = (entry.language, entry.code_page);
            if !translations.contains(&pair) {
                translations.push(pair);
            }
        }
    }

    for fallback in [(0x0804u16, 0x04B0u16), (0x0409u16, 0x04B0u16)] {
        if !translations.contains(&fallback) {
            translations.push(fallback);
        }
    }

    translations
}

fn query_version_string(
    version_data: &[u8],
    language: u16,
    code_page: u16,
    key: &str,
) -> Option<String> {
    let query_path = format!(
        "\\StringFileInfo\\{:04X}{:04X}\\{}",
        language, code_page, key
    );
    let query_wide: Vec<u16> = query_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut value_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut value_len = 0u32;

    let found = unsafe {
        VerQueryValueW(
            version_data.as_ptr().cast(),
            PCWSTR(query_wide.as_ptr()),
            &mut value_ptr,
            &mut value_len,
        )
        .as_bool()
    };
    if !found || value_ptr.is_null() || value_len == 0 {
        return None;
    }

    let raw_slice =
        unsafe { std::slice::from_raw_parts(value_ptr as *const u16, value_len as usize) };
    let value = String::from_utf16_lossy(raw_slice);
    let trimmed = value.trim_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
#[path = "app_metadata_mod_tests.rs"]
mod tests;
