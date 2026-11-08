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
//!
//! ## `\` 只在 Windows 上是分隔符（[V0.11.26] 踩透）
//!
//! 出厂模板写的是 `%APP_DIR%\md-webdav`（先用的是 Windows，`\` 顺手）。Android 上
//! `data_root()` 是 `/data/user/0/com.timing.app`，展开后得到
//! `/data/user/0/com.timing.app\md-webdav`——**这是一整个路径分量**，父目录成了
//! `/data/user/0`（root 所有、应用不可写），`create_dir_all` 当场 `EACCES`（os error 13）。
//! 症状极具误导性：「测试连接」只碰网络（绿），同步一碰本地落点就红成
//! 「建不了云端落点目录」。
//!
//! 所以展开的最后一步把分隔符归一成本平台的分隔符，**判据是纯函数**
//! [`resolve_template`]（`mobile` 是参数而不是 `cfg!`），桌面目标上的用例也能验手机那一支。

/// 数据根占位符。**不在本文件定义第二份**：`platform::app_dir::TOKEN` 是唯一口径。
const APP_DIR_TOKEN: &str = crate::platform::app_dir::TOKEN;

/// 展开 `%APP_DIR%` / `%USERPROFILE%` 与开头的 `~`；未知变量原样保留。
pub fn expand_env(raw: &str) -> String {
    resolve_template(raw, &app_dir_value(), cfg!(mobile))
}

/// [`expand_env`] 的可注入版本：`app_dir` 由调用方给、`mobile` 由调用方说，
/// 于是「Android 上落点到底长什么样」在桌面目标上也能断言（见文件头 §`\` 只在 Windows 上）。
///
/// 顺序仍不可换：先 `%APP_DIR%`（保留名）、再 `~` / `%VAR%`、最后归一分隔符。
pub fn resolve_template(raw: &str, app_dir: &str, mobile: bool) -> String {
    let text = raw.trim().replace(APP_DIR_TOKEN, app_dir);
    normalize_separators(expand_vars(&text), mobile)
}

/// 把 Windows 风格的分隔符换成本平台的分隔符（只在非 Windows 上动手）。
///
/// **不能无条件替换**：Windows 的绝对路径就是 `C:\...`，换掉会让 `Path` 的字符串形态
/// 与用户填的、日志里记的不一致（同一目录写成两种样子，排查时对不上）。
/// 反过来 POSIX 上 `\` 是合法文件名字符，没有任何正当理由让它留在路径分隔位置上。
pub fn normalize_separators(text: String, mobile: bool) -> String {
    if mobile {
        text.replace('\\', "/")
    } else {
        text
    }
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

    /* ---- [V0.11.26] 分隔符：手机点同步报「建不了云端落点目录 permission denied」的根因 ---- */

    /// 出厂模板在 Android 上必须落成**数据根的直接子目录**。
    ///
    /// 反例（修复前的实际行为）：`\` 不被当成分隔符，整个 `com.timing.app\md-webdav`
    /// 是一个路径分量，父目录变成 `/data/user/0`（root 所有、应用不可写）→ EACCES 13。
    #[test]
    fn cloud_root_on_posix_is_a_child_of_the_data_root() {
        let got = resolve_template(
            crate::models::md_sync_cloud::MD_SYNC_CLOUD_ROOT,
            "/data/user/0/com.timing.app",
            true,
        );
        assert_eq!(got, "/data/user/0/com.timing.app/md-webdav", "{got}");
        assert!(!got.contains('\\'), "POSIX 上不许留下反斜杠：{got}");
        /* 只有一段：父目录就是数据根本身，不是 `/data/user/0`。 */
        let path = std::path::Path::new(&got);
        assert_eq!(
            path.parent(),
            Some(std::path::Path::new("/data/user/0/com.timing.app")),
            "{got}"
        );
    }

    /// 同一份模板在桌面上**逐字不动**：Windows 的 `\` 本来就是分隔符，改了只会让
    /// 「我填的路径」与「日志里的路径」长得不一样。
    #[test]
    fn cloud_root_on_windows_keeps_backslash() {
        let got = resolve_template(
            crate::models::md_sync_cloud::MD_SYNC_CLOUD_ROOT,
            r"D:\Software\Timing\data",
            false,
        );
        assert_eq!(got, r"D:\Software\Timing\data\md-webdav", "{got}");
    }

    /// 用户自己填的根目录同样要归一（LocalFolder 模式那条路也走这个函数）。
    #[test]
    fn user_typed_root_is_normalized_too() {
        let got = resolve_template(r"%APP_DIR%\我的日记\md", "/data/user/0/com.timing.app", true);
        assert_eq!(got, "/data/user/0/com.timing.app/我的日记/md", "{got}");
    }
}
