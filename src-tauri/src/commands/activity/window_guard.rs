use tauri::{Runtime, WebviewWindow};

use crate::commands::activity::error::CommandErrorDto;

const MAIN_WINDOW_ACCESS_DENIED_CODE: &str = "MAIN_WINDOW_ACCESS_DENIED";
const MAIN_WINDOW_ACCESS_DENIED_MESSAGE: &str =
    "This operation is only available from the main application window.";

pub fn require_main_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), CommandErrorDto> {
    require_main_window_label(window.label())
}

pub fn require_main_window_string<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    require_main_window(window).map_err(|error| {
        serde_json::to_string(&error)
            .unwrap_or_else(|_| MAIN_WINDOW_ACCESS_DENIED_MESSAGE.to_string())
    })
}

fn require_main_window_label(label: &str) -> Result<(), CommandErrorDto> {
    if label == crate::app::activity::tray::ACTIVITY_WINDOW_LABEL {
        return Ok(());
    }

    Err(CommandErrorDto::new(
        MAIN_WINDOW_ACCESS_DENIED_CODE,
        MAIN_WINDOW_ACCESS_DENIED_MESSAGE,
        false,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_is_allowed() {
        /* 值锁用**字面量**，不引用 `ACTIVITY_WINDOW_LABEL`（设计 §6 原则）：
           引用常量的话，常量改错值时这条测试会跟着一起错——测试就成了同义反复。 */
        assert_eq!(require_main_window_label("activity"), Ok(()));
    }

    #[test]
    fn mini_and_unknown_windows_are_denied_without_leaking_context() {
        for label in ["mini", "unknown", "main-copy"] {
            let error = require_main_window_label(label).unwrap_err();
            assert_eq!(error.code, MAIN_WINDOW_ACCESS_DENIED_CODE);
            assert_eq!(error.message, MAIN_WINDOW_ACCESS_DENIED_MESSAGE);
            assert!(!error.retryable);
            assert!(!error.message.contains(label));
        }
    }
}
