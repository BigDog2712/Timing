use sha2::{Digest, Sha256};
use std::path::{Component, PathBuf};

use super::transport::Transport;
use crate::infra::md_webdav::WebdavTarget;
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_channel::MdSyncCloudChannel;

impl Transport {
    pub fn scope(&self) -> Result<String, String> {
        let parts = match self {
            Self::Folder(root) => {
                let absolute = std::path::absolute(root).map_err(|err| err.to_string())?;
                let mut normalized = PathBuf::new();
                for component in absolute.components() {
                    match component {
                        Component::ParentDir => { normalized.pop(); }
                        Component::CurDir => {}
                        Component::Prefix(prefix) => match prefix.kind() {
                            std::path::Prefix::Disk(disk) | std::path::Prefix::VerbatimDisk(disk) => {
                                normalized.push(format!("{}:\\", char::from(disk.to_ascii_uppercase())));
                            }
                            std::path::Prefix::VerbatimUNC(server, share) => {
                                normalized.push(PathBuf::from("\\\\").join(server).join(share));
                            }
                            _ => normalized.push(prefix.as_os_str()),
                        },
                        other => normalized.push(other.as_os_str()),
                    }
                }
                vec!["folder".to_string(), normalized.to_string_lossy().into_owned()]
            }
            Self::Webdav(target) => {
                let raw = target.url_for("").map_err(|_| "WebDAV 地址无效".to_string())?;
                let url = reqwest::Url::parse(&raw).map_err(|_| "WebDAV 地址无效".to_string())?;
                vec!["webdav".to_string(), url.to_string(), target.user.clone()]
            }
        };
        let mut hash = Sha256::new();
        for part in parts {
            hash.update((part.len() as u64).to_be_bytes());
            hash.update(part.as_bytes());
        }
        Ok(format!("{:x}", hash.finalize()))
    }
}

pub fn for_channel(channel: &MdSyncCloudChannel, kind: PurgeChannel) -> Result<String, String> {
    match kind {
        PurgeChannel::Folder => Transport::Folder(channel.resolve_root_folder()?).scope(),
        PurgeChannel::Webdav => Transport::Webdav(WebdavTarget::new(
            &channel.base_url, &channel.remote_dir()?, &channel.user, "",
        )).scope(),
    }
}
