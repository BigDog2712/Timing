//! QA 独立验收 · V0.11.17 「第 1 关对 403 放行」的**反向攻击**（上一轮没验完的那条）。
//!
//! ## 这一条为什么必须存在
//!
//! V0.11.17 的 B1 把「目录 GET 回 403」从**账号失败**改判成**通过**（坚果云对目录
//! 不发 GET，回 403 是常态）。这类「把误报改掉」的修法有一个天然的反向风险：**把漏报
//! 换进来**——如果 403 一律放行，那么「真的没有写权限」的账号也会一路绿到底，
//! 用户拿到的是一句「账号、目录、写入都通过」，然后每一轮同步都失败。
//!
//! 已有的三条用例各自只钉了一半：
//! - `directory_get_403_is_not_an_account_failure`：GET 403 + **PUT 好** → 绿；
//! - `mkcol_403_on_existing_dir_is_green_when_writable`：MKCOL 403 + **PUT 好** → 绿；
//! - `put_forbidden_points_at_the_drag_experiment`：**GET 好** + PUT 403 → 红。
//!
//! 缺的正是两条都在拒的组合。本文件补两条：
//! 1. 目录 **GET 403** 且 **PUT 403** → 必须红（403 放行不许顺手放过真正的权限错误）；
//! 2. 目录 **GET 403** + **MKCOL 403** + **PUT 403** → 必须红，且红在「目录」关
//!    （不是「账号」关——账号那关的 403 是"服务端不肯列目录"，不是"凭据错"）。
//!
//! ## 判据同时要求「红在哪一关」对得上
//!
//! 只断言 `ok == false` 还不够：把 403 判成「账号错」也是一种红，但那是上一轮刚修掉的
//! 误报。所以这两条用例都额外断言第 1 关（账号）**是绿的**，且失败关不是 `account`。

use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud, MdSyncTestResult};
use crate::models::md_sync_config::MdSyncConfig;
use crate::services::md_cloud;
use crate::tests::fake_webdav_dir::DirServer;
use crate::tests::support::fresh_pool;

/// 与默认预填值同形（含中文目录；不含三位连续数字，见下）
const DIR: &str = "/我的坚果云/Timing";

fn config(server: &DirServer) -> MdSyncConfig {
    MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: Vec::new(),
        cloud: Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::Webdav,
            base_url: server.base_url.clone(),
            base_path: DIR.into(),
            user: "qa@example.com".into(),
            ..Default::default()
        }),
    }
}

async fn probe(server: &DirServer) -> MdSyncTestResult {
    let pool = fresh_pool("qa-probe-403").await;
    md_cloud::test_connection(&pool, &config(server), Some("app-pass"))
        .await
        .expect("测试连接本身不该返回 Err（结论写在 ok/detail 里）")
}

/// 失败关的 `key`（`None` = 全部通过）
fn failed_step_key(result: &MdSyncTestResult) -> Option<&str> {
    result.steps.iter().find(|step| !step.ok).map(|step| step.key.as_str())
}

/// 目录 GET 被拒 **不是** 账号失败：这一关必须绿着走完。
#[track_caller]
fn assert_account_step_passed(result: &MdSyncTestResult) {
    let account = result.steps.iter().find(|step| step.key == "account");
    assert!(
        matches!(account, Some(step) if step.ok),
        "目录 GET 403 不许判成账号失败（那正是 V0.11.17 修掉的误报）：{:?}",
        result.steps
    );
}

/// 失败文案里不许出现裸三位数字（全项目同一条纪律：状态码只进日志）。
#[track_caller]
fn assert_no_status_code(result: &MdSyncTestResult) {
    let mut texts = vec![result.detail.clone()];
    texts.extend(result.steps.iter().filter_map(|step| step.detail.clone()));
    for text in texts {
        let chars: Vec<char> = text.chars().collect();
        for window in chars.windows(3) {
            assert!(
                !window.iter().all(char::is_ascii_digit),
                "文案里出现了裸三位数字：{text}"
            );
        }
    }
}

/// **本文件的主判据**：目录 GET 403 + 写探针 PUT 403 → 必须红。
///
/// 这是「403 放行」的反向攻击：放行 GET 403 是为了不让坚果云那种服务端把好账号判死，
/// 但「既列不出目录、也写不进去」的账号是真的不能用，不许绿。
#[tokio::test]
async fn get_403_and_put_403_still_reports_red() {
    let server = DirServer::new(&[]);
    server.fail_get_with(403); // 目录 GET 被拒
    server.fail_put_with(403); // 连写探针也被拒 —— 「没有写权限」的形状

    let result = probe(&server).await;

    assert!(
        !result.ok,
        "目录 GET 与写探针都 403 = 真的没有写权限，不许绿：{}",
        result.detail
    );
    assert_account_step_passed(&result);
    assert_eq!(
        failed_step_key(&result),
        Some("write"),
        "目录建得出来、只是写不进去 → 红在「写入」关：{:?}",
        result.steps
    );
    /* 红字必须给一句人话（不是空白、不是状态码） */
    assert!(!result.detail.trim().is_empty(), "红字不许是空串");
    assert!(
        !result.detail.contains("都通过"),
        "既然失败了，文案里不许出现「都通过」：{}",
        result.detail
    );
    /* 绿字的判据是「真的写过一份文件」：这里必须**真的试过**才能下结论 */
    assert!(
        server
            .method_paths()
            .iter()
            .any(|hit| hit.starts_with("PUT ") && hit.contains("timing-write-test")),
        "写探针必须真的发出去过（不许凭 GET 403 直接判红）：{:?}",
        server.method_paths()
    );
    assert_no_status_code(&result);
}

/// GET 403 + MKCOL 403 + PUT 403（「目录已存在但只读」与「根本没建出来」两种成因都归它）
/// → 必须红，且红在「目录」关（不回到「账号」关的误报）。
#[tokio::test]
async fn get_403_with_mkcol_403_and_put_403_reports_red_at_dir() {
    let server = DirServer::new(&[]);
    server.fail_get_with(403);
    server.fail_mkcol_at(DIR, 403);
    server.fail_put_with(403);

    let result = probe(&server).await;

    assert!(!result.ok, "三处 403 绝不许绿：{}", result.detail);
    assert_account_step_passed(&result);
    assert_eq!(
        failed_step_key(&result),
        Some("dir"),
        "MKCOL 403 待写入验证、写入也失败 → 结论落在「目录」关：{:?}",
        result.steps
    );
    assert_no_status_code(&result);
}

/// 对照（防止上两条靠「一律报红」变绿）：GET 403 + **PUT 好** 仍然必须绿。
///
/// 与 `md_webdav_probe.rs` 的 B1 用例重复断言一次是**故意的**：本文件是「403 放行」的
/// 回归面，两个方向必须在同一个文件里并排，改任何一边都会立刻看到另一边。
#[tokio::test]
async fn get_403_with_working_put_stays_green() {
    let server = DirServer::new(&[]);
    server.fail_get_with(403);

    let result = probe(&server).await;

    assert!(result.ok, "能写进去就说明账号是好的，不许红：{}", result.detail);
    assert_eq!(result.steps.len(), 3, "三关都走到：{:?}", result.steps);
    assert!(result.steps.iter().all(|step| step.ok));
    assert_account_step_passed(&result);
}
