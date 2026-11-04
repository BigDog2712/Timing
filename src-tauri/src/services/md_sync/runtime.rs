//! 同步的进程内状态：上次写出的区块内容（基线）、区块读取缓存、设置页要展示的运行状态。
//!
//! 基线是「三方合并」的锚点：
//! - 当前文件 == 基线，SQL 变了 → 只可能是 SQL 侧改的，导出；
//! - SQL 期望值 == 基线，文件变了 → 只可能是文件侧改的，导入；
//! - 两边都不等于基线 → 真冲突，按 mtime / updated_at 最后写入者胜。
//!
//! 基线不落库：进程重启后第一次同步会以「当前文件 + 当前 SQL」重新建立锚点。
//! 这正是想要的——重启不是用户编辑，不能把重启前的旧基线拿来判冲突。
//!
//! ## 为什么基线锁与状态锁分开
//!
//! 基线必须在**整轮同步**期间独占：两个写入者同时改同一区块等于互相抹掉。
//! 但设置页每次刷新都读一次运行状态（`get_view`），它跟基线毫无关系——
//! 共用一把锁的结果是「同步进行中打开设置页，界面卡在 loading 上」。
//! 所以状态单独一把锁（`status_snapshot` / `set_status`），只在开头结尾各拿一次。

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use tokio::sync::{Mutex, MutexGuard};

use crate::infra::md_file::{self, SectionState};
use crate::models::md_sync::{MdSyncKind, MdSyncStatus};

/// 上次写出的区块内容。
#[derive(Debug, Clone)]
pub struct Baseline {
    pub body: String,
}

/// 区块读取的缓存条目。
///
/// `body = None` 表示**标题缺失**（不是空内容）：两种情况对冲突判定完全不同，
/// 混成一个空串会把「用户删了标题」当成「用户删光了内容」。
#[derive(Debug, Clone)]
pub struct CachedSection {
    /// 文件是否存在。不存在时 body 恒为 None。
    pub exists: bool,
    /// 标题下的内容；None = 文件里没有这个标题。
    pub body: Option<String>,
    /// 记账用的 stat 时刻（epoch ms）。注意它只用于「变没变」的比较，
    /// 冲突判定用的是当轮 `read_section` 读到的那份，两者含义不同。
    pub mtime_ms: i64,
    /// 记账用的文件字节数。和 mtime 一起比：同毫秒内的两次写入 mtime 一样，长度才收得住。
    pub len: u64,
}

impl CachedSection {
    fn from_state(state: &SectionState, mtime_ms: i64, len: u64) -> Self {
        let body = match state {
            SectionState::Present { body, .. } => Some(body.clone()),
            _ => None,
        };
        Self {
            exists: !matches!(state, SectionState::MissingFile),
            body,
            mtime_ms,
            len,
        }
    }

    /// 还原成调用方认识的形态。`mtime_ms` 来自缓存记账（见上）。
    fn to_state(&self) -> SectionState {
        if !self.exists {
            return SectionState::MissingFile;
        }
        match &self.body {
            Some(body) => SectionState::Present {
                body: body.clone(),
                mtime_ms: self.mtime_ms,
            },
            None => SectionState::MissingHeading {
                mtime_ms: self.mtime_ms,
            },
        }
    }
}

/// 进程内运行状态。
#[derive(Debug)]
pub struct Runtime {
    pub baselines: HashMap<String, Baseline>,
    /// 区块读取缓存。key = `"{path}|{heading}"`：同一文件里的两个标题是两份独立内容。
    pub sections: HashMap<String, CachedSection>,
}

impl Runtime {
    pub fn new() -> Self {
        Self {
            baselines: HashMap::new(),
            sections: HashMap::new(),
        }
    }

    pub fn baseline(&self, kind: MdSyncKind, path: &Path, heading: &str) -> Option<&Baseline> {
        self.baselines.get(&key(kind, path, heading))
    }

    pub fn set_baseline(&mut self, kind: MdSyncKind, path: &Path, heading: &str, body: String) {
        self.baselines
            .insert(key(kind, path, heading), Baseline { body });
    }

    /// 读区块：文件的 `(mtime, 长度)` 与缓存一致时直接还原，不读整篇日记。
    ///
    /// 轮询每 2 秒对每个落点跑一次，而 `read_section` 会读**整篇**日记再按标题切——
    /// 几百 KB 的日记即使页缓存命中，也要重复走一遍读盘与解析。判据只能是 stat。
    pub fn read_section_cached(
        &mut self,
        path: &Path,
        heading: &str,
    ) -> Result<SectionState, String> {
        self.read_section_via(path, heading, md_file::read_section)
    }

    /// 写区块并作废缓存。
    ///
    /// 「写盘」与「缓存失效」绑在一起：调用方几乎一定会漏掉后者，
    /// 一旦漏了，下一轮会拿旧 body 判「文件没变化」，改动就再也同步不出去。
    pub fn write_section(&mut self, path: &Path, heading: &str, body: &str) -> Result<i64, String> {
        let mtime = md_file::write_section(path, heading, body)?;
        self.sections.remove(&section_key(path, heading));
        Ok(mtime)
    }

    /// 读取器可注入：单测用它证明「命中缓存时不碰文件」。
    fn read_section_via<F>(
        &mut self,
        path: &Path,
        heading: &str,
        read: F,
    ) -> Result<SectionState, String>
    where
        F: Fn(&Path, &str) -> Result<SectionState, String>,
    {
        let cache_key = section_key(path, heading);
        let stamp = md_file::stat_stamp(path);
        if let Some(cached) = self.sections.get(&cache_key) {
            if Some((cached.mtime_ms, cached.len)) == stamp {
                return Ok(cached.to_state());
            }
        }
        let state = read(path, heading)?;
        // 记账用**读之前**那次 stat：中途被改过的话下一轮 stat 就对不上，会多读一次。
        // 宁可多读一轮，也不能拿旧内容冒充新内容（那会让文件侧的改动永远进不来）。
        let (mtime_ms, len) = stamp.unwrap_or((0, 0));
        self.sections
            .insert(cache_key, CachedSection::from_state(&state, mtime_ms, len));
        Ok(state)
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
static STATUS: OnceLock<Mutex<MdSyncStatus>> = OnceLock::new();

/// 基线与缓存共用的锁：同步器与命令之间互斥，避免两个写入者同时改同一区块。
pub async fn lock() -> MutexGuard<'static, Runtime> {
    RUNTIME
        .get_or_init(|| Mutex::new(Runtime::new()))
        .lock()
        .await
}

/// 运行状态单独一把锁：设置页刷新不该排在整轮同步后面（见文件头注释）。
pub async fn status_snapshot() -> MdSyncStatus {
    status_slot().lock().await.clone()
}

pub async fn set_status(status: MdSyncStatus) {
    *status_slot().lock().await = status;
}

fn status_slot() -> &'static Mutex<MdSyncStatus> {
    STATUS.get_or_init(|| Mutex::new(MdSyncStatus::default()))
}

/// 标题也进 key：用户在同一文件里把标题从 A 改成 B 时，旧标题的基线不能拿来
/// 判断新标题的内容，否则会把 B 下的无关文字当成「用户删光了 A」。
fn key(kind: MdSyncKind, path: &Path, heading: &str) -> String {
    format!("{}|{}|{heading}", kind.as_str(), path.display())
}

/// 缓存 key 不带 kind：缓存的是「这个文件这个标题下的字节」，与哪个落点无关。
fn section_key(path: &Path, heading: &str) -> String {
    format!("{}|{heading}", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    /// 落一个临时 Markdown，返回路径。用进程号 + 自增序号避免并发用例打架。
    fn temp_md(tag: &str, text: &str) -> PathBuf {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let name = format!(
            "timing-cache-{}-{}-{tag}.md",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn second_read_hits_cache_without_touching_file() {
        let path = temp_md("hit", "#### A\n\n第一版\n");
        let mut runtime = Runtime::new();
        let first = runtime.read_section_cached(&path, "#### A").unwrap();
        assert!(matches!(first, SectionState::Present { .. }));

        /* 注入一个「一读就失败」的读取器：走缓存就成功，真去读文件就报错。 */
        let second = runtime
            .read_section_via(&path, "#### A", |_, _| Err("不应该再读文件".to_string()))
            .unwrap();
        match second {
            SectionState::Present { body, .. } => assert_eq!(body, "第一版"),
            other => panic!("应命中缓存，实得 {other:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn changed_file_is_reread() {
        let path = temp_md("miss", "#### A\n\n第一版\n");
        let mut runtime = Runtime::new();
        runtime.read_section_cached(&path, "#### A").unwrap();

        /* 长度不同 → stat 对不上 → 必须重读（同毫秒写入也能收住） */
        std::fs::write(&path, "#### A\n\n第二版，更长一些\n").unwrap();
        let again = runtime.read_section_cached(&path, "#### A").unwrap();
        match again {
            SectionState::Present { body, .. } => assert_eq!(body, "第二版，更长一些"),
            other => panic!("应重读文件，实得 {other:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_invalidates_cache() {
        let path = temp_md("invalidate", "#### A\n\n旧内容\n");
        let mut runtime = Runtime::new();
        runtime.read_section_cached(&path, "#### A").unwrap();
        runtime.write_section(&path, "#### A", "新内容").unwrap();

        // 写入必须让缓存作废：注入一个必失败的读取器，这里应当直接报错。
        // 缓存若还在，它会「成功」返回旧内容 —— 正是要防的那个 bug。
        assert!(runtime
            .read_section_via(&path, "#### A", |_, _| Err("缓存没作废".to_string()))
            .is_err());

        let after = runtime.read_section_cached(&path, "#### A").unwrap();
        match after {
            SectionState::Present { body, .. } => assert_eq!(body, "新内容"),
            other => panic!("应读到新内容，实得 {other:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }
}
