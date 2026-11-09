//! `window_activation.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::models::insight::window_geometry::PhysicalRect;
use std::cell::Cell;
use windows::core::w;
use windows::Win32::System::Threading::{GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, GetForegroundWindow, GetWindowRect, SendMessageW,
    WINDOW_EX_STYLE, WM_SETFOCUS, WS_DISABLED, WS_POPUP, WS_SYSMENU,
};

struct HiddenWindow(HWND);
impl Drop for HiddenWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.0);
        }
    }
}

#[derive(Default)]
struct FrameMessages {
    activations: Cell<usize>,
    paints: Cell<usize>,
    focus: Cell<usize>,
}

unsafe extern "system" fn observe_frame_messages(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    unsafe {
        let observed = &*(data as *const FrameMessages);
        match message {
            WM_NCACTIVATE => {
                observed.activations.set(observed.activations.get() + 1);
                if lparam.0 != -1 {
                    observed.paints.set(observed.paints.get() + 1);
                }
            }
            WM_NCPAINT => observed.paints.set(observed.paints.get() + 1),
            WM_SETFOCUS => observed.focus.set(observed.focus.get() + 1),
            WM_NCDESTROY => {
                let _ = RemoveWindowSubclass(hwnd, Some(observe_frame_messages), id);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

#[test]
fn captionless_frame_preserves_focus_without_requesting_native_paint() {
    unsafe {
        let observed = Box::<FrameMessages>::default();
        let window = HiddenWindow(
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("Patina frame test"),
                WS_POPUP | WS_CAPTION | WS_SYSMENU,
                100,
                100,
                304,
                240,
                None,
                None,
                None,
                None,
            )
            .unwrap(),
        );
        assert!(SetWindowSubclass(
            window.0,
            Some(observe_frame_messages),
            1,
            &*observed as *const FrameMessages as usize
        )
        .as_bool());
        install_caption_guard(window.0).unwrap();
        observed.activations.set(0);
        observed.paints.set(0);
        observed.focus.set(0);
        for active in [1, 0, 1] {
            SendMessageW(
                window.0,
                WM_NCACTIVATE,
                Some(WPARAM(active)),
                Some(LPARAM(0)),
            );
        }
        SendMessageW(window.0, WM_NCPAINT, Some(WPARAM(1)), None);
        SendMessageW(window.0, WM_SETFOCUS, None, None);
        assert_eq!(
            observed.activations.get(),
            3,
            "framework must observe activation changes"
        );
        assert_eq!(
            observed.focus.get(),
            1,
            "framework must still deliver keyboard focus"
        );
        assert_eq!(
            observed.paints.get(),
            0,
            "custom frame must not request default titlebar painting"
        );
    }
}

#[test]
fn captionless_overlay_keeps_geometry_and_activation_without_a_native_frame() {
    unsafe {
        let window = HiddenWindow(
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("Patina caption test"),
                WS_POPUP | WS_CAPTION | WS_SYSMENU,
                100,
                100,
                304,
                240,
                None,
                None,
                None,
                None,
            )
            .unwrap(),
        );
        let mut before = RECT::default();
        GetWindowRect(window.0, &mut before).unwrap();
        let style = GetWindowLongPtrW(window.0, GWL_STYLE);
        assert_ne!(style & WS_CAPTION.0 as isize, 0);
        install_caption_guard(window.0).unwrap();
        install_caption_guard(window.0).unwrap();
        for active in [1, 0, 1] {
            // Tao rebuilds GWL_STYLE when visibility or other flags change.
            let next = style
                | if active == 0 {
                    WS_DISABLED.0 as isize
                } else {
                    0
                };
            SetWindowLongPtrW(window.0, GWL_STYLE, next);
            SendMessageW(
                window.0,
                WM_NCACTIVATE,
                Some(windows::Win32::Foundation::WPARAM(active)),
                None,
            );
            assert_eq!(
                GetWindowLongPtrW(window.0, GWL_STYLE),
                next & !(WS_CAPTION.0 as isize)
            );
        }
        let mut after = RECT::default();
        GetWindowRect(window.0, &mut after).unwrap();
        assert_eq!(before, after);
        assert_ne!(GetForegroundWindow(), window.0);
        assert!(!IsWindowVisible(window.0).as_bool());
        assert!(clear_caption(HWND::default()).is_err());
        assert!(install_caption_guard(HWND::default()).is_err());
        let hwnd = window.0;
        drop(window);
        assert!(!IsWindow(Some(hwnd)).as_bool());
    }
}

#[test]
fn region_changes_preserve_canvas_and_release_gdi_on_success_and_failure() {
    unsafe {
        let window = HiddenWindow(
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("Patina region test"),
                WS_POPUP,
                100,
                100,
                304,
                240,
                None,
                None,
                None,
                None,
            )
            .unwrap(),
        );
        let mut before = RECT::default();
        GetWindowRect(window.0, &mut before).unwrap();
        let full = PhysicalRect::new(0, 0, 304, 240);
        let bar = PhysicalRect::new(96, 0, 112, 24);
        set_region(window.0, bar).unwrap();
        let baseline = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
        for _ in 0..200 {
            set_region(window.0, full).unwrap();
            set_region(window.0, bar).unwrap();
            set_region(window.0, bar).unwrap();
            assert!(set_region(HWND::default(), bar).is_err());
        }
        let mut after = RECT::default();
        GetWindowRect(window.0, &mut after).unwrap();
        assert_eq!(before, after);
        let mut clip = RECT::default();
        assert_eq!(GetWindowRgnBox(window.0, &mut clip), SIMPLEREGION);
        assert_eq!(
            clip,
            RECT {
                left: 96,
                top: 0,
                right: 208,
                bottom: 24
            }
        );
        // Other parallel Rust tests may allocate resources in this process;
        // a leaked region per call would exceed this small allowance.
        assert!(GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) <= baseline + 16);
    }
}
