//! 手柄「发快捷键」（[0.13]）：把一串虚拟键码按顺序按下、再逆序抬起。
//!
//! ## 为什么这里不做解析
//!
//! 「Ctrl+Shift+M」→ VK 序列的映射只在前端 `src/windows/timing/lib/hotkey.ts` 一处。
//! 后端如果也认键名，就会有两份键名表：前端认、后端不认（或反过来）时，症状是
//! 「录制成功、按下不发」，而两端日志都干净。这里只吃 `[u16]`，纯机械执行。
//!
//! ## 为什么要「抢回前台」
//!
//! 手柄点下去会激活**我们自己的**窗口（药丸 `focus:false` 只影响启动，鼠标按下仍会激活），
//! 于是按键被 `SendInput` 发给了 Timing 自己 —— 用户看到的是「点了没反应」。
//! 所以发送前若发现前台是本进程的窗口，就用追踪引擎顺手记下的「最近一个**外部**前台窗口」
//! （`remember_foreign_foreground`，由 `get_active_window_native` 每次观测时更新）抢回来。
//!
//! `SetForegroundWindow` 受 Windows 前台锁定策略限制，可能被拒；被拒时仍然照发 ——
//! 猜测前台失败最多是「这次没生效」，而不发一定是没生效。

/// 一次最多发多少个键。`Ctrl+Alt+Shift+Win+F12` 是 5 个，8 是留足余量的硬上限
/// （防手改配置塞进几百个键把输入队列打满）。
pub const MAX_KEYS: usize = 8;

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};

    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    /// 最近一次观测到的**外部**前台窗口。0 = 还没观测到过。
    static LAST_FOREIGN_FOREGROUND: AtomicIsize = AtomicIsize::new(0);

    /// 由追踪引擎在每次前台观测时调用（同一线程高频调用，只做一次 relaxed store）。
    pub fn remember_foreign_foreground(hwnd: isize) {
        if hwnd != 0 {
            LAST_FOREIGN_FOREGROUND.store(hwnd, Ordering::Relaxed);
        }
    }

    /// 只给单测看：验证「0 不覆盖上一次的真实值」。
    #[cfg(test)]
    pub fn peek_foreign_foreground() -> isize {
        LAST_FOREIGN_FOREGROUND.load(Ordering::Relaxed)
    }

    fn belongs_to_this_process(hwnd: HWND) -> bool {
        if hwnd.0.is_null() {
            return false;
        }
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&raw mut pid));
        }
        pid != 0 && pid == unsafe { GetCurrentProcessId() }
    }

    /// 前台若停在我们自己的窗口上，把「最近的外部前台」抢回来；抢不到就算了。
    fn ensure_external_foreground() {
        let current = unsafe { GetForegroundWindow() };
        if !belongs_to_this_process(current) {
            return;
        }
        let last = LAST_FOREIGN_FOREGROUND.load(Ordering::Relaxed);
        if last == 0 {
            return;
        }
        unsafe {
            let _ = SetForegroundWindow(HWND(last as *mut core::ffi::c_void));
        }
    }

    fn key_input(vk: u16, release: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if release {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn send(vks: &[u16]) -> Result<(), String> {
        if vks.is_empty() {
            return Err("没有要发送的按键".to_string());
        }
        if vks.len() > super::MAX_KEYS {
            return Err(format!("一次最多发送 {} 个按键", super::MAX_KEYS));
        }
        // 真正发键（`SendInput`）不写单测：它会往当前前台窗口注入按键，
        // 在 CI / 开发机上跑等于随机敲别人的窗口。可测的是上面两条拒绝分支。
        ensure_external_foreground();

        /* 按下：修饰键在前（前端已排好序）；抬起：**逆序**。反过来会让 Ctrl 先松手，
           目标应用收到的是「M」而不是「Ctrl+M」。 */
        let mut inputs: Vec<INPUT> = Vec::with_capacity(vks.len() * 2);
        for vk in vks {
            inputs.push(key_input(*vk, false));
        }
        for vk in vks.iter().rev() {
            inputs.push(key_input(*vk, true));
        }

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            /* UIPI：目标窗口权限更高（以管理员运行）时按键会被静默丢弃 */
            return Err("快捷键没能发出去（目标窗口权限更高？）".to_string());
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn remember_foreign_foreground(_hwnd: isize) {}

    pub fn send(_vks: &[u16]) -> Result<(), String> {
        Err("当前平台不支持发送快捷键".to_string())
    }
}

pub use imp::{remember_foreign_foreground, send};

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{remember_foreign_foreground, send, MAX_KEYS};

    #[test]
    fn hs01_empty_sequence_is_rejected() {
        assert!(send(&[]).is_err(), "空序列必须拒绝 —— 后端不该把「没有键」当成一次成功的注入");
    }

    #[test]
    fn hs02_more_keys_than_the_cap_is_rejected() {
        /* 手改配置塞进几百个键会把输入队列打满；上限存在的意义就是这一条 */
        let too_many = vec![0x11u16; MAX_KEYS + 1];
        let err = send(&too_many).err().unwrap_or_default();
        assert!(err.contains(&MAX_KEYS.to_string()), "提示里要说出上限是多少：{err}");
    }

    #[test]
    fn hs03_remembering_zero_does_not_clobber_the_last_real_window() {
        /* 0 是「还没观测到」的哨兵。允许它覆盖的话，一次空桌面的轮询就会让下一发快捷键
           失去抢回前台的目标（表现为偶发「点了没反应」）。 */
        remember_foreign_foreground(42);
        remember_foreign_foreground(0);
        assert_eq!(super::imp::peek_foreign_foreground(), 42);
    }
}
