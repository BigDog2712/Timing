//! 云端通道的配置与视图结构（V0.11.13，ADR-061；V0.11.26 拆分后收窄为 legacy 读形）。
//!
//! 字段与 `src/types/domain/mdCloud.ts` 逐字对应，两个 serde 口径**不同**、都必须钉住：
//!
//! - `CloudMode` 用 `rename_all = "lowercase"` → `"localfolder"` / `"webdav"`。
//!   **不是** `"localFolder"`：前端写错不会编译报错，只会在保存后回读时得到
//!   `unknown variant` —— 用户看到的是「保存不了」，代码里看到的是一句 serde 错误；
//! - `MdSyncCloud` 用 `camelCase` → `localRoot` / `baseUrl` / `basePath`。
//!
//! ## [V0.11.26] 职责收窄：legacy 读形 + 测试载荷载体
//!
//! 双通路拆分后磁盘上的新保存形不再出现 `cloud` 键（`MdSyncConfig` 里
//! `skip_serializing_if`）。本结构只服务两件事：
//! 1. **老 JSON 反序列化入口**：`split_legacy`（`models/md_sync_channel.rs`）在
//!    `load()` 里把它物化成两条通路，磁盘上一个字节不动；
//! 2. **「测试连接」载荷载体**：前端按被测通路现拼一份 legacy 形状的 `cloud`
//!    （`probe.rs` 零 diff 的关键——它只读入参 `config.cloud`）。
//!
//! mode 判据族方法（`validate` / `is_usable` / `resolve_root` / `remote_dir`）
//! **全部委托**给 `MdSyncCloudChannel`（`models/md_sync_channel.rs`）：
//! 判据写两份必漂移。

#![allow(dead_code)]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::infra::md_env::expand_env;
use crate::models::md_sync::{MdSyncBinding, MdSyncView};
use crate::models::md_sync_auto::MdCloudAuto;
pub use crate::models::md_sync_channel::MdSyncCloudChannel;

/// 云端通道（Webdav 模式）的默认落点根。
///
/// 与 Obsidian 落点 `MD_SYNC_DEFAULT_ROOT`（`%APP_DIR%\md`）**刻意分开**：用户要隔离的
/// 是格式风险——Obsidian 的自动格式化插件会重排标题与表格，而 Timing 靠「区块标题 +
/// Markdown 表格」定位解析。让云端那份只被 Timing 碰，它才一直是可解析的形状。
pub const MD_SYNC_CLOUD_ROOT: &str = r"%APP_DIR%\md-webdav";

/// 三个长度上限：服务地址 / 远端目录 / 账号。密码不在这里，见 `infra::secret`。
pub const MD_CLOUD_URL_MAX_LEN: usize = 512;
pub const MD_CLOUD_PATH_MAX_LEN: usize = 256;
pub const MD_CLOUD_USER_MAX_LEN: usize = 128;

/// 云端通道的两种部署方式。线缆值由 `rename_all = "lowercase"` 决定：
/// `"localfolder"` / `"webdav"`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudMode {
    /// 只把当天那份写进本地目录，上传交给坚果云客户端。这条路上 PC 端零网络代码。
    #[default]
    LocalFolder,
    /// Timing 自己 GET / PUT。
    Webdav,
}

/// 云端通道配置（`MdSyncConfig.cloud`）。
///
/// 密码**不在**这个结构里：它会随 `MdSyncConfig` 序列化进 `settings` 表（明文 JSON，
/// 还会被导出）。密文由 `infra::secret` 单独管，视图只回 `hasSecret: bool`。
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncCloud {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub mode: CloudMode,
    /// `LocalFolder` 模式：填坚果云同步文件夹（或任意本地目录）。
    #[serde(default)]
    pub local_root: String,
    /// `Webdav` 模式：服务地址，如 `https://dav.jianguoyun.com/dav/`。
    #[serde(default)]
    pub base_url: String,
    /// `Webdav` 模式：远端目录，如 `/Timing/md`。
    #[serde(default)]
    pub base_path: String,
    /// `Webdav` 模式：账号（坚果云要的是「应用密码」对应的账号）。
    #[serde(default)]
    pub user: String,
    /// [V0.11.19] 云端自动同步三档。`None`（老配置）= 智能 + 15 分钟；
    /// `skip_serializing_if` 保证「什么都没改的保存」不往老配置里多写一个键。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<MdCloudAuto>,
}

impl MdSyncCloud {
    /// 字段投影成单通路结构（去 `mode`）。判据族方法的**唯一**实现体在
    /// `MdSyncCloudChannel`，这里只做搬运，不写第二份校验。
    fn as_channel(&self) -> MdSyncCloudChannel {
        MdSyncCloudChannel {
            enabled: self.enabled,
            local_root: self.local_root.clone(),
            base_url: self.base_url.clone(),
            base_path: self.base_path.clone(),
            user: self.user.clone(),
            auto: self.auto.clone(),
        }
    }

    /// 纯字符串校验（不碰文件系统）——被 `MdSyncConfig::validate` 与 `probe` 调用。
    pub fn validate(&self, bindings: &[MdSyncBinding]) -> Result<(), String> {
        match self.mode {
            CloudMode::LocalFolder => self.as_channel().validate_folder(bindings),
            CloudMode::Webdav => self.as_channel().validate_webdav(),
        }
    }

    /// 是否「开了且填全了」。密文不在这里判：密文由 `infra::secret` 管。
    pub fn is_usable(&self) -> bool {
        match self.mode {
            CloudMode::LocalFolder => self.as_channel().is_usable_folder(),
            CloudMode::Webdav => self.as_channel().is_usable_webdav(),
        }
    }

    /// 生效落点根（**未展开**的模板）：`LocalFolder` → 用户填的目录；`Webdav` → 出厂默认根。
    pub fn root_template(&self) -> &str {
        match self.mode {
            CloudMode::LocalFolder => &self.local_root,
            CloudMode::Webdav => MD_SYNC_CLOUD_ROOT,
        }
    }

    /// 生效落点根（已展开、绝对路径）。不可解析返回 `Err`（原因给人看）。
    pub fn resolve_root(&self) -> Result<PathBuf, String> {
        crate::models::md_sync_channel::resolve_template(self.root_template().trim())
    }

    /// 远端目录规范化（与 `MdSyncCloudChannel::remote_dir` 同一份实现）。
    pub fn remote_dir(&self) -> Result<String, String> {
        self.as_channel().remote_dir()
    }
}

/// 比较用的路径规范化：展开占位符 → 统一分隔符 → 去掉尾分隔符 → 小写。
///
/// 统一成 `\` 再比：两端都过同一个变换，所以「`/` 与 `\` 混写」也能认出来。大小写不敏感
/// 是 Windows 口径；Android 上大小写敏感，但那里 `LocalFolder` 模式不开放（手机端只有
/// WebDAV），为一个用不到的差异留分支不值得。
/// [V0.11.19 变更 A] `pub(crate)`：往期清理的闸③（目录重合）复用这一步，**不许再写一份**。
/// [V0.11.26] `models/md_sync_channel.rs::validate_folder` 也走这一份。
pub(crate) fn normalize_path(raw: &str) -> String {
    expand_env(raw)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// 云端通道的运行时状态（设置页原样展示，不臆造「成功」）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncCloudStatus {
    pub enabled: bool,
    pub mode: CloudMode,
    /// 密码是否已保存（**永不回传明文**）。
    pub has_secret: bool,
    /// 今天那份是否已成功上传。
    pub today_pushed: bool,
    /// `pending_since > 0` 的日期（升序）。
    pub pending_dates: Vec<String>,
    pub last_error: Option<String>,
    /// [V0.11.19 变更 A] 往期清理状态，**只反映当前生效通道**（另一条通道的那份不回传）。
    pub purge: super::md_cloud_purge::MdCloudPurgeStatus,
}

/// `md_sync_get` / `md_sync_save` 的返回：基础视图 + 两块状态拼成一个 JSON。
///
/// 用 `flatten` 而不是「把状态塞进 `MdSyncView`」：后者要改
/// `services/md_sync/mod.rs`（正好 300 行，且红线要求整文件零改动）。
/// [V0.11.26] `+local`：块④ 本地同步自己的状态行（设计 §1.4，字段只增不改不删）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncViewCloud {
    #[serde(flatten)]
    pub base: MdSyncView,
    /// 块⑤ 云端同步（webdav 通路）的状态。
    pub cloud: MdSyncCloudStatus,
    /// 块④ 本地同步（folder 通路）的状态。
    pub local: MdSyncCloudStatus,
}

/* 「测试连接」的结果搬去 `models/md_sync_test_result.rs`（本文件 295 行、贴到门禁）。
   `pub use` 让外部路径（`models::md_sync_cloud::MdSyncTestResult`）一个字都不用改：
   命令层、服务层与 `probe.rs` 三处引用保持原样。 */
pub use super::md_sync_test_result::{MdSyncTestResult, MdSyncTestStep};

/// 备份列表的一项（备份文件名里能读出的事实）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdBackupItem {
    /// 文件名，恢复时原样回传。
    pub name: String,
    /// `"obsidian"` / `"webdav"` / `"folder"`；`None` = 老备份（无 `__` 前缀），列表标「归属未知」。
    pub target: Option<String>,
    /// 来源文件名，如 `2026-11-06.md`。
    pub source: String,
    /// 从名字推出来的日期；推不出 → `None`（此时恢复要用户指定目标）。
    pub date: Option<String>,
    pub at_ms: i64,
    pub bytes: u64,
}

/// 恢复的结果（前端据此拼一句「已恢复 …」）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdBackupRestoreResult {
    pub date: String,
    pub target: String,
    /// 导入回 SQL 的记录 / 便利贴条数。
    pub imported: u32,
    /// 写回的文件数（三个种类常落同一个文件，所以通常是 1）。
    pub written: u32,
}
