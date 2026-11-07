//! LocalFolder 那一半：**六道闸** + 留底 + 本地删除（V0.11.19 变更 A，设计 §3.4）。
//!
//! ## 取证 = pending 行 + `last_hash` + 当前字节指纹（必须做指纹闸）
//!
//! `round_folder` 每次写成功都 `mark_synced(today, None, &hash)`，`hash` 是对**真正写
//! 出去那份文件**算的。于是「`md_cloud_pending` 里有这一天的行」＝「这一天我们确实写过」
//! （顶替 WebDAV 的镜像证据），「文件指纹 == `last_hash`」＝「它还是我们写的那份，没人
//! 动过」。本路**必须**做指纹闸：本地目录是用户手动就能改的地方，不做的话一个恰好叫
//! `2025-01-01.md` 的用户文件会被当成我们的。
//!
//! ## 本地删除是**永久删除**（不进回收站）
//!
//! Windows 上它直接打 DeleteFile，删错就是用户真丢文件（本地目录模式下这份甚至可能是
//! 他网盘里的）。所以闸③ 与闸⑥ **不是「最好有」**，是这个功能能落地的前提，且都不许
//! 「差不多就行」：闸③ 任何一步判不出来一律拒绝；闸⑥ 只认 `save_checked == true`，
//! 文本必须 `String::from_utf8` 得来（`lossy` 会把坏字节换成 `�`，备份那份就对不上了）。
//!
//! ## 顺序不可换
//!
//! 闸③ **必须先于任何一次目录枚举**：顺序最容易被后人顺手调换（把枚举挪到 guard 前面，
//! 编译一样过、行为却变成「先读了主人的日记目录，再拒绝」）。所以本模块只有一个
//! **先闸后枚举**的入口 `guarded_entries`，`candidates` 的第一句就是它；它内部那个
//! 枚举函数带一个只在测试里累加的计数器（`ENUMERATIONS`），单测靠它断言「闸③ 拒绝时
//! 一次都没枚举」。

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use sqlx::SqlitePool;

use super::gate::past_keep_window;
use super::overlap::overlaps_binding;
use crate::models::md_sync::MdSyncBinding;
use crate::repositories::md_cloud_pending::{self, CloudPendingRow};
use crate::services::md_cloud::pending;

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

/// 只在测试里累加：证明「闸③ 拒绝时零枚举、放行时恰好一次」（设计 §3.4.3）。
#[cfg(test)]
static ENUMERATIONS: AtomicUsize = AtomicUsize::new(0);

/// 一个待删项。`bytes` 是闸⑤ 判定时读到的那一份，留底用的就是它 —— **不再读第二次**
/// （第二次读到的可能已经是别人写的内容，底就留错了）。
pub(crate) struct Candidate {
    pub date: NaiveDate,
    /// 枚举读到的文件名（恒为 `yyyy-MM-dd.md`）。
    pub name: String,
    pub path: PathBuf,
    pub bytes: Vec<u8>,
    /// 该行 `pending_since > 0`：切通道前留下的旧欠账。只影响日志里那个标记，不影响删不删。
    pub had_debt: bool,
}

/// 留底 / 删文件的三档结果。
pub(crate) enum RemoveErr {
    /// 没留下底（`save_checked` 返回 false，或文本不是合法 UTF-8）——**这个文件不删**。
    NoBackup,
    /// `EACCES` / `EPERM`：不会自愈，整批中断（逐个试只会把日志刷满）。
    Permission,
    /// 其它：记一笔失败，继续下一个。
    Other(String),
}

/// 候选集：闸③ 先过，再枚举，然后闸②④⑤（水位）逐条筛。
///
/// `Err(逐字红字)` 只可能是闸③ 拒绝 —— 调用方（`purge::run_folder`）据此写块④ 的红字、
/// 写 `day`（今天不再试）、**不动**水位（用户改好配置后第二天自动恢复）。
pub(crate) async fn candidates(
    pool: &SqlitePool,
    root: &Path,
    bindings: &[MdSyncBinding],
    today: NaiveDate,
    keep: i64,
    upto: Option<NaiveDate>,
) -> Result<Vec<Candidate>, String> {
    /* 闸③ 在**第一句**（`guarded_entries` 内部）：重合时连一次枚举都不许发生。 */
    let Ok(entries) = guarded_entries(root, bindings)? else {
        return Ok(Vec::new());
    };
    /* 闸⑤(a) 的查询形状：候选枚举完调一次 `list()` 建映射，循环里只查内存。
       单批 20 条 × 每轮一次，若循环里查库，首轮大扫（200 天 / 10 批）会白打 200 次。
       读不到就当「没有任何证据」→ 一条都不删（安全的一侧）。 */
    let rows = md_cloud_pending::list(pool).await.unwrap_or_default();
    let index: HashMap<&str, &CloudPendingRow> =
        rows.iter().map(|row| (row.date.as_str(), row)).collect();

    let mut out = Vec::new();
    for entry in entries {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        /* 闸②：严格日期名。全库唯一一份解析在 `gate.rs`，与 WebDAV 共用。 */
        let Some(date) = super::gate::parse_strict_date_file(&name) else {
            continue;
        };
        /* 闸④：`date < today - keep`。**早于比水位**（见 `gate::past_keep_window`）。 */
        if !past_keep_window(date, today, keep) {
            continue;
        }
        /* 水位：已确认清理过的日期不再进候选。 */
        if upto.is_some_and(|upto| date <= upto) {
            continue;
        }
        let path = entry.path();
        /* 名字像日期文件的目录不删（也不递归进去）。 */
        if !path.is_file() {
            continue;
        }
        let key = date.format("%Y-%m-%d").to_string();
        /* 闸⑤(a)：行存在且 `last_hash` 非空。不加 `pending_since == 0`（产品经理已裁，
           设计 §3.4 闸⑤ 下面那段）：folder 轮只给 `today` 调 `mark_synced`，历史日期的
           `pending_since` 永远清不了，加了就是永久漏删。 */
        let Some(row) = index.get(key.as_str()) else {
            continue;
        };
        let Some(last_hash) = row.last_hash.as_deref().filter(|hash| !hash.is_empty()) else {
            continue;
        };
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        /* 闸⑤(b)：它还是我们写的那份吗。改过一个字节就不删（I13c），
           **那行也不 clear** —— 证据要留到下一轮，否则这一天永远进不了候选。 */
        if pending::fingerprint(&bytes) != last_hash {
            crate::log_info!("md cloud purge: {name} skip=changed");
            continue;
        }
        out.push(Candidate {
            date,
            name,
            path,
            bytes,
            had_debt: row.pending_since > 0,
        });
    }
    out.sort_by_key(|candidate| candidate.date);
    Ok(out)
}

/// 留底 → 删。**留不下底就绝不删**。
///
/// `save` 之所以要由调用方传进来（而不是这里直呼 `md_backup::save_checked`）：闸⑥ 唯一
/// 能机验的形状是「留底必失败 → 文件仍在」，而真实的备份根是进程级 `OnceLock`，测试里
/// 没法按用例重定向。把「留底」当成一个返回布尔的参数注入，才能在用例里稳定造出
/// 「留底失败」这一档（I13e），同时生产路径传的仍然是 `md_backup::save_checked`。
pub(crate) fn remove_one(
    path: &Path,
    bytes: &[u8],
    save: impl Fn(&Path, &str) -> bool,
) -> Result<(), RemoveErr> {
    /* 文本必须严格 UTF-8：`from_utf8_lossy` 会把坏字节换成 `�`，那样存进备份的那份
       已经与原文件不同 —— 留了一份「看起来有、其实对不上」的底，比没有更糟。 */
    let Ok(text) = String::from_utf8(bytes.to_vec()) else {
        return Err(RemoveErr::NoBackup);
    };
    if !save(path, &text) {
        return Err(RemoveErr::NoBackup);
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::PermissionDenied => Err(RemoveErr::Permission),
        Err(err) => Err(RemoveErr::Other(err.to_string())),
    }
}

/// 闸③ 先过、再枚举 —— 本模块唯一「先判后读」的入口。
///
/// 判定本体在 `overlap.rs`（只有本路用得上）；留在这里是为了让「闸③ 必须先于枚举」
/// 在**一个函数体里**看得出顺序，单测也能直接钉住「拒绝时零枚举」（`ENUMERATIONS == 0`）。
fn guarded_entries(
    root: &Path,
    bindings: &[MdSyncBinding],
) -> Result<io::Result<Vec<fs::DirEntry>>, String> {
    overlaps_binding(root, bindings)?;
    Ok(entries_of(root))
}

/// 本模块**唯一**的目录枚举入口（别处不许直接枚举）。测试靠计数器断言「零枚举」。
fn entries_of(root: &Path) -> io::Result<Vec<fs::DirEntry>> {
    #[cfg(test)]
    ENUMERATIONS.fetch_add(1, Ordering::SeqCst);
    Ok(fs::read_dir(root)?.filter_map(Result::ok).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::md_cloud_purge::OVERLAP_TEXT;
    use crate::models::md_sync::MdSyncKind;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("测试日期")
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("timing-purge-folder-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    fn binding(root: &Path) -> MdSyncBinding {
        MdSyncBinding { kind: MdSyncKind::Timers, enabled: true, file: "{date}.md".into(),
            root: root.display().to_string(), heading: "#### 事项计时".into() }
    }

    /// 写一份文件；给了 `key` 就再记一行 pending（指纹与文件一致）—— 即「Timing 写过、
    /// 没人动过」。`key` 就是「宽松解析会把这一天读成什么」。
    async fn seed(pool: &SqlitePool, root: &Path, name: &str, key: Option<&str>) {
        let body = format!("body {name}");
        fs::write(root.join(name), &body).expect("写样本");
        let Some(key) = key else { return };
        md_cloud_pending::mark_synced(pool, key, None, &pending::fingerprint(body.as_bytes()))
            .await
            .expect("记 pending 行");
    }

    /// 日期名形状边界，**经 `candidates` 这个真实入口**验（不直呼 `gate.rs` 那个函数：
    /// 全库它只许有 3 处命中）。
    ///
    /// 每个坏名字都配了「按宽松解释算出来的那一天」的 pending 行：一旦有人把解析放宽成
    /// `NaiveDate::from_str`（它认 `2026-2-3`，还把 `26-02-03` 读成公元 26 年），这些文件
    /// 就会带着证据变成候选 → 这条红。没有这批行的话闸⑤(a) 会先把它们全拒掉，
    /// 断言「一个都没有」就变成恒真 —— 这正是上一轮那条假测试栽的坑。
    ///
    /// 最后那个**合规**的日期文件是反证：它证据一样、只是名字对，必须出现在结果里。
    #[tokio::test]
    async fn only_strict_date_names_survive_the_six_gates() {
        let pool = crate::tests::support::fresh_pool("purge-folder-shapes").await;
        let root = temp_dir("shapes");
        for (name, loose_key) in [
            ("2026-2-3.md", Some("2026-02-03")),
            ("26-02-03.md", Some("0026-02-03")),
            ("2026-13-45.md", Some("2026-13-45")),
            ("2026-02-30.md", Some("2026-02-30")),
            /* 后缀那条不造 pending 行：它早在日期逻辑之前就出局，硬造一行只会和
               `2026-2-3.md` 争同一个 key（后写的那行把指纹盖掉，前一档就被闸⑤ 挡住、
               「看起来没红」，等于白测）。 */
            ("2026-02-03.md.bak", None),
        ] {
            seed(&pool, &root, name, loose_key).await;
        }
        seed(&pool, &root, "2026-02-04.md", Some("2026-02-04")).await;

        let found: Vec<String> = candidates(&pool, &root, &[], day("2026-11-07"), 0, None)
            .await
            .expect("不重合要放行")
            .into_iter()
            .map(|candidate| candidate.name)
            .collect();
        assert_eq!(found, vec!["2026-02-04.md".to_string()], "只该有那一个严格日期名");
        let _ = fs::remove_dir_all(&root);
    }

    /// 设计 §3.4.3 用例①：目录重合 → 拒绝，**且一次都没有枚举**。
    /// 变异自检：删掉 `guarded_entries` 第一行的 `overlaps_binding`，这条立刻红
    /// （计数器变成 1，返回也变成 `Ok`）。
    #[test]
    fn overlap_refuses_before_any_enumeration() {
        let root = temp_dir("overlap-same");
        fs::write(root.join("2026-11-04.md"), "x").expect("写样本");

        ENUMERATIONS.store(0, Ordering::SeqCst);
        let outcome = guarded_entries(&root, &[binding(&root)]);
        assert_eq!(outcome.err(), Some(OVERLAP_TEXT.to_string()), "必须是逐字红字");
        assert_eq!(ENUMERATIONS.load(Ordering::SeqCst), 0, "拒绝时一次枚举都不许发生");
        let _ = fs::remove_dir_all(&root);
    }

    /// 设计 §3.4.3 用例②：不重合 → 放行，且枚举**恰好一次**（枚举不许重复）。
    #[test]
    fn no_overlap_enumerates_exactly_once() {
        let root = temp_dir("enumerate");
        let other = temp_dir("enumerate-other");
        fs::write(root.join("2026-11-04.md"), "x").expect("写样本");

        ENUMERATIONS.store(0, Ordering::SeqCst);
        let outcome = guarded_entries(&root, &[binding(&other)]);
        assert!(outcome.expect("不重合要放行").is_ok());
        assert_eq!(ENUMERATIONS.load(Ordering::SeqCst), 1, "只许枚举一次");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&other);
    }
}
