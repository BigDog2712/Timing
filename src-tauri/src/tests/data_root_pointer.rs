//! 数据根指针的读写（V0.11.15，设计 §3.1）+ 「指针优先于 optout」的纯函数判据（§3.2）。
//!
//! 每个用例独占一个临时目录：同进程并行跑时共用一个目录会互相删文件。
//! **不碰** `app_dir::set()`（`OnceLock` 不可清除，会污染并行用例）。

use std::path::PathBuf;

use crate::infra::root_pointer::{self, RootPointer, POINTER_FILE};
use crate::services::data_root::{decide, PointerChoice};

fn temp(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "timing-dataroot-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("建临时目录");
    dir
}

#[test]
fn write_read_roundtrip_keeps_previous() {
    let dir = temp("roundtrip");
    root_pointer::write(&dir, r"D:\TimingData", Some(r"C:\Tools\Timing\data")).expect("写指针");
    let back = root_pointer::read(&dir).expect("刚写的指针读得回来");
    assert_eq!(back.data_dir, r"D:\TimingData");
    assert_eq!(back.previous.as_deref(), Some(r"C:\Tools\Timing\data"));
    assert_eq!(back.schema, 1, "schema 是给未来的自己看的，不能被写成别的值");
    assert!(back.at.contains('T'), "时刻要带时区（RFC 3339）：{}", back.at);
    assert_eq!(back.app_version, env!("CARGO_PKG_VERSION"));
    std::fs::remove_dir_all(&dir).ok();
}

/// 没有 `previous` 时不许写出空串：空串与「没有」在前端是两种意思。
#[test]
fn missing_previous_round_trips_as_none() {
    let dir = temp("no-previous");
    root_pointer::write(&dir, r"D:\Data", Some("  ")).expect("写指针");
    assert_eq!(root_pointer::read(&dir).expect("读回").previous, None);
    std::fs::remove_dir_all(&dir).ok();
}

/// 坏 JSON / 半截写入 → 当不存在（不能让一个被编辑器改坏的文件永久卡住启动）。
#[test]
fn bad_json_and_empty_dir_are_treated_as_absent() {
    let dir = temp("bad");
    std::fs::write(dir.join(POINTER_FILE), b"{ not json").expect("写坏指针");
    assert!(root_pointer::read(&dir).is_none(), "坏 JSON 要当不存在");

    /* 空 dataDir 等于「把数据根指到进程 CWD」，比没有指针更糟。 */
    std::fs::write(
        dir.join(POINTER_FILE),
        br#"{"schema":1,"at":"2026-11-07T10:00:00+08:00","appVersion":"0.11.15","dataDir":"  "}"#,
    )
    .expect("写空路径指针");
    assert!(root_pointer::read(&dir).is_none(), "空 dataDir 要当不存在");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn clear_is_idempotent() {
    let dir = temp("clear");
    root_pointer::write(&dir, r"D:\Data", None).expect("写指针");
    root_pointer::clear(&dir).expect("删得掉");
    assert!(root_pointer::read(&dir).is_none());
    root_pointer::clear(&dir).expect("再删一次不该报错（幂等）");
    std::fs::remove_dir_all(&dir).ok();
}

/// 指针 > optout：用户主动设的自定义根必须优先于「程序自动回退」，否则他设了也
/// 永远不生效（PRD 4.2）。这是本轮唯一能用纯函数钉住这条优先级的地方。
#[test]
fn pointer_beats_optout() {
    let pointer = RootPointer {
        schema: 1,
        at: "2026-11-07T10:00:00+08:00".into(),
        app_version: "0.11.15".into(),
        data_dir: r"D:\TimingData".into(),
        previous: None,
    };
    assert_eq!(
        decide(Some(&pointer), true),
        PointerChoice::UsePointer,
        "有指针时 optout 一律不参与判定"
    );
    assert_eq!(decide(Some(&pointer), false), PointerChoice::UsePointer);
    assert_eq!(decide(None, true), PointerChoice::Default, "没指针才轮到 optout");
    assert_eq!(decide(None, false), PointerChoice::Default);
}
