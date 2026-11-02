//! 同步的进程内状态：上次写出的区块内容（基线）与设置页要展示的运行状态。
//!
//! 基线是「三方合并」的锚点：
//! - 当前文件 == 基线，SQL 变了 → 只可能是 SQL 侧改的，导出；
//! - SQL 期望值 == 基线，文件变了 → 只可能是文件侧改的，导入；
//! - 两边都不等于基线 → 真冲突，按 mtime / updated_at 最后写入者胜。
//!
//! 基线不落库：进程重启后第一次同步会以「当前文件 + 当前 SQL」重新建立锚点。
//! 这正是想要的——重启不是用户编辑，不能把重启前的旧基线拿来判冲突。

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use tokio::sync::{Mutex, MutexGuard};

use crate::models::md_sync::{MdSyncKind, MdSyncStatus};

/// 上次写出的区块内容。
#[derive(Debug, Clone)]
pub struct Baseline {
    pub body: String,
}

/// 进程内运行状态。
#[derive(Debug)]
pub struct Runtime {
    pub baselines: HashMap<String, Baseline>,
    pub status: MdSyncStatus,
    pub initialized: bool,
}

impl Runtime {
    pub fn new() -> Self {
        Self {
            baselines: HashMap::new(),
            status: MdSyncStatus {
                last_sync_at: None,
                last_error: None,
                bindings: Vec::new(),
            },
            initialized: false,
        }
    }

    pub fn baseline(&self, kind: MdSyncKind, path: &Path, heading: &str) -> Option<&Baseline> {
        self.baselines.get(&key(kind, path, heading))
    }

    pub fn set_baseline(&mut self, kind: MdSyncKind, path: &Path, heading: &str, body: String) {
        self.baselines
            .insert(key(kind, path, heading), Baseline { body });
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();

/// 同步器与命令共用的一把锁：避免设置页点「立即同步」和轮询任务同时写同一区块。
pub async fn lock() -> MutexGuard<'static, Runtime> {
    RUNTIME
        .get_or_init(|| Mutex::new(Runtime::new()))
        .lock()
        .await
}

/// 标题也进 key：用户在同一文件里把标题从 A 改成 B 时，旧标题的基线不能拿来
/// 判断新标题的内容，否则会把 B 下的无关文字当成「用户删光了 A」。
fn key(kind: MdSyncKind, path: &Path, heading: &str) -> String {
    format!("{}|{}|{heading}", kind.as_str(), path.display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn baseline_key_includes_heading() {
        let path = PathBuf::from("C:\\vault\\2026-10-20.md");
        let mut runtime = Runtime::new();
        runtime.set_baseline(MdSyncKind::Timers, &path, "#### A", "a".into());
        assert!(runtime
            .baseline(MdSyncKind::Timers, &path, "#### A")
            .is_some());
        assert!(runtime
            .baseline(MdSyncKind::Timers, &path, "#### B")
            .is_none());
    }
}
