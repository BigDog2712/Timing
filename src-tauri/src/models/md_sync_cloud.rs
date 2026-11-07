//! 云端通道的配置与视图结构（V0.11.13，ADR-061）。
//!
//! 字段与 `src/types/domain/mdCloud.ts` 逐字对应，两个 serde 口径**不同**、都必须钉住：
//!
//! - `CloudMode` 用 `rename_all = "lowercase"` → `"localfolder"` / `"webdav"`。
//!   **不是** `"localFolder"`：前端写错不会编译报错，只会在保存后回读时得到
//!   `unknown variant` —— 用户看到的是「保存不了」，代码里看到的是一句 serde 错误；
//! - `MdSyncCloud` 用 `camelCase` → `localRoot` / `baseUrl` / `basePath`。
//!
//! 这一层只做**纯字符串**校验：不建目录、不连网、不读文件。理由是设置页按下「保存」
//! 的那一刻就要给出人话，而不是让用户等第一轮同步失败才发现路径打错了。
//!
//! `MdSyncConfig::cloud` 是 `Option`：老配置没有这个键 → `None` → 行为与 V0.11.12
//! 逐字相同。升级后**不许自己切通道**——那会让 Timing 突然开始往坚果云或磁盘第二处
//! 写用户文件。
//!
//! `MdSyncCloudStatus` / `MdBackupItem` 等结构在云端通道接线（T03）前没有构造点，
//! 必被判死码。用模块级 `allow(dead_code)` 而不是给每个 struct 加 `cfg`：同一份源码
//! 只留一个维护面，与 `lib.rs` 顶部对移动端死码的处理口径一致。

#![allow(dead_code)]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::infra::md_env::expand_env;
use crate::models::md_sync::{MdSyncBinding, MdSyncView, MD_SYNC_ROOT_MAX_LEN};
use crate::models::md_sync_auto::MdCloudAuto;

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
    /// 纯字符串校验（不碰文件系统）——被 `MdSyncConfig::validate` 调用。
    ///
    /// 唯一需要「展开」的是「本地目录 == 某个落点目录」这一条：`%APP_DIR%\md` 与展开后的
    /// 绝对路径必须被认成同一个目录，否则两个写者同时写一个文件（任务书 §4.1 / 风险 2）。
    pub fn validate(&self, bindings: &[MdSyncBinding]) -> Result<(), String> {
        match self.mode {
            CloudMode::LocalFolder => self.validate_folder(bindings),
            CloudMode::Webdav => self.validate_webdav(),
        }
    }

    /// 是否「开了且填全了」。密文不在这里判：密文由 `infra::secret` 管（T02）。
    pub fn is_usable(&self) -> bool {
        if !self.enabled {
            return false;
        }
        match self.mode {
            CloudMode::LocalFolder => !self.local_root.trim().is_empty(),
            CloudMode::Webdav => {
                !self.base_url.trim().is_empty()
                    && !self.base_path.trim().is_empty()
                    && !self.user.trim().is_empty()
            }
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
        let template = self.root_template().trim();
        if template.is_empty() {
            return Err("云端通道的落点目录还没配置".into());
        }
        let expanded = expand_env(template);
        let path = PathBuf::from(&expanded);
        /* 相对路径会跟着进程 CWD 走：装在 C 盘还是 D 盘、从哪个快捷方式启动，
        落点就换一个地方。同步落点必须是「无论怎么启动都是同一个目录」。 */
        if !path.is_absolute() {
            return Err(format!("云端落点目录必须是绝对路径：{expanded}"));
        }
        Ok(path)
    }

    /// 远端目录规范化：去首尾 `/`、拒绝 `..` 段，输出形如 `/Timing/md`（无尾斜杠）。
    ///
    /// 空目录返回 `""`（= 直接用服务地址的根）。`..` 一律拒绝而不是「消解掉」：远端目录
    /// 是配置项，允许 `..` 只会让「传到哪去了」难以回答，也可能把文件写到分享目录之外。
    pub fn remote_dir(&self) -> Result<String, String> {
        let raw = self.base_path.trim().replace('\\', "/");
        check_text(&raw, MD_CLOUD_PATH_MAX_LEN, "远端目录")?;
        let mut segments: Vec<&str> = Vec::new();
        for segment in raw.split('/') {
            match segment {
                "" | "." => continue,
                ".." => return Err("远端目录不能包含 ..（请填一个固定目录）".into()),
                other => segments.push(other),
            }
        }
        if segments.is_empty() {
            return Ok(String::new());
        }
        Ok(format!("/{}", segments.join("/")))
    }

    fn validate_folder(&self, bindings: &[MdSyncBinding]) -> Result<(), String> {
        let root = self.local_root.trim();
        if root.is_empty() {
            return if self.enabled {
                Err("请选择云端通道的本地目录".into())
            } else {
                Ok(())
            };
        }
        check_text(root, MD_SYNC_ROOT_MAX_LEN, "本地目录")?;

        /* 展开占位符后再比，且按小写比（Windows 上 `D:\MD` 与 `d:\md` 是同一个目录）。
        未启用的配置也照查：用户常常是「先填路径、后开开关」，让这一条只在启用时生效，
        等于把冲突留到打开开关的那一刻才爆。 */
        let mine = normalize_path(root);
        for binding in bindings {
            if binding.root.trim().is_empty() {
                continue;
            }
            if normalize_path(&binding.root) == mine {
                return Err(format!(
                    "云端目录不能与「{}」的落点相同：同一个文件有两个写者会互相覆盖",
                    binding.kind.label()
                ));
            }
        }
        Ok(())
    }

    fn validate_webdav(&self) -> Result<(), String> {
        let url = self.base_url.trim();
        if url.is_empty() && self.enabled {
            return Err("请填写 WebDAV 服务地址".into());
        }
        if !url.is_empty() {
            check_text(url, MD_CLOUD_URL_MAX_LEN, "服务地址")?;
            let lower = url.to_lowercase();
            /* 只认 http/https：写成 `dav.jianguoyun.com/dav` 时 reqwest 会报一句
            「relative URL without a base」，那是给开发者看的，不是给用户看的。 */
            if !(lower.starts_with("http://") || lower.starts_with("https://")) {
                return Err("服务地址要以 http:// 或 https:// 开头".into());
            }
        }

        /* `base_path` 在启用时必填：把 `{date}.md` 直接扔到服务地址的根目录上，
        用户多半是漏填了，而 404 的提示语（「请先在坚果云网页版建好目录」）也就无从对照。 */
        if self.base_path.trim().is_empty() && self.enabled {
            return Err("请填写远端目录（如 /Timing/md）".into());
        }
        self.remote_dir()?;

        let user = self.user.trim();
        check_text(user, MD_CLOUD_USER_MAX_LEN, "账号")?;
        if user.is_empty() && self.enabled {
            return Err("请填写 WebDAV 账号".into());
        }
        Ok(())
    }
}

/// 长度与换行的通用校验（`what` 是给人看的字段名）。
fn check_text(value: &str, max: usize, what: &str) -> Result<(), String> {
    if value.chars().count() > max {
        return Err(format!("{what}超过 {max} 个字符"));
    }
    if value.contains(['\n', '\r']) {
        return Err(format!("{what}不能换行"));
    }
    Ok(())
}

/// 比较用的路径规范化：展开占位符 → 统一分隔符 → 去掉尾分隔符 → 小写。
///
/// 统一成 `\` 再比：两端都过同一个变换，所以「`/` 与 `\` 混写」也能认出来。大小写不敏感
/// 是 Windows 口径；Android 上大小写敏感，但那里 `LocalFolder` 模式不开放（手机端只有
/// WebDAV），为一个用不到的差异留分支不值得。
fn normalize_path(raw: &str) -> String {
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
}

/// `md_sync_get` / `md_sync_save` 的返回：基础视图 + 云端状态拼成一个 JSON。
///
/// 用 `flatten` 而不是「把 `cloud` 塞进 `MdSyncView`」：后者要改
/// `services/md_sync/mod.rs`（正好 300 行，且本轮要求整文件零改动）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncViewCloud {
    #[serde(flatten)]
    pub base: MdSyncView,
    pub cloud: MdSyncCloudStatus,
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
