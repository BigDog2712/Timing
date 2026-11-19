//! 手柄「启动应用」的授权名单（[R1]）。
//!
//! 这组判据守的是**唯一一条能把「一次界面注入」变成「本机任意代码执行」的路**：
//! `run_handle_custom_action({kind:"launch", path:"C:\\evil.exe"})` 只要被放行，
//! 攻击者就不需要再借任何别的漏洞。所以这里既验「授权后才放行」，也验
//! 「**所有**不合法形状都必须被拒」—— 尤其是目录、相对路径、不存在的路径：
//! 它们不是「边界情况」，而是把名单当成「随便写个字符串就行」时会漏掉的三条。
//!
//! 授权事实来自「用户在原生对话框里点过确认」，测试里用 `authorize()` 直接构造那一半
//! （对话框本身无法在无头环境里点）。

use crate::error::ErrorCode;
use crate::services::handle_launch;
use crate::tests::support::{expect_err, fresh_pool, unique_dir};

/// 造一个真实存在的文件，返回它的绝对路径。
///
/// 必须是真的：`canonical_target` 会 `canonicalize`，不存在的路径再怎么拼也过不去。
fn real_file(tag: &str) -> String {
    let dir = unique_dir(tag);
    std::fs::create_dir_all(&dir).expect("临时目录应可建");
    let path = dir.join("target.exe");
    std::fs::write(&path, b"MZ").expect("临时文件应可写");
    path.to_string_lossy().to_string()
}

#[tokio::test]
async fn hl01_unlisted_path_is_rejected() {
    let pool = fresh_pool("handle-launch-01").await;
    let path = real_file("handle-launch-01");
    assert!(
        !handle_launch::is_authorized(&pool, &path)
            .await
            .expect("查询应成功"),
        "用户没在对话框里选过的路径，必须一律不放行"
    );
}

#[tokio::test]
async fn hl02_authorize_then_that_path_passes() {
    let pool = fresh_pool("handle-launch-02").await;
    let path = real_file("handle-launch-02");
    let granted = handle_launch::authorize(&pool, &path)
        .await
        .expect("授权应成功");
    assert!(
        handle_launch::is_authorized(&pool, &granted)
            .await
            .expect("查询应成功"),
        "刚授权过的路径必须放行，否则用户选完也点不动"
    );
}

#[tokio::test]
async fn hl03_the_same_file_written_differently_still_matches() {
    /* 规范化不是洁癖：不做的话，`C:\Apps\x.exe` 与 `C:\Apps\.\x.exe` 会被当成两个路径，
    用户看到「明明选过却说未授权」。 */
    let pool = fresh_pool("handle-launch-03").await;
    let raw = real_file("handle-launch-03");
    let path = std::path::Path::new(&raw);
    let granted = handle_launch::authorize(&pool, &path.to_string_lossy())
        .await
        .expect("授权应成功");
    let variant = path
        .parent()
        .map(|dir| dir.join(".").join("target.exe"))
        .expect("临时文件必有父目录");
    assert!(
        handle_launch::is_authorized(&pool, &variant.to_string_lossy())
            .await
            .expect("查询应成功"),
        "同一个文件的另一种写法（带 `./`）也必须认出来"
    );
    assert_eq!(
        granted,
        handle_launch::canonical_target(&variant.to_string_lossy()).expect("应能规范化")
    );
}

#[tokio::test]
async fn hl04_directory_is_not_launchable() {
    let pool = fresh_pool("handle-launch-04").await;
    let dir = unique_dir("handle-launch-04");
    std::fs::create_dir_all(&dir).expect("临时目录应可建");
    assert_eq!(
        expect_err(handle_launch::authorize(&pool, &dir.to_string_lossy()).await),
        ErrorCode::CustomActionDenied,
        "只能授权文件；目录进了名单就等于「谁都能往里塞一个 exe 再执行」"
    );
}

#[tokio::test]
async fn hl05_relative_path_is_rejected() {
    /* 相对路径按**当前工作目录**解析，而便携版的工作目录可能跟着 U 盘走 ——
    同一个绑定在不同次启动会指向不同文件，授权名单就失去意义。 */
    let pool = fresh_pool("handle-launch-05").await;
    assert_eq!(
        expect_err(handle_launch::authorize(&pool, "target.exe").await),
        ErrorCode::CustomActionDenied
    );
}

#[tokio::test]
async fn hl06_missing_path_is_rejected() {
    let pool = fresh_pool("handle-launch-06").await;
    let ghost = unique_dir("handle-launch-06").join("ghost.exe");
    assert_eq!(
        expect_err(handle_launch::authorize(&pool, &ghost.to_string_lossy()).await),
        ErrorCode::CustomActionDenied
    );
}

#[tokio::test]
async fn hl07_authorizing_twice_does_not_duplicate() {
    /* 用户可能会为两格手柄选同一个程序：名单里只该有一条，否则每次重复授权都在
    消耗上限，最后把真在用的条目挤掉。 */
    let pool = fresh_pool("handle-launch-07").await;
    let path = real_file("handle-launch-07");
    handle_launch::authorize(&pool, &path)
        .await
        .expect("第一次授权应成功");
    handle_launch::authorize(&pool, &path)
        .await
        .expect("第二次授权应成功");
    let raw = crate::repositories::settings::get_value(&pool, "handle.launchTargets")
        .await
        .expect("读名单应成功")
        .expect("名单键必须已写入");
    let list: Vec<String> = serde_json::from_str(&raw).expect("名单应是 JSON 数组");
    assert_eq!(list.len(), 1, "同一路径不该出现两条：{list:?}");
}
