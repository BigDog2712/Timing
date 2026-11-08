//! 便携落点（V0.11.6）**独立验收** · A 组（迁移承诺）+ B 组（可写性探测）。
//!
//! 与工程师自测的 `portable_dir.rs` 刻意不重叠：那边验「迁移能成」，这里验
//! 「承诺在坏情况下还成不成立」——
//!
//! | 组 | 验什么 | 弄坏的方式 |
//! |---|---|---|
//! | A1 | 只复制不删除 | **逐文件字节比对**源树（不是「目录还在」） |
//! | A2 | 幂等且不覆盖 | 目标里塞哨兵文件，第二次跑完必须还在 |
//! | A3 | 绝不覆盖新数据 | 目标库内容与源不同 → 必须 `AlreadyPresent` |
//! | A4 | 失败不 panic 不留脏 | 源库写成非 SQLite 垃圾 → `Failed{verify}` + 临时目录清理 |
//! | A5 | 无库不搬 | 旧目录只有 `logs/` → `NoLegacy` 且**不建**目标目录 |
//! | B6 | 父路径是文件必须 Err | 临时目录里建一个文件当父目录 |
//! | B7 | 探测不留残留 | 成功/失败两条路径都数目录内容 |
//!
//! **禁止**调 `platform::app_dir::set()`（`OnceLock` 不可清除，会污染并行用例）。
//! C 组（插件）与 D 组（md 落点）在同目录的 `portable_dir_qa_plugins` /
//! `portable_dir_qa_md` —— 单文件 300 行硬门禁。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::infra::{db, portable_migrate as mig, portable_probe};

/// 每用例一个独立临时目录（`check-size` 扫本目录，故不放在这里重复实现）。
pub(crate) fn temp(tag: &str) -> PathBuf {
    crate::tests::support::unique_dir(tag)
}

/// 老数据目录里塞满「不只一个库」的东西：日志、插件、备份子目录。
pub(crate) fn seed_legacy_extras(dir: &Path) {
    std::fs::create_dir_all(dir.join("logs")).expect("建 logs");
    std::fs::write(dir.join("logs").join("app.log"), b"line-1\nline-2\n").expect("写日志");
    let plugin = dir.join("plugins").join("demo");
    std::fs::create_dir_all(&plugin).expect("建插件目录");
    std::fs::write(plugin.join("plugin.json"), br#"{"id":"demo"}"#).expect("写插件");
}

/// 把 `dir` 就地变成「老数据目录」（真库 + logs + plugins）。
pub(crate) async fn seed_legacy_db(dir: &Path) {
    let pool = db::init_pool(dir).await.expect("init_pool 应成功");
    pool.close().await;
    seed_legacy_extras(dir);
}

/// 真库 + logs + plugins 的「老数据目录」（`init_pool` 走真实迁移，结构同发布版）。
pub(crate) async fn legacy_with_db(tag: &str) -> PathBuf {
    let dir = temp(tag);
    seed_legacy_db(&dir).await;
    dir
}

/// 夹具根里**除白名单之外**的所有条目名（顶层就够：迁移的中间产物全是 target 的兄弟）。
///
/// 为什么按「根里还剩什么」审计，而不是按名字点名 `<target>.migrating` /
/// `<target>.migrating.v4-src`：点名法只覆盖写那个断言时想到的两种后缀 —— 实现将来多
/// 一种中间产物就假绿；反过来，谁在夹具里留下同名残留就假红，而那个「谁」根本不在本
/// 用例的控制范围里。整个根扫一遍，两个方向的误判都没有了。
fn residue_in(root: &Path, allowed: &[&str]) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| !allowed.contains(&name.as_str()))
        .collect();
    out.sort();
    out
}

/// 整棵树 → 相对路径(小写) → **全部字节**。用来证明「源一个字节都没变」。
pub(crate) fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, out);
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_ascii_lowercase();
            out.insert(rel, std::fs::read(&path).unwrap_or_default());
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn temp_sibling(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_os_string();
    name.push(".migrating");
    PathBuf::from(name)
}

/// V4 的影子副本目录（`<target>.migrating.v4-src`）：**任何出口都不许残留**。
///
/// `verify.rs::shadow_facts` 现在把「复制 + 开库」收进 `fill_shadow`，在唯一出口
/// `remove_dir_all`，所以成功和失败两条路都得干净。这里把「失败」那条也钉住。
fn shadow_sibling(target: &Path) -> PathBuf {
    let mut name = temp_sibling(target).into_os_string();
    name.push(".v4-src");
    PathBuf::from(name)
}

// ---------------------------------------------------------------------------
// A1（只复制不删除）在 `portable_dir_qa_source.rs`：那条用例红了，
// 单独一个文件好让报告指得准，不把 A2–A5 一起拖红。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A2：幂等 —— 第二次既不重跑也不动目标里已有的东西
// ---------------------------------------------------------------------------
#[tokio::test]
async fn a2_second_run_neither_copies_nor_touches_target() {
    /* 独立夹具根：`source` 与 `target` 都在 `root` 里面，于是**所有**按 target 派生的
       中间产物（`<target>.migrating` / `<target>.migrating.v4-src` / 将来新增的任何后缀）
       都落在同一个目录下，收尾时用「根里除了 source 和 target 不许有别的东西」一句审计
       干净。原来 source/target 是两个互不相干的随机目录、残留按名字点名，见 `residue_in`
       的注释：漏一种后缀是假绿，别人留下同名东西是假红 —— QA 记录的那条 flaky 就是
       「分不清是谁留下的」。 */
    let root = temp("qa-a2");
    let source = root.join("source");
    let target = root.join("target");
    seed_legacy_db(&source).await;

    match mig::run_once(&source, &target) {
        mig::Outcome::Migrated(_) => {}
        other => panic!("第一次应迁移成功，实为 {other:?}"),
    }

    let sentinel_doc = target.join("qa-sentinel.txt");
    std::fs::write(&sentinel_doc, b"do-not-touch").expect("写哨兵");
    let db_before = std::fs::read(target.join("timing.db")).expect("读目标库");

    match mig::run_once(&source, &target) {
        mig::Outcome::AlreadyPresent(path) => assert_eq!(path, target),
        other => panic!("第二次应为 AlreadyPresent，实为 {other:?}"),
    }
    assert_eq!(
        std::fs::read(&sentinel_doc).expect("哨兵应仍在"),
        b"do-not-touch",
        "第二次跑不许动目标里已有的文件"
    );
    assert_eq!(
        std::fs::read(target.join("timing.db")).expect("目标库应仍在"),
        db_before,
        "第二次跑不许覆盖目标库"
    );
    /* 临时目录 / V4 影子副本目录 / 以及任何以后新增的中间产物，一并靠这一句守住。
       真实存在的条目名会原样打出来，报告里直接能看出是谁留下的。 */
    assert_eq!(
        residue_in(&root, &["source", "target"]),
        Vec::<String>::new(),
        "迁移在夹具根里留下了中间产物（临时目录 / 影子副本未清理）"
    );
}

// ---------------------------------------------------------------------------
// A3：绝不覆盖新数据 —— 目标库与源库内容不同
// ---------------------------------------------------------------------------
#[tokio::test]
async fn a3_existing_target_db_is_never_overwritten() {
    let source = legacy_with_db("qa-a3-src").await;
    /* 目标是一份「用户已经用了两天」的新数据：真实库结构 + 一条可识别的行。 */
    let target = temp("qa-a3-dst");
    let pool = db::init_pool(&target).await.expect("建新库");
    crate::tests::support::new_item(&pool, "QA 新数据").await;
    pool.close().await;
    let before = snapshot(&target);

    match mig::run_once(&source, &target) {
        mig::Outcome::AlreadyPresent(path) => assert_eq!(path, target),
        other => panic!("目标已有库时必须是 AlreadyPresent，实为 {other:?}"),
    }
    assert_eq!(snapshot(&target), before, "目标目录一个字节都不许变");
    assert!(!temp_sibling(&target).exists(), "不该留下临时目录");
}

// ---------------------------------------------------------------------------
// A4：失败路径 —— 不 panic、不静默成功、不留脏
// ---------------------------------------------------------------------------
#[test]
fn a4_corrupt_source_db_fails_cleanly_and_cleans_temp() {
    let source = temp("qa-a4-src");
    std::fs::create_dir_all(&source).expect("建源目录");
    /* 非 SQLite 的「库」：复制必然成功，校验必然失败 —— 正好落在 verify 阶段。 */
    std::fs::write(source.join("timing.db"), b"this-is-not-a-sqlite-file").expect("写坏库");
    let target = temp("qa-a4-dst");

    let outcome = mig::run_once(&source, &target);
    let stage = match outcome {
        mig::Outcome::Failed { stage, ref reason } => {
            assert!(!reason.is_empty(), "失败必须给原因");
            stage
        }
        other => panic!("坏库必须判 Failed（不许静默成功），实为 {other:?}"),
    };
    assert_eq!(stage, "verify", "坏库应在校验阶段失败");
    assert!(
        !temp_sibling(&target).exists(),
        "失败后必须清理 data.migrating"
    );
    assert!(
        !shadow_sibling(&target).exists(),
        "失败后也必须清理 V4 影子副本目录，实留：{}",
        shadow_sibling(&target).display()
    );
    assert!(!target.exists(), "校验失败时不许把半成品换名成数据目录");
    /* 源依旧原样（只读源这条在失败路径上同样成立）。 */
    assert_eq!(
        std::fs::read(source.join("timing.db")).expect("源库仍可读"),
        b"this-is-not-a-sqlite-file"
    );
}

// ---------------------------------------------------------------------------
// A5：旧目录无库但有 logs → NoLegacy，且不创建目标
// ---------------------------------------------------------------------------
#[tokio::test]
async fn a5_logs_without_db_is_no_legacy_and_creates_nothing() {
    let source = temp("qa-a5-src");
    seed_legacy_extras(&source);
    let target = temp("qa-a5-dst");

    match mig::run_once(&source, &target) {
        mig::Outcome::NoLegacy => {}
        other => panic!("判据只看 timing.db，只有 logs 时必须 NoLegacy，实为 {other:?}"),
    }
    assert!(!target.exists(), "不搬就不许创建目标目录");
    assert!(!temp_sibling(&target).exists(), "更不许留下临时目录");
}

// ---------------------------------------------------------------------------
// B6 / B7：可写性探测
// ---------------------------------------------------------------------------
#[test]
fn b6_b7_probe_rejects_file_as_parent_and_leaves_no_residue() {
    let base = temp("qa-b67");
    std::fs::create_dir_all(&base).expect("建目录");
    let blocker = base.join("blocker");
    std::fs::write(&blocker, b"x").expect("写占位文件");

    let err = portable_probe::probe(&blocker.join("data")).expect_err("文件下面建不了目录");
    assert!(err.contains("无法创建目录"), "原因要能直接给用户看：{err}");
    assert_eq!(
        std::fs::read(&blocker).expect("占位文件仍应在"),
        b"x",
        "探测不许破坏挡路的那个文件"
    );
    assert_eq!(
        std::fs::read_dir(&base).expect("读目录").count(),
        1,
        "探测失败也不许留下任何东西"
    );

    /* 成功路径：目录里只应剩下调用方自己建的东西。 */
    let ok = base.join("ok");
    portable_probe::probe(&ok).expect("临时目录应可写");
    let names: Vec<String> = std::fs::read_dir(&ok)
        .expect("读目录")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    assert!(names.is_empty(), "探测文件必须删掉，实剩：{names:?}");
    std::fs::remove_dir_all(&base).ok();
}
