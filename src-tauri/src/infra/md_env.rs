//! Markdown 落点的环境变量展开（V0.11.6，ADR-050 §5）。
//!
//! 从 `infra/md_file.rs` 整段搬出来（那里已 298/300 行，塞不下 `%APP_DIR%` 分支），
//! `md_file` 保留 `pub use crate::infra::md_env::expand_env;`，外部调用点路径不变。
//!
//! ## 解析顺序（不能换）
//!
//! 1. `%APP_DIR%`（**保留名**，永不查环境变量）→ 数据根绝对路径；
//! 2. 开头的 `~` → `%USERPROFILE%` / `$HOME`；
//! 3. `%VAR%` → 环境变量，未知变量**原样保留**（让路径错误可诊断）。
//!
//! 为什么 `%APP_DIR%` 必须先于 `%VAR%`：用户机器上恰好存在一个叫 `APP_DIR` 的
//! 环境变量时，先走 `%VAR%` 就会被劫持到任意目录——一个「应用自己写进去的默认值」
//! 被外部环境改写，是最难查的一类故障。
//!
//! 为什么永不返回未替换的占位符：`resolve_path` 会拿结果去 `create_dir_all`，
//! 于是 CWD 下会长出一棵叫 `%APP_DIR%` 的目录树，比直接报错难查十倍。

/// 数据根占位符。**不在本文件定义第二份**：`platform::app_dir::TOKEN` 是唯一口径。
const APP_DIR_TOKEN: &str = crate::platform::app_dir::TOKEN;

/// 展开 `%APP_DIR%` / `%USERPROFILE%` 与开头的 `~`；未知变量原样保留。
pub fn expand_env(raw: &str) -> String {
    let text = raw.trim().replace(APP_DIR_TOKEN, &app_dir_value());
    expand_vars(&text)
}

/// 数据根的绝对路径。`data_root()` 自带兜底（`%APPDATA%\com.timing.app`），
/// 因此这里**永远**返回具体路径，不会漏出占位符。
fn app_dir_value() -> String {
    crate::platform::app_dir::data_root()
        .to_string_lossy()
        .to_string()
}

/// 原来的 `expand_env`（`~` 与 `%VAR%`），逐字保留语义。
fn expand_vars(raw: &str) -> String {
    let mut text = raw.to_string();
    if text == "~" || text.starts_with("~\\") || text.starts_with("~/") {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            text = format!("{}{}", home, &text[1..]);
        }
    }

    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        let mut name = String::new();
        let mut closed = false;
        for next in chars.by_ref() {
            if next == '%' {
                closed = true;
                break;
            }
            name.push(next);
        }
        if closed {
            match std::env::var(&name) {
                Ok(value) => out.push_str(&value),
                Err(_) => {
                    out.push('%');
                    out.push_str(&name);
                    out.push('%');
                }
            }
        } else {
            out.push('%');
            out.push_str(&name);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_dir_token_expands_to_absolute_path() {
        let got = expand_env(&format!("{APP_DIR_TOKEN}\\md"));
        assert!(!got.contains('%'), "不允许留下占位符：{got}");
        assert!(got.ends_with("\\md") || got.ends_with("/md"), "{got}");
        /* 展开结果必须与数据根同源：这条断言把「占位符 → 数据根」钉死。 */
        assert!(got.starts_with(&app_dir_value()), "{got}");
    }

    #[test]
    fn unknown_var_is_kept_verbatim() {
        assert_eq!(
            expand_env("%TIMING_NO_SUCH_VAR%\\x"),
            "%TIMING_NO_SUCH_VAR%\\x"
        );
    }

    #[test]
    fn tilde_expands() {
        let got = expand_env("~\\md");
        assert!(!got.starts_with('~'), "{got}");
    }
}
