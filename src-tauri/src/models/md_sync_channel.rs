//! 单通路结构（V0.11.26 设置页改造，设计 §1.2）。
//!
//! 旧 `MdSyncCloud` 用 `mode` 表达「本地目录 / WebDAV 二选一」；拆分后两条通路
//! **各自持有自己的字段与开关**，共用这一个去 `mode` 的结构：
//!
//! - `cloudFolder`（块④ 本地同步）读 `local_root`，`round_folder` 按它跑；
//! - `cloudWebdav`（块⑤ 云端同步）读三件套，`round_webdav` 按它跑。
//!
//! 判据纪律：`is_usable_folder / is_usable_webdav` 是「这条通路会不会跑」的**唯一**
//! 字段级出口，`services::md_cloud::usable_folder / usable_webdav` 在其上再包一层
//! （加总开关语义由调用方管）。老 `MdSyncCloud` 的 mode 判据族方法全部**委托**到这里，
//! 写第二份必然漂移。
//!
//! `split_legacy` 是老配置迁移的唯一实现（PRD §4.4 表逐行）：`mode='localfolder'` →
//! folder 全盘承接、webdav `{enabled:false, 字段留原值, auto:None}`；`mode='webdav'`
//! 反向对称；`cloud:null` → `(None, None)`。非活跃通路 `auto=None`（读作默认
//! 「智能 + 15 分钟」），与「老配置没有 auto 键」同形——避免一次无谓写键。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::infra::md_env::expand_env;
use crate::models::md_sync::{MdSyncBinding, MD_SYNC_ROOT_MAX_LEN};
use crate::models::md_sync_auto::MdCloudAuto;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud, MD_CLOUD_PATH_MAX_LEN, MD_CLOUD_URL_MAX_LEN, MD_CLOUD_USER_MAX_LEN, MD_SYNC_CLOUD_ROOT};

/// 一条通路自己的配置（`MdSyncConfig.cloudFolder` / `cloudWebdav`）。
///
/// 字段是旧 `MdSyncCloud` 的去 mode 超集：两条通路各读各的字段，
/// 空串 = 没填（长度与换行校验在 `validate_*`，与旧口径逐字一致）。
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncCloudChannel {
    #[serde(default)]
    pub enabled: bool,
    /// folder 通路：坚果云同步文件夹（或任意本地目录）。
    #[serde(default)]
    pub local_root: String,
    /// webdav 通路：服务地址，如 `https://dav.jianguoyun.com/dav/`。
    #[serde(default)]
    pub base_url: String,
    /// webdav 通路：远端目录，如 `/Timing/md`。
    #[serde(default)]
    pub base_path: String,
    /// webdav 通路：账号。
    #[serde(default)]
    pub user: String,
    /// [V0.11.19] 该通路自己的三档。`None`（老配置 / 非活跃承接）= 智能 + 15 分钟。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<MdCloudAuto>,
}

impl MdSyncCloudChannel {
    /// folder 通路是否「开了且落点非空」。与旧 `CloudMode::LocalFolder` 的
    /// `is_usable` 分支逐字同口径（`.trim()` 判空白，改一边必须改另一边）。
    pub fn is_usable_folder(&self) -> bool {
        self.enabled && !self.local_root.trim().is_empty()
    }

    /// webdav 通路是否「开了且三件套齐」。密码不在这里判（密文归 `infra::secret`）。
    pub fn is_usable_webdav(&self) -> bool {
        self.enabled
            && !self.base_url.trim().is_empty()
            && !self.base_path.trim().is_empty()
            && !self.user.trim().is_empty()
    }

    /// folder 通路纯字符串校验：目录不能与任一落点重合（两个写者）。
    pub fn validate_folder(&self, bindings: &[MdSyncBinding]) -> Result<(), String> {
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
        未启用的配置也照查：用户常常是「先填路径、后开开关」。 */
        let mine = super::md_sync_cloud::normalize_path(root);
        for binding in bindings {
            if binding.root.trim().is_empty() {
                continue;
            }
            if super::md_sync_cloud::normalize_path(&binding.root) == mine {
                return Err(format!(
                    "云端目录不能与「{}」的落点相同：同一个文件有两个写者会互相覆盖",
                    binding.kind.label()
                ));
            }
        }
        Ok(())
    }

    /// webdav 通路纯字符串校验（与旧 `validate_webdav` 逐字同口径）。
    pub fn validate_webdav(&self) -> Result<(), String> {
        let url = self.base_url.trim();
        if url.is_empty() && self.enabled {
            return Err("请填写 WebDAV 服务地址".into());
        }
        if !url.is_empty() {
            check_text(url, MD_CLOUD_URL_MAX_LEN, "服务地址")?;
            let lower = url.to_lowercase();
            if !(lower.starts_with("http://") || lower.starts_with("https://")) {
                return Err("服务地址要以 http:// 或 https:// 开头".into());
            }
        }
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

    /// folder 通路的生效落点根（已展开、绝对路径）。
    pub fn resolve_root_folder(&self) -> Result<PathBuf, String> {
        resolve_template(&self.local_root)
    }

    /// webdav 通路的生效落点根：出厂默认 `MD_SYNC_CLOUD_ROOT`（与用户填的目录刻意分开）。
    pub fn resolve_root_webdav(&self) -> Result<PathBuf, String> {
        resolve_template(MD_SYNC_CLOUD_ROOT)
    }

    /// 远端目录规范化：去首尾 `/`、拒绝 `..` 段，输出形如 `/Timing/md`。
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
}

/// 模板 → 绝对路径。空模板 / 相对路径都拒绝（原因给人看），folder 与 webdav 共用。
pub(crate) fn resolve_template(template: &str) -> Result<PathBuf, String> {
    let template = template.trim();
    if template.is_empty() {
        return Err("云端通道的落点目录还没配置".into());
    }
    let expanded = expand_env(template);
    let path = PathBuf::from(&expanded);
    /* 相对路径会跟着进程 CWD 走：同步落点必须是「无论怎么启动都是同一个目录」。 */
    if !path.is_absolute() {
        return Err(format!("云端落点目录必须是绝对路径：{expanded}"));
    }
    Ok(path)
}

/// 长度与换行的通用校验（`what` 是给人看的字段名）。旧 `md_sync_cloud` 的同名函数搬来。
fn check_text(value: &str, max: usize, what: &str) -> Result<(), String> {
    if value.chars().count() > max {
        return Err(format!("{what}超过 {max} 个字符"));
    }
    if value.contains(['\n', '\r']) {
        return Err(format!("{what}不能换行"));
    }
    Ok(())
}

/// 老配置折算（读时推断 / 保存兜底共用，PRD §4.4 表逐行）。见模块头。
pub fn split_legacy(
    cloud: Option<&MdSyncCloud>,
) -> (Option<MdSyncCloudChannel>, Option<MdSyncCloudChannel>) {
    let Some(cloud) = cloud else {
        return (None, None);
    };
    /* 两条通路都从「全字段原值 + 关着 + 无三档」起步，活跃侧再覆盖 enabled / auto：
       非活跃侧字段留原值（A4「切回不用重填」的继承者）、auto=None（读作默认）。 */
    let base = MdSyncCloudChannel {
        enabled: false,
        local_root: cloud.local_root.clone(),
        base_url: cloud.base_url.clone(),
        base_path: cloud.base_path.clone(),
        user: cloud.user.clone(),
        auto: None,
    };
    match cloud.mode {
        CloudMode::LocalFolder => (
            Some(MdSyncCloudChannel {
                enabled: cloud.enabled,
                auto: cloud.auto.clone(),
                ..base.clone()
            }),
            Some(base),
        ),
        CloudMode::Webdav => (
            Some(base.clone()),
            Some(MdSyncCloudChannel {
                enabled: cloud.enabled,
                auto: cloud.auto.clone(),
                ..base
            }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::md_sync::MdSyncKind;

    fn binding(root: &str) -> MdSyncBinding {
        MdSyncBinding {
            kind: MdSyncKind::Timers,
            enabled: true,
            root: root.into(),
            file: "{date}.md".into(),
            heading: "#### 事项计时".into(),
        }
    }

    fn legacy(mode: CloudMode) -> MdSyncCloud {
        MdSyncCloud {
            enabled: true,
            mode,
            local_root: r"D:\Nutstore".into(),
            base_url: "https://dav.jianguoyun.com/dav/".into(),
            base_path: "/Timing".into(),
            user: "me@example.com".into(),
            auto: None,
        }
    }

    #[test]
    fn split_legacy_localfolder_hands_everything_to_folder() {
        let (folder, webdav) = split_legacy(Some(&legacy(CloudMode::LocalFolder)));
        let folder = folder.expect("活跃侧必须物化出来");
        assert!(folder.enabled && folder.is_usable_folder());
        assert_eq!(folder.local_root, r"D:\Nutstore");
        let webdav = webdav.expect("非活跃侧也物化（字段留原值）");
        assert!(!webdav.enabled && !webdav.is_usable_webdav());
        assert_eq!(webdav.base_url, "https://dav.jianguoyun.com/dav/", "三件套留原值");
        assert_eq!(webdav.auto, None, "非活跃通路 auto 承接为 None");
    }

    #[test]
    fn split_legacy_webdav_is_symmetric() {
        let (folder, webdav) = split_legacy(Some(&legacy(CloudMode::Webdav)));
        assert!(!folder.as_ref().is_some_and(|c| c.enabled));
        assert_eq!(folder.as_ref().map(|c| c.local_root.as_str()), Some(r"D:\Nutstore"));
        let webdav = webdav.expect("活跃侧必须物化出来");
        assert!(webdav.is_usable_webdav());
    }

    #[test]
    fn split_legacy_none_is_none() {
        assert_eq!(split_legacy(None), (None, None));
    }

    #[test]
    fn webdav_channel_root_is_the_factory_default() {
        let channel = MdSyncCloudChannel::default();
        assert_eq!(
            channel.resolve_root_webdav().expect("出厂模板必须能解析"),
            PathBuf::from(crate::infra::md_env::expand_env(MD_SYNC_CLOUD_ROOT)),
            "webdav 通路恒用出厂默认根，不吃 localRoot"
        );
    }

    #[test]
    fn remote_dir_rejects_parent_segments() {
        let channel = MdSyncCloudChannel { base_path: "/a/../b".into(), ..Default::default() };
        assert!(channel.remote_dir().is_err());
        assert_eq!(
            MdSyncCloudChannel { base_path: "/a//b/".into(), ..Default::default() }
                .remote_dir()
                .expect("规范化应成功"),
            "/a/b"
        );
    }

    #[test]
    fn folder_validation_refuses_binding_overlap() {
        let channel = MdSyncCloudChannel { enabled: true, local_root: r"D:\vault".into(), ..Default::default() };
        assert!(channel.validate_folder(&[binding(r"D:\VAULT")]).is_err());
        assert!(channel.validate_folder(&[binding(r"D:\other")]).is_ok());
    }
}
