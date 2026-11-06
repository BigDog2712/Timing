//! 412 补救（V0.11.13，任务书 §4.5）：重拉 → 重跑合并 → 再 PUT 一次，**只重试一次**。
//!
//! 单独一个文件是为了行数：`md_cloud_round.rs` 已经装着分派 / 指纹 / 目录通道三条线，
//! 再把「真 HTTP 的冲突路径」塞进去就越过 300 行硬约束。两者也不共享夹具之外的任何东西
//! ——这里要的是一个会稳定回 412 的假服务器，那边一条网络都不发。
//!
//! 为什么必须真 HTTP：「PUT 被拒」本身就是被测行为的输入。用桩替换掉 `md_webdav::put`
//! 之后，「重试了一次」「用的是新 ETag」这两条都变成在验证自己的桩。

use std::fs;

use crate::infra::md_webdav::WebdavTarget;
use crate::models::md_sync::MdSyncReport;
use crate::repositories::md_cloud_pending;
use crate::services::md_cloud::{pending, round_push};
use crate::tests::md_sync::{env, TIMERS_HEADING};
use crate::tests::md_webdav::{header_value, serve_412_on_put};
use crate::tests::support::{insert_saved, new_item, unique_dir};
use crate::platform::clock::now_ms;

/// 任务书 §4.5 的机器证据。四条断言各有分工——
/// ① 请求序列恰为 PUT/GET/PUT（多一次少一次都违反「只重试一次」）；
/// ② 重试那次 `If-Match` 必须用重拉拿到的 ETag（拿旧的会再吃一次 412，等于没重试）；
/// ③ 合并真的重跑了（远端手改留在落点文件里，且区块被重新渲染）；
/// ④ 仍失败时欠账保留、且 `pending_since` 不被刷新。
#[tokio::test]
async fn conflict_retries_once_then_keeps_the_debt() {
    let fixture = env("cloud-412").await;
    let today = fixture.date.format("%Y-%m-%d").to_string();
    let cloud_root = unique_dir("cloud-412-root");
    fs::create_dir_all(&cloud_root).expect("建云端落点目录");

    /* 库里得有一条记录，否则「重跑合并」渲染出空内容、什么都证明不了。 */
    let item = new_item(&fixture.pool, "写作").await;
    let at = now_ms();
    insert_saved(&fixture.pool, item, at - 600_000, at, 600).await;

    /* 本地那份与远端不同：远端是用户在另一台设备上手写的。 */
    let local = "# 本地\n\n本地手改";
    let path = cloud_root.join(format!("{today}.md"));
    fs::write(&path, local).expect("写本地落点文件");

    /* 先按 ⑦ 的口径记一笔欠账：412 的补救走完之后它必须还在。 */
    let since = 1_000i64;
    assert!(
        pending::record_if_changed(&fixture.pool, &today, local, since)
            .await
            .expect("记账应成功"),
        "第一次看到内容 → 必须记一笔"
    );

    let fake = serve_412_on_put("# 远端手改".as_bytes(), "W/\"remote\"");
    let target = WebdavTarget::new(&fake.base_url, "/Timing/md", "u", "p");
    let mut report = MdSyncReport::new(now_ms());

    round_push::push_today(
        &fixture.pool,
        &target,
        &today,
        local,
        None,
        &cloud_root,
        &mut report,
    )
    .await
    .expect("412 是「这一轮没传上去」，不是 AppError");

    assert_eq!(
        fake.count(),
        3,
        "请求序列必须是 PUT → GET → PUT（只重试一次），实际 {} 次",
        fake.count()
    );
    assert!(
        fake.request(1)
            .starts_with(&format!("GET /Timing/md/{today}.md ")),
        "第二个请求必须是重拉：{}",
        fake.request(1)
    );
    assert_eq!(
        header_value(&fake.request(2), "if-match").as_deref(),
        Some("W/\"remote\""),
        "重试必须用刚 GET 到的 ETag 做 If-Match，否则再吃一次 412 等于没重试"
    );

    let detail = report.errors.join("；");
    assert!(
        detail.contains("重试一次仍未成功"),
        "仍 412 要记进 report.errors，不能静默：{detail}"
    );

    let row = md_cloud_pending::get(&fixture.pool, &today)
        .await
        .expect("查询应成功")
        .expect("欠账行应还在");
    assert_eq!(
        row.pending_since, since,
        "重试失败 → 欠账保留，且欠账时间不许被刷新"
    );

    /* 重跑合并的证据：远端那份手改进了落点文件（`sync_all` 按「Markdown 赢」导入后再
    整体重渲染，于是重试那次 PUT 的内容含两端改动）。 */
    let merged = fs::read_to_string(&path).expect("落点文件应可读");
    assert!(
        merged.contains("远端手改"),
        "重拉到的内容必须留在落点文件里:\n{merged}"
    );
    assert!(
        merged.contains(TIMERS_HEADING),
        "合并要重新渲染出区块标题:\n{merged}"
    );
    let _ = fs::remove_dir_all(&cloud_root);
}
