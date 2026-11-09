use tauri::{Runtime, WebviewWindow};
use windows::Win32::Foundation::{
    GetLastError, SetLastError, ERROR_SUCCESS, HWND, LPARAM, LRESULT, RECT, WPARAM,
};
use windows::Win32::Graphics::Gdi::{
    CreateRectRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn, HRGN, SIMPLEREGION,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetWindowLongPtrW, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, ShowWindowAsync, GWL_STYLE, HWND_TOP, STYLESTRUCT,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW, WM_NCACTIVATE, WM_NCDESTROY, WM_NCPAINT, WM_STYLECHANGING,
    WS_CAPTION,
};

const CAPTIONLESS_SUBCLASS_ID: usize = 1;

pub(crate) fn install_captionless_frame<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let hwnd = native_hwnd(window)?.0 as usize;
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    // Subclass installation must run on the thread that owns the HWND, before show().
    window
        .run_on_main_thread(move || {
            let _ = send.send(install_caption_guard(HWND(hwnd as *mut _)));
        })
        .map_err(|error| error.to_string())?;
    receive.recv().map_err(|error| error.to_string())?
}

fn install_caption_guard(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !SetWindowSubclass(
            hwnd,
            Some(captionless_frame_proc),
            CAPTIONLESS_SUBCLASS_ID,
            0,
        )
        .as_bool()
        {
            return Err("failed to install captionless frame handler".into());
        }
        if let Err(error) = clear_caption(hwnd) {
            let _ =
                RemoveWindowSubclass(hwnd, Some(captionless_frame_proc), CAPTIONLESS_SUBCLASS_ID);
            return Err(error);
        }
    }
    Ok(())
}

unsafe extern "system" fn captionless_frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _data: usize,
) -> LRESULT {
    unsafe {
        if message == WM_STYLECHANGING && wparam.0 as i32 == GWL_STYLE.0 && lparam.0 != 0 {
            // Tao rebuilds the native style on show/hide and other flag changes.
            // Keep its visibility and input flags, but never restore the caption.
            let style = &mut *(lparam.0 as *mut STYLESTRUCT);
            style.styleNew &= !WS_CAPTION.0;
        } else if message == WM_NCACTIVATE {
            // Preserve Tao's activation/focus handling; -1 tells DefWindowProc
            // not to paint the system caption beneath the transparent WebView.
            return DefSubclassProc(hwnd, message, wparam, LPARAM(-1));
        } else if message == WM_NCPAINT {
            return LRESULT(0);
        } else if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(captionless_frame_proc), subclass_id);
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

fn clear_caption(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("window handle is no longer valid".into());
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let captionless = style & !(WS_CAPTION.0 as isize);
        if style == captionless {
            return Ok(());
        }
        // Tao retains WS_CAPTION on undecorated top-level windows. Mini has no
        // native frame; activation must not repaint it under transparent pixels.
        SetLastError(ERROR_SUCCESS);
        if SetWindowLongPtrW(hwnd, GWL_STYLE, captionless) == 0 && GetLastError() != ERROR_SUCCESS {
            return Err(format!(
                "failed to remove native caption: {}",
                GetLastError().0
            ));
        }
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
        .map_err(|error| format!("failed to refresh captionless frame: {error}"))
    }
}

pub(crate) fn position_without_activation<R: Runtime>(
    window: &WebviewWindow<R>,
    rect: crate::models::insight::window_geometry::PhysicalRect,
) -> Result<(), String> {
    let hwnd = native_hwnd(window)?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            rect.x,
            rect.y,
            rect.width as i32,
            rect.height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
        .map_err(|error| format!("failed to position window: {error}"))
    }
}

pub(crate) fn clip_without_activation<R: Runtime>(
    window: &WebviewWindow<R>,
    region: crate::models::insight::window_geometry::PhysicalRect,
) -> Result<(), String> {
    set_region(native_hwnd(window)?, region)
}

fn set_region(
    hwnd: HWND,
    region: crate::models::insight::window_geometry::PhysicalRect,
) -> Result<(), String> {
    let desired = RECT {
        left: region.x,
        top: region.y,
        right: region.x + region.width as i32,
        bottom: region.y + region.height as i32,
    };
    unsafe {
        let mut current = RECT::default();
        if GetWindowRgnBox(hwnd, &mut current) == SIMPLEREGION && current == desired {
            return Ok(());
        }
        let handle = CreateRectRgn(desired.left, desired.top, desired.right, desired.bottom);
        if handle.is_invalid() {
            return Err("failed to create window region".into());
        }
        let mut owned = WindowRegion(Some(handle));
        if SetWindowRgn(hwnd, Some(handle), true) == 0 {
            return Err("failed to apply window region".into());
        }
        // Windows owns a successfully applied region, including its replacement
        // and destruction. Failed calls leave ownership with the guard.
        owned.0 = None;
        Ok(())
    }
}

struct WindowRegion(Option<HRGN>);
impl Drop for WindowRegion {
    fn drop(&mut self) {
        if let Some(region) = self.0 {
            unsafe {
                let _ = DeleteObject(region.into());
            }
        }
    }
}

pub(crate) fn is_native_window_alive<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<bool, String> {
    let hwnd = native_hwnd(window)?;
    Ok(unsafe { !hwnd.0.is_null() && IsWindow(Some(hwnd)).as_bool() })
}

pub(crate) fn is_native_window_visible<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<bool, String> {
    let hwnd = native_hwnd(window)?;
    Ok(unsafe {
        !hwnd.0.is_null() && IsWindow(Some(hwnd)).as_bool() && IsWindowVisible(hwnd).as_bool()
    })
}

pub(crate) fn restore_to_foreground<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = native_hwnd(window)?;

    unsafe {
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() {
            return Err("window handle is no longer valid".to_string());
        }

        let show_command = if IsIconic(hwnd).as_bool() {
            SW_RESTORE
        } else {
            SW_SHOW
        };

        let _ = ShowWindowAsync(hwnd, show_command);
        let _ = ShowWindow(hwnd, show_command);

        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        .map_err(|error| format!("failed to bring window to top: {error}"))?;

        if !SetForegroundWindow(hwnd).as_bool() {
            BringWindowToTop(hwnd)
                .map_err(|error| format!("failed to bring window to foreground: {error}"))?;
        }

        if !IsWindowVisible(hwnd).as_bool() {
            return Err("native window stayed hidden after restore".to_string());
        }
    }

    Ok(())
}

fn native_hwnd<R: Runtime>(window: &WebviewWindow<R>) -> Result<HWND, String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to read native window handle: {error}"))?;

    Ok(HWND(hwnd.0.cast()))
}

#[cfg(test)]
#[path = "window_activation_mod_tests.rs"]
mod tests;
