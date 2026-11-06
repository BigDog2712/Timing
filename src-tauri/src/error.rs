//! 统一错误模型：V0.1.0 的 11 个 + V0.2.0 新增 5 个（IPC-CONTRACT-v2 §2 / Spec §5.2）。
//! `AppError` 序列化为 `{ "code": "...", "message": "..." }`，无 panic 泄漏。

use serde::ser::{SerializeStruct, Serializer};
use serde::Serialize;

/// 统一错误码（V0.1.0 的 11 + V0.2.0 新增 5 + V0.3.0 新增 1 − V0.3.1 下架 1
/// − V0.3.3 下架 1 + V0.4.0 新增 1 + V0.11.13 新增 1，共 17）。
///
/// V0.2.0 五码已全部接线（`TODO_NOT_FOUND` 随待办域；`NOTE_NOT_FOUND` /
/// `WINDOW_LIMIT_EXCEEDED` / `INVALID_TARGET_SEC` 随批 2 便利贴与倒计时；
/// `INVALID_COLOR` 随主题域）。
///
/// **V0.3.0 破例说明（ADR-018）**：此前「错误码集锁定 16 个、不得越权加第 17 码」，
/// 导致「文本超长」只能借用 `ITEM_NAME_EMPTY`——前端拿到「名称不能为空」的提示去修
/// 一个「名字太长」的问题，属于**语义错配**（表单会高亮到错误的分支）。V0.3.0 起
/// 增设 `ITEM_NAME_TOO_LONG`，把「空」与「超长」两类校验失败分开；闭集规则不变，
/// 只是基数从 16 变 17，新增仍须走一次契约评审。
///
/// **V0.3.1 下架 `ITEM_NAME_DUPLICATE`（ADR-021）**：事项改为允许同名，唯一性校验从
/// `services/item.rs` 整体移除，该码不再有触发点。**下架同样是一次契约变更**——闭集
/// 里留一个永远返回不了的码，等于给调用方假的失败契约。基数回到 16。
///
/// **V0.3.3 下架 `SHORTCUT_REGISTER_FAILED`（ADR-022）**：全局快捷键整体下线
/// （`register_shortcut` 命令、`infra/shortcuts.rs`、`Settings.shortcuts`、
/// `shortcut:triggered` 事件一并删除），该码不再有任何触发点。基数 16 → 15。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    DbError,
    ItemNotFound,
    ItemNameEmpty,
    ItemSystemProtected,
    TimerAlreadyRunning,
    TimerNotRunning,
    TimerNoUndo,
    InvalidDuration,
    IoError,
    /* [V0.2.0] */
    NoteNotFound,
    TodoNotFound,
    WindowLimitExceeded,
    InvalidTargetSec,
    InvalidColor,
    /* [V0.3.0] */
    ItemNameTooLong,
    /* [V0.4.0] */
    MdSyncConfigInvalid,
    /* [V0.11.13] */
    MdSyncRemoteError,
}

impl ErrorCode {
    /// 序列化用的字符串值（与 domain.ts `ErrorCode` 一一对应）。
    pub const fn as_str(self) -> &'static str {
        match self {
            ErrorCode::DbError => "DB_ERROR",
            ErrorCode::ItemNotFound => "ITEM_NOT_FOUND",
            ErrorCode::ItemNameEmpty => "ITEM_NAME_EMPTY",
            ErrorCode::ItemSystemProtected => "ITEM_SYSTEM_PROTECTED",
            ErrorCode::TimerAlreadyRunning => "TIMER_ALREADY_RUNNING",
            ErrorCode::TimerNotRunning => "TIMER_NOT_RUNNING",
            ErrorCode::TimerNoUndo => "TIMER_NO_UNDO",
            ErrorCode::InvalidDuration => "INVALID_DURATION",
            ErrorCode::IoError => "IO_ERROR",
            ErrorCode::NoteNotFound => "NOTE_NOT_FOUND",
            ErrorCode::TodoNotFound => "TODO_NOT_FOUND",
            ErrorCode::WindowLimitExceeded => "WINDOW_LIMIT_EXCEEDED",
            ErrorCode::InvalidTargetSec => "INVALID_TARGET_SEC",
            ErrorCode::InvalidColor => "INVALID_COLOR",
            ErrorCode::ItemNameTooLong => "ITEM_NAME_TOO_LONG",
            ErrorCode::MdSyncConfigInvalid => "MD_SYNC_CONFIG_INVALID",
            ErrorCode::MdSyncRemoteError => "MD_SYNC_REMOTE_ERROR",
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

    /// [V0.3.0] 文本字段超出上限（`ITEM_NAME_TOO_LONG`）。
    ///
    /// 参数化 `field` / `max` 是为了让三个调用点（事项名 / 待办标题 / 便利贴正文）
    /// 共用一条 message 模板，同时各自说清「哪个字段、多少字上限」——
    /// 前端拿到 code 后走「超长」分支，message 直接可展示，不必再拼。
    ///
    /// 建码动机见 `ErrorCode` 的 V0.3.0 破例说明与 `docs/decisions/ADR-018.md`。
    pub fn text_too_long(field: &str, max: usize) -> Self {
        Self::new(
            ErrorCode::ItemNameTooLong,
            format!("{field}长度不能超过 {max} 字"),
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

    /// [V0.4.0] Markdown 同步落点配置不合法（插件 API v2 / md-sync）。
    pub fn md_sync_config_invalid(message: impl Into<String>) -> Self {
        Self::new(
            ErrorCode::MdSyncConfigInvalid,
            format!("同步设置不合法：{}", message.into()),
        )
    }

    /// [V0.11.13] 云端通道走不通（`MD_SYNC_REMOTE_ERROR`，ADR-061）。
    ///
    /// `message` 由调用点写成人话，本构造器**不加前缀**：这条码覆盖的失败差得很远
    /// （系统凭据写不进、401、磁盘满、远端目录不存在），一句统一前缀只会把真正的
    /// 信息挤到后面。设置页对它的处理是「原样透出」，所以 message 就是用户看到的全部。
    pub fn md_sync_remote(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::MdSyncRemoteError, message)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        /* [V0.4.1] 这里是**命令错误回到前端的唯一收口**——65 条命令的 `Err` 都要经过
        一次序列化，所以日志只在这一处埋点就能覆盖全部 IPC 失败，不用在 65 个
        command 里各写一遍（写了也一定会漏）。

        分级口径（此前 0 条 ERROR 级日志，所有失败都是 WARN，真故障会被淹掉）：
        - 基础设施类（`DB_ERROR` / `IO_ERROR`）：用户看不出原因、必须留痕 → ERROR；
        - 业务校验类（找不到、名字为空、时长非法…）：界面已经给出明确提示 →
          只在 `TIMING_LOG=debug` 时记 DEBUG，避免把正常操作刷成告警。 */
        match self.code {
            ErrorCode::DbError | ErrorCode::IoError => {
                crate::log_error!("ipc {}: {}", self.code.as_str(), self.message)
            }
            _ => crate::log_debug!("ipc {}: {}", self.code.as_str(), self.message),
        }
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
