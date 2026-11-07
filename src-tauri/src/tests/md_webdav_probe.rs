//! 「测试连接」三关的机器证据（V0.11.16，设计 §4.4 / PRD E3–E7）。
//!
//! 五条用例各钉一件事：
//! 1. 第 2 关 403 → 文案指出**卡在哪一级**，且只走到第 2 关；
//! 2. 第 2 关 400 → 文案点出那一级「有服务端不接受的字符」；
//! 3. 第 3 关 403 → 文案给出「拖一个文件」这个对照实验，且三关都出现过；
//! 4. 绿字之前真的 PUT 过探针、之后真的 DELETE 过（不是只 GET 一下就说「能写」）；
//! 5. DELETE 回 404（清理失败）不影响绿字。
//!
//! 假服务器是路由式的 `DirServer`（`dirs` 是它的真实状态），路径用**中文**目录
//! `/我的坚果云/Timing`——那正是默认预填值的形状（PRD E8 / R13）。
//!
//! **不许出现三位数字**：失败文案里的裸状态码由 `md_webdav_text.rs` 全量断言；本文件
//! 末尾那条 `no_status_code_leaks_into_any_verdict` 补上**绿字与 `steps`**——`md_webdav_text`
//! 只管得到 `fail_text`，管不到 `probe` 自己拼的摘要句。

use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud, MdSyncTestResult};
use crate::models::md_sync_config::MdSyncConfig;
use crate::services::md_cloud;
use crate::tests::fake_webdav_dir::DirServer;
use crate::tests::support::fresh_pool;

/// 与默认预填值同形（含中文，且不含三位连续数字）
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

/// 走一次「测试连接」。密码用显式入参，避免碰系统凭据库。
async fn probe(server: &DirServer) -> MdSyncTestResult {
    let pool = fresh_pool("md-probe").await;
    md_cloud::test_connection(&pool, &config(server), Some("app-pass"))
        .await
        .expect("测试连接本身不该返回 Err（失败写在 ok/detail 里）")
}

/// 某一关的原文（`None` = 这一关没走到）
fn detail_of(result: &MdSyncTestResult, key: &str) -> Option<String> {
    result
        .steps
        .iter()
        .find(|step| step.key == key)
        .and_then(|step| step.detail.clone())
}

/// `detail` 与每一关的原文里都不许出现裸的三位数字（PRD E7）。
///
/// 这条比 `md_webdav_text.rs` 那条宽一格：那边只看 `fail_text` 的返回值，而绿字
/// （`账号、目录、写入都通过…`）与 `TooDeep` 摘要是 `probe` 自己拼的，走不到那边。
fn assert_no_status_code(result: &MdSyncTestResult, scene: &str) {
    let mut texts = vec![result.detail.clone()];
    texts.extend(result.steps.iter().filter_map(|step| step.detail.clone()));
    for text in texts {
        let bytes: Vec<char> = text.chars().collect();
        for window in bytes.windows(3) {
            assert!(
                !window.iter().all(char::is_ascii_digit),
                "{scene}：文案里出现了裸三位数字：{text}"
            );
        }
    }
}

#[tokio::test]
async fn mkcol_forbidden_names_the_level_and_stops_at_dir() {
    let server = DirServer::new(&[]);
    /* 第 1 级（/我的坚果云）建得出来，第 2 级被拒 */
    server.fail_mkcol_at(DIR, 403);

    let result = probe(&server).await;
    assert!(!result.ok, "第 2 关红 → 整体不许绿");
    assert_eq!(result.steps.len(), 2, "第 3 关一次请求都不该发");
    assert!(result.steps[0].ok, "第 1 关（账号）应通过");
    assert_eq!(result.steps[1].key, "dir");
    assert!(!result.steps[1].ok);

    let text = detail_of(&result, "dir").expect("第 2 关必须带原文");
    assert!(text.contains("这一级建不出来"), "文案要点明是「哪一级」：{text}");
    assert!(text.contains(DIR), "文案必须带出卡住的那一级路径：{text}");
    assert!(text.contains("新建文件夹"), "必须给一个用户当场能做的动作：{text}");
    /* 摘要句就是那一关的原文（不拼接、不改写） */
    assert_eq!(result.detail, text);
    /* 一次 MKCOL 都不许碰探针文件 */
    assert!(!server
        .method_paths()
        .iter()
        .any(|hit| hit.contains("timing-write-test")));
}

#[tokio::test]
async fn mkcol_bad_request_blames_the_characters() {
    let server = DirServer::new(&[]);
    server.fail_mkcol_at(DIR, 400);

    let result = probe(&server).await;
    assert_eq!(result.steps.len(), 2);
    let text = detail_of(&result, "dir").expect("第 2 关必须带原文");
    assert!(text.contains("不接受的字符"), "{text}");
    assert!(text.contains(DIR), "要指出是哪一个目录名不合法：{text}");
    assert!(!result.ok);
}

#[tokio::test]
async fn put_forbidden_points_at_the_drag_experiment() {
    let server = DirServer::new(&[]);
    /* 目录建得出来，但 PUT 被拒 = 「建不出来」之外的另一类 403 */
    server.fail_put_with(403);

    let result = probe(&server).await;
    assert!(!result.ok);
    assert_eq!(result.steps.len(), 3, "红在第 3 关：三关都出现过");
    assert!(result.steps[0].ok && result.steps[1].ok);
    assert!(!result.steps[2].ok);

    let text = detail_of(&result, "write").expect("第 3 关必须带原文");
    assert!(text.contains("拖一个文件"), "必须给那个对照实验：{text}");
    assert!(text.contains("写不进去"), "{text}");
    /* 第 3 关的 403 不许再说「建不出来」（那就是本轮要拆掉的那句话） */
    assert!(!text.contains("建不出来"), "{text}");
    assert!(!text.contains("新建文件夹"), "{text}");
}

#[tokio::test]
async fn green_means_a_real_put_then_a_delete() {
    let server = DirServer::new(&[]);
    let result = probe(&server).await;

    assert!(result.ok, "全绿：{}", result.detail);
    assert_eq!(result.steps.len(), 3);
    assert!(result.steps.iter().all(|step| step.ok));
    assert!(result.detail.contains("账号、目录、写入都通过"), "{}", result.detail);

    /* 末两条必须是「PUT 探针 → DELETE 探针」（文件名是 ASCII，编码不影响这一段） */
    let paths = server.method_paths();
    let tail = &paths[paths.len() - 2..];
    assert_eq!(tail.len(), 2, "绿字必须建立在「真的写了一份文件」之上：{paths:?}");
    assert!(
        tail[0].starts_with("PUT ") && tail[0].ends_with("/timing-write-test.txt"),
        "第 3 关要先 PUT 探针：{paths:?}"
    );
    assert!(
        tail[1].starts_with("DELETE ") && tail[1].ends_with("/timing-write-test.txt"),
        "写完立刻删掉（不留痕迹）：{paths:?}"
    );
    /* 探针名不带点前缀：部分服务端拒收隐藏文件，会把「能写」误判成「不能写」 */
    assert!(!tail[0].contains("/.timing-write-test"));
}

#[tokio::test]
async fn cleanup_failure_keeps_the_green_result() {
    /* `DirServer` 对 DELETE 一律回 404（= 已经不在那儿了）。清理失败只该进日志，
       绿字不能被一个清理动作改红——否则「能写但删不掉」的服务端永远测不过。 */
    let server = DirServer::new(&[]);
    let result = probe(&server).await;

    assert!(result.ok, "DELETE 404 不该影响结论：{}", result.detail);
    assert!(result
        .steps
        .iter()
        .any(|step| step.key == "write" && step.ok));
    assert!(server
        .method_paths()
        .iter()
        .any(|hit| hit.starts_with("DELETE ")));
}

#[tokio::test]
async fn no_status_code_leaks_into_any_verdict() {
    /* 五种结局各走一遍：绿、第 1 关红（密码错）、第 2 关红、第 3 关红、超层级。
       文案里的裸状态码对用户零信息量，只该出现在日志里。 */
    let green = {
        let server = DirServer::new(&[]);
        probe(&server).await
    };
    let auth = {
        let server = DirServer::new(&[]);
        server.fail_get_with(401);
        probe(&server).await
    };
    let dir_403 = {
        let server = DirServer::new(&[]);
        server.fail_mkcol_at(DIR, 403);
        probe(&server).await
    };
    let write_403 = {
        let server = DirServer::new(&[]);
        server.fail_put_with(403);
        probe(&server).await
    };
    let write_500 = {
        let server = DirServer::new(&[]);
        server.fail_put_with(500);
        probe(&server).await
    };

    assert_no_status_code(&green, "全绿");
    assert_no_status_code(&auth, "第 1 关 401");
    assert_no_status_code(&dir_403, "第 2 关 403");
    assert_no_status_code(&write_403, "第 3 关 403");
    assert_no_status_code(&write_500, "第 3 关 500");

    /* 同时钉住「第 2、3 关不显示通过」：401 时 steps 只有一条且是失败那条 */
    assert_eq!(auth.steps.len(), 1, "第 1 关红 → 后续关一次请求都不发");
    assert_eq!(auth.steps[0].key, "account");
    assert!(!auth.steps[0].ok);

    /* [QA] 每个失败场景都必须真的**失败**：只断言「文案里没有三位数字」时，若某一天
       第 3 关被改成恒判成功（`write_403` 变成绿字），这条用例会照样通过——那正是
       E5「存在但只读的目录红在第 3 关」唯一的一条兜底。 */
    for (result, scene, steps) in [
        (&dir_403, "第 2 关 403", 2usize),
        (&write_403, "第 3 关 403", 3),
        (&write_500, "第 3 关 500", 3),
    ] {
        assert!(!result.ok, "{scene} 必须整体判失败：{}", result.detail);
        assert_eq!(result.steps.len(), steps, "{scene} 的关卡数不对");
        assert!(
            result.steps.iter().any(|step| !step.ok),
            "{scene} 必须留下一条失败关"
        );
    }
}
