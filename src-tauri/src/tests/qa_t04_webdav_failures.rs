//! QA 独立验收｜T04 变更 A 的 **WebDAV 半场**（V0.11.19，验收方自造）。
//!
//! 只放两条「用工程师的现成夹具造不出来」的判据：
//! - `i11_*`：**水位只推进到「失败项之前」**。需要「第 3 个失败、第 4 个成功」这种
//!   *按请求序* 变化的假服务器（`fake_webdav::serve` 所有请求回同一份，表达不了）；
//!   若实现把水位推到「最后一个成功项」，第 3 个就**永久漏删**，而这一档没有任何
//!   门禁能发现（不报错、不暂停、只是那一天再也不清）。
//! - `i10_*`：`403` / `429` 与 `401` 同档 —— 一出现就整批停，不再逐个试。

use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use crate::infra::md_webdav::WebdavTarget;
use crate::repositories::md_cloud_pending;
use crate::services::md_cloud::{self, purge};
use crate::tests::fake_webdav::{read_request, serve};
use crate::tests::md_cloud_purge::{kv, seed_past, state_of};
use crate::models::md_cloud_purge::{PurgeChannel, PurgeKey};
use crate::tests::md_sync::env;
use crate::tests::support::unique_dir;

/// 按**请求序**逐个回状态码的假服务器（第 n 个请求回 `statuses[n]`，用尽后回 `204`）。
struct Sequenced {
    base_url: String,
    seen: Arc<Mutex<Vec<String>>>,
}

impl Sequenced {
    fn lines(&self) -> Vec<String> {
        self.seen
            .lock()
            .expect("假服务器记录锁")
            .iter()
            .map(|raw| raw.lines().next().unwrap_or_default().to_string())
            .collect()
    }
}

fn serve_sequence(statuses: Vec<&'static str>) -> Sequenced {
    let listener = TcpListener::bind("127.0.0.1:0").expect("本地端口应可绑定");
    let port = listener.local_addr().expect("应能取到本地地址").port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for (index, stream) in listener.incoming().enumerate() {
            let Ok(mut stream) = stream else { return };
            let raw = read_request(&mut stream);
            log.lock().expect("假服务器记录锁").push(raw);
            let status = statuses.get(index).copied().unwrap_or("204 No Content");
            /* `Connection: close` 是必须的：复用连接的话「第 n 个请求」这条计数就不再
               等于「第 n 次 DELETE」，中间的失败档会被吞掉。 */
            let head = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.flush();
        }
    });
    Sequenced {
        base_url: format!("http://127.0.0.1:{port}"),
        seen,
    }
}

/// 造镜像目录 + 4 份往期（升序处理：01 → 02 → 03 → 04）。
async fn seed_four(pool: &sqlx::SqlitePool, root: &std::path::Path, month: &str) -> Vec<String> {
    fs::create_dir_all(root).expect("建镜像目录");
    let mut dates = Vec::new();
    for day in 1..=4 {
        let date = format!("2018-{month}-0{day}");
        seed_past(pool, root, &date).await;
        dates.push(date);
    }
    dates
}

/// `404` 是**成功**（幂等：本来就不在）。这条分支原先**没有任何用例盯着**。
///
/// 删掉 `remove.rs` 里那三行（`if code == 404 { return Ok(404) }`）不会报错、不会暂停、
/// 门禁也全绿 —— 行为只是变成「每个 404 的日期都不推进水位、不清账」，于是那些日期
/// 每一轮都重打一次 404，**永久停在同一格**（I15 的收敛路径正是靠 404 反复出现走完的）。
#[tokio::test]
async fn a_404_is_a_success_and_advances_the_watermark() {
    let fixture = env("qa-t04-404").await;
    let root = unique_dir("qa-t04-404");
    fs::create_dir_all(&root).expect("建镜像目录");
    let dates = ["2018-11-05", "2018-11-06"];
    for date in dates {
        seed_past(&fixture.pool, &root, date).await;
    }
    let fake = serve("404 Not Found", "", b"");
    let target = WebdavTarget::new(&fake.base_url, "/Timing", "u", "p");

    purge::run_webdav(&fixture.pool, &target, &root, &md_cloud::today())
        .await
        .expect("清理不该返回错误");

    assert_eq!(fake.count(), 2, "两份各一次 DELETE，404 不重试");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Upto)
            .await
            .as_deref(),
        Some(dates[1]),
        "404 算成功 → 水位照推（否则这一天永久停住）"
    );
    for date in dates {
        assert!(
            md_cloud_pending::get(&fixture.pool, date)
                .await
                .expect("查 pending")
                .is_none(),
            "{date}：404 成功也要清账"
        );
    }
    assert_eq!(
        state_of(&fixture.pool, PurgeChannel::Webdav)
            .await
            .last_deleted,
        2
    );
    let _ = fs::remove_dir_all(&root);
}

/// I11：第 3 个失败、第 4 个成功 → 水位必须停在**第 2 个**。
#[tokio::test]
async fn i11_the_watermark_stops_before_the_first_failure() {
    let fixture = env("qa-t04-watermark").await;
    let root = unique_dir("qa-t04-watermark");
    let dates = seed_four(&fixture.pool, &root, "06").await;
    let fake = serve_sequence(vec![
        "204 No Content",
        "204 No Content",
        "500 Internal Server Error",
        "204 No Content",
    ]);
    let target = WebdavTarget::new(&fake.base_url, "/Timing", "u", "p");

    purge::run_webdav(&fixture.pool, &target, &root, &md_cloud::today())
        .await
        .expect("清理不该返回错误");

    let lines = fake.lines();
    assert_eq!(lines.len(), 4, "四个候选各打一次，失败项不重试：{lines:?}");
    for (index, date) in dates.iter().enumerate() {
        assert!(
            lines[index].starts_with(&format!("DELETE /Timing/{date}.md ")),
            "第 {} 个请求该删 {date}，实际 {lines:?}",
            index + 1
        );
    }
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Upto)
            .await
            .as_deref(),
        Some(dates[1].as_str()),
        "水位只能到「最后一个前面没失败的成功项」= {}（推到 {} 就是永久漏删）",
        dates[1],
        dates[3]
    );
    for (index, date) in dates.iter().enumerate() {
        let left = md_cloud_pending::get(&fixture.pool, date)
            .await
            .expect("查 pending");
        let should_stay = index == 2;
        assert_eq!(
            left.is_some(),
            should_stay,
            "{date} 的 pending 行：失败项必须留着，成功的必须清掉"
        );
    }
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Day).await,
        None,
        "普通失败不写 day：下一轮接着试"
    );
    let state = state_of(&fixture.pool, PurgeChannel::Webdav).await;
    assert_eq!((state.last_deleted, state.last_failed), (3, 1));
    let _ = fs::remove_dir_all(&root);
}

/// I10：`403` / `429` 与 `401` 同档 —— 出现即整批停（只发一个请求），水位不动。
#[tokio::test]
async fn i10_403_and_429_abort_the_batch_like_401() {
    for (status, tag) in [
        ("403 Forbidden", "forbidden"),
        ("429 Too Many Requests", "rate"),
    ] {
        let fixture = env("qa-t04-abort").await;
        let root = unique_dir("qa-t04-abort");
        seed_four(&fixture.pool, &root, "02").await;
        let fake = serve(status, "", b"");
        let target = WebdavTarget::new(&fake.base_url, "/Timing", "u", "p");

        purge::run_webdav(&fixture.pool, &target, &root, &md_cloud::today())
            .await
            .expect("清理不该返回错误");

        assert_eq!(fake.count(), 1, "{tag} 之后一份都不许再试");
        assert_eq!(
            kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Upto).await,
            None,
            "{tag}：被中断的这批不推进水位"
        );
        assert_eq!(
            kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Day)
                .await
                .as_deref(),
            Some(md_cloud::today().as_str()),
            "{tag}：提前中断也写 day（今天别再试了）"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
