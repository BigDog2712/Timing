//! 结构化文件日志（零新增依赖）。
//!
//! ## 为什么不用 `tracing` / `log`
//!
//! 这个项目的发布配置是 `panic = "abort"` + `strip = true`：崩溃时既没有栈也没有符号。
//! 首要诉求不是「结构化查询」，而是**崩溃后能留下一条人可读的记录**。为此引入一整套
//! subscriber 生态收益很小，代价是多 3~5 个 crate 与一份需要持续跟的配置。
//! 自带的这 90 行只做四件事：分级、按天分文件、保留 7 天、panic 落盘。
//! 将来真要做结构化检索，把 `log()` 的下游换掉即可，调用点不用动。
//!
//! ## 用法
//!
//! ```ignore
//! use crate::{log_info, log_warn};
//! log_warn!("tray set_menu failed: {err}");
//! ```
//!
//! 级别由环境变量 `TIMING_LOG` 控制（`error|warn|info|debug`，默认 `info`）；
//! 旧名 `TICKBAR_LOG` 仍生效一个版本，命中时打一条 WARN 提示迁移。
//! 日志目录：`<app_data_dir>/logs/timing-YYYY-MM-DD.log`。
//! Debug 构建同时镜像到 stderr；Release 只落文件（stderr 在 GUI 下不可见）。

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

/// 日志级别（数值越大越啰嗦）。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    Error = 1,
    Warn = 2,
    Info = 3,
    Debug = 4,
}

impl Level {
    fn tag(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Warn => "WARN ",
            Level::Info => "INFO ",
            Level::Debug => "DEBUG",
        }
    }
}

/// 保留天数（超过即删）。
const KEEP_DAYS: i64 = 7;

static LEVEL: AtomicU8 = AtomicU8::new(Level::Info as u8);
static SINK: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

fn parse_level(raw: &str) -> Level {
    match raw.trim().to_ascii_lowercase().as_str() {
        "error" => Level::Error,
        "warn" | "warning" => Level::Warn,
        "debug" | "trace" => Level::Debug,
        _ => Level::Info,
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 删除超过 `KEEP_DAYS` 的日志文件（按文件修改时间，不解析文件名，避免格式变更后失效）。
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let cutoff =
        std::time::SystemTime::now() - std::time::Duration::from_secs(KEEP_DAYS as u64 * 86_400);
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t < cutoff)
            .unwrap_or(false);
        if old {
            let _ = fs::remove_file(&path);
        }
    }
}

/// 初始化日志：建目录、清理过期、打开当天文件、安装 panic hook。
///
/// 失败不致命——写不了日志也不能让应用起不来，退化为「只镜像 stderr」。
pub fn init(app_data_dir: &Path) {
    let dir = app_data_dir.join("logs");
    let _ = fs::create_dir_all(&dir);
    prune(&dir);
    let path = dir.join(format!("timing-{}.log", today()));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok();
    let _ = LOG_DIR.set(dir);
    let _ = SINK.set(Mutex::new(file));
    LEVEL.store(parse_level(&level_from_env()) as u8, Ordering::Relaxed);
    /* 旧环境变量只在「新名缺失」时生效，并且必须让用户知道要改：静默兼容会让
    `TICKBAR_LOG` 永远活着（PRD §5 的「旧名保留一个版本」不是保留到永远）。 */
    if std::env::var("TIMING_LOG").map_or(true, |v| v.is_empty())
        && std::env::var("TICKBAR_LOG").is_ok()
    {
        log(
            Level::Warn,
            "log",
            "TICKBAR_LOG 已弃用，请改用 TIMING_LOG（旧名保留一个版本）",
        );
    }
    install_panic_hook();
    log(
        Level::Info,
        "log",
        &format!(
            "---- Timing v{} start (level={:?}) ----",
            env!("CARGO_PKG_VERSION"),
            current_level()
        ),
    );
}

/// 日志级别来源：`TIMING_LOG` 优先，缺失/空串时回落旧名 `TICKBAR_LOG`。
fn level_from_env() -> String {
    match std::env::var("TIMING_LOG") {
        Ok(value) if !value.is_empty() => value,
        _ => std::env::var("TICKBAR_LOG").unwrap_or_default(),
    }
}

/// 当前生效级别。
pub fn current_level() -> Level {
    match LEVEL.load(Ordering::Relaxed) {
        1 => Level::Error,
        2 => Level::Warn,
        4 => Level::Debug,
        _ => Level::Info,
    }
}

/// 日志目录（诊断页展示用）。
pub fn log_dir() -> Option<&'static PathBuf> {
    LOG_DIR.get()
}

/// 写一条日志。线程安全；写失败静默（日志本身不可再抛）。
pub fn log(level: Level, target: &str, message: &str) {
    if level > current_level() {
        return;
    }
    let line = format!(
        "{} {} [{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        level.tag(),
        target,
        message
    );
    if let Some(sink) = SINK.get() {
        if let Ok(mut guard) = sink.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(line.as_bytes());
                let _ = file.flush();
            }
        }
    }
    if cfg!(debug_assertions) || level <= Level::Warn {
        eprint!("{line}");
    }
    /* [V0.11.11] Android：`stderr` 在 GUI 应用里不可见，日志只落私有目录；而 release 包
    `debuggable=false`，`adb run-as` 也读不到那个目录。于是真机上的故障只能靠用户截图
    复述——0.11.10 的「同步读不回」就是这么熬了几轮。镜像一份进 logcat 是唯一的出口。 */
    #[cfg(target_os = "android")]
    logcat::write(level, line.trim_end());
}

/// Android logcat 出口（tag `Timing`）。
///
/// 直接链 NDK 的 `liblog`，不引 crate：整个日志模块刻意零依赖（理由见模块头）。
/// 只在 Android 编译，桌面构建连这个符号都不存在。
#[cfg(target_os = "android")]
mod logcat {
    use std::ffi::{c_char, CString};

    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(prio: i32, tag: *const c_char, text: *const c_char) -> i32;
    }

    const ANDROID_LOG_DEBUG: i32 = 3;
    const ANDROID_LOG_INFO: i32 = 4;
    const ANDROID_LOG_WARN: i32 = 5;
    const ANDROID_LOG_ERROR: i32 = 6;

    pub fn write(level: super::Level, line: &str) {
        let prio = match level {
            super::Level::Error => ANDROID_LOG_ERROR,
            super::Level::Warn => ANDROID_LOG_WARN,
            super::Level::Info => ANDROID_LOG_INFO,
            super::Level::Debug => ANDROID_LOG_DEBUG,
        };
        /* 换行会让 logcat 把一条日志拆成多行，先压平；`\0` 会让 CString 构造失败。 */
        let text = line.replace(['\n', '\r', '\0'], " ");
        let (Ok(tag), Ok(text)) = (CString::new("Timing"), CString::new(text)) else {
            return;
        };
        /* 返回值是写入的字节数（失败为负）。日志本身不可再抛。 */
        unsafe {
            let _ = __android_log_write(prio, tag.as_ptr(), text.as_ptr());
        }
    }
}

/// panic hook：把 panic 信息与（可选的）回溯写到 `panic.log`，再交给默认 hook 打印。
///
/// `panic = "abort"` 下 hook 仍会先于 abort 执行，这是 release 版唯一能拿到的现场。
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<非字符串 panic payload>".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<未知位置>".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let record = format!(
            "{}\nPANIC at {location}\n{payload}\n\n{backtrace}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
        );
        log(
            Level::Error,
            "panic",
            &format!("panic at {location}: {payload}"),
        );
        if let Some(dir) = LOG_DIR.get() {
            if let Ok(mut f) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("panic.log"))
            {
                let _ = f.write_all(record.as_bytes());
                let _ = f.flush();
            }
        }
        default_hook(info);
    }));
}

#[macro_export]
macro_rules! log_error {
    ($($arg:tt)*) => {
        $crate::platform::log::log($crate::platform::log::Level::Error, module_path!(), &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_warn {
    ($($arg:tt)*) => {
        $crate::platform::log::log($crate::platform::log::Level::Warn, module_path!(), &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => {
        $crate::platform::log::log($crate::platform::log::Level::Info, module_path!(), &format!($($arg)*))
    };
}

#[macro_export]
macro_rules! log_debug {
    ($($arg:tt)*) => {
        $crate::platform::log::log($crate::platform::log::Level::Debug, module_path!(), &format!($($arg)*))
    };
}
