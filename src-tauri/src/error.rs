//! 统一错误模型：V0.1.0 的 11 个 + V0.2.0 新增 5 个（IPC-CONTRACT-v2 §2 / Spec §5.2）。
//! `AppError` 序列化为 `{ "code": "...", "message": "..." }`，无 panic 泄漏。

use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

/// 统一错误码（V0.1.0 的 11 + V0.2.0 新增 5，共 16）。
///
/// V0.2.0 五码已全部接线（`TODO_NOT_FOUND` 随待办域；`NOTE_NOT_FOUND` /
/// `WINDOW_LIMIT_EXCEEDED` / `INVALID_TARGET_SEC` 随批 2 便利贴与倒计时；
/// `INVALID_COLOR` 随主题域）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    DbError,
    ItemNotFound,
    ItemNameEmpty,
    ItemNameDuplicate,
    ItemSystemProtected,
    TimerAlreadyRunning,
    TimerNotRunning,
    TimerNoUndo,
    ShortcutRegisterFailed,
    InvalidDuration,
    IoError,
    /* [V0.2.0] */
    NoteNotFound,
    TodoNotFound,
    WindowLimitExceeded,
    InvalidTargetSec,
    InvalidColor,
}

impl ErrorCode {
    /// 序列化用的字符串值（与 domain.ts `ErrorCode` 一一对应）。
    pub const fn as_str(self) -> &'static str {
        match self {
            ErrorCode::DbError => "DB_ERROR",
            ErrorCode::ItemNotFound => "ITEM_NOT_FOUND",
            ErrorCode::ItemNameEmpty => "ITEM_NAME_EMPTY",
            ErrorCode::ItemNameDuplicate => "ITEM_NAME_DUPLICATE",
            ErrorCode::ItemSystemProtected => "ITEM_SYSTEM_PROTECTED",
            ErrorCode::TimerAlreadyRunning => "TIMER_ALREADY_RUNNING",
            ErrorCode::TimerNotRunning => "TIMER_NOT_RUNNING",
            ErrorCode::TimerNoUndo => "TIMER_NO_UNDO",
            ErrorCode::ShortcutRegisterFailed => "SHORTCUT_REGISTER_FAILED",
            ErrorCode::InvalidDuration => "INVALID_DURATION",
            ErrorCode::IoError => "IO_ERROR",
            ErrorCode::NoteNotFound => "NOTE_NOT_FOUND",
            ErrorCode::TodoNotFound => "TODO_NOT_FOUND",
            ErrorCode::WindowLimitExceeded => "WINDOW_LIMIT_EXCEEDED",
            ErrorCode::InvalidTargetSec => "INVALID_TARGET_SEC",
            ErrorCode::InvalidColor => "INVALID_COLOR",
        }
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 应用错误：错误码 + 人类可读描述。
#[derive(Debug, thiserror::Error)]
#[error("{code}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn db(err: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::DbError, format!("数据库操作失败: {err}"))
    }

    pub fn io(err: impl std::fmt::Display) -> Self {
        Self::new(ErrorCode::IoError, format!("系统调用失败: {err}"))
    }

    pub fn item_not_found() -> Self {
        Self::new(ErrorCode::ItemNotFound, "事项不存在或已删除")
    }

    pub fn item_name_empty() -> Self {
        Self::new(ErrorCode::ItemNameEmpty, "事项名称不能为空")
    }

    pub fn item_name_duplicate(name: &str) -> Self {
        Self::new(
            ErrorCode::ItemNameDuplicate,
            format!("已存在同名事项「{name}」"),
        )
    }

    pub fn item_system_protected() -> Self {
        Self::new(
            ErrorCode::ItemSystemProtected,
            "系统事项「未归类」不可删除或归档",
        )
    }

    pub fn timer_already_running() -> Self {
        Self::new(ErrorCode::TimerAlreadyRunning, "已有进行中的计时会话")
    }

    pub fn timer_not_running() -> Self {
        Self::new(ErrorCode::TimerNotRunning, "当前无进行中的计时会话")
    }

    pub fn timer_no_undo() -> Self {
        Self::new(ErrorCode::TimerNoUndo, "撤销窗口已过期或记录不可撤销")
    }

    pub fn invalid_duration() -> Self {
        Self::new(ErrorCode::InvalidDuration, "结束时间早于开始时间")
    }

    /// [V0.2.0] 待办不存在或已软删除（`todo_update` / `todo_toggle`）。
    pub fn todo_not_found() -> Self {
        Self::new(ErrorCode::TodoNotFound, "待办不存在或已删除")
    }

    /// [V0.2.0] 便利贴不存在或已软删除（`note_get` / `note_update` 等）。
    pub fn note_not_found() -> Self {
        Self::new(ErrorCode::NoteNotFound, "便利贴不存在或已删除")
    }

    /// [V0.2.0] 便利贴窗口数达上限（20，K-14）。
    pub fn window_limit_exceeded(limit: usize) -> Self {
        Self::new(
            ErrorCode::WindowLimitExceeded,
            format!("便利贴数量已达上限（{limit} 张）"),
        )
    }

    /// [V0.2.0] 倒计时目标秒数非法（≤0 或 >24h）。
    pub fn invalid_target_sec() -> Self {
        Self::new(
            ErrorCode::InvalidTargetSec,
            "倒计时时长非法，须大于 0 且不超过 24 小时",
        )
    }

    /// [V0.2.0] 四色入参非法 hex（须为 `#RRGGBB`）。
    pub fn invalid_color() -> Self {
        Self::new(ErrorCode::InvalidColor, "颜色值非法，须为 #RRGGBB 格式")
    }

    /// [P1] 全局快捷键注册失败（热键被占用 / 加速键非法）。
    #[allow(dead_code)]
    pub fn shortcut_failed(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::ShortcutRegisterFailed, msg)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code.as_str())?;
        state.serialize_field("message", &self.message)?;
        state.end()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::db(err)
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::io(err)
    }
}

/// 命令统一返回类型。
pub type AppResult<T> = Result<T, AppError>;
