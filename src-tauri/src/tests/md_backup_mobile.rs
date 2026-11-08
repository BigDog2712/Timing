//! [V0.11.22] 手机端备份恢复的归属判据（PRD P2）。
//!
//! 判据本身在 `services::md_backup::restorable_on_mobile`，放 `services` 的理由与
//! `mobile_rounds` 一样：`commands::md_sync_cmd_mobile` 是 `#[cfg(mobile)]`，
//! 桌面目标的用例够不着它，那条规则就只能靠人看。
//!
//! 变异自证：把 `Some("webdav") => Ok(())` 改成 `Err(…)`，`webdav_backup_is_restorable`
//! 必红；把它改成 `=> Ok(())` 兜住所有分支（即删掉 obsidian 的拒绝），
//! `obsidian_backup_is_refused` 必红。

use crate::services::md_backup::restorable_on_mobile;

/// 云端那份：放行。这是手机上唯一有落点的归属。
#[test]
fn webdav_backup_is_restorable() {
    assert!(restorable_on_mobile("webdav__2026-11-06-20261108-120000.md").is_ok());
}

/// 电脑本地那份：拒绝，且理由里要写明「去电脑上恢复」——用户照着这句话就能办事。
#[test]
fn obsidian_backup_is_refused() {
    let err = restorable_on_mobile("obsidian__2026-11-06-20261108-120000.md")
        .expect_err("obsidian 归属的备份在手机上没有落点，必须拒绝");
    assert!(err.contains("电脑"), "拒绝理由必须说清去哪儿做：{err}");
}

/// 老备份（V0.11.13 之前，没有 `__` 前缀）：拒绝，不做推断。
/// 恢复是覆盖写，猜错落点就是数据正确性问题。
#[test]
fn legacy_backup_without_tag_is_refused() {
    /* 老备份也不是裸文件名：落点前缀是 v0.11.13 才加的，时间戳一直都在
       （`<原文件名>-<yyyyMMdd-HHmmss>.md`）。 */
    let err = restorable_on_mobile("2026-11-06-20261101-093000.md")
        .expect_err("无前缀的老备份归属不明，不能猜");
    assert!(err.contains("老格式") || err.contains("电脑"), "实得：{err}");
}

/// 名字不是 Timing 的备份：拒绝，且把名字回显出来（用户能看出点的是哪一条）。
#[test]
fn garbage_name_is_refused_with_echo() {
    let err = restorable_on_mobile("别的东西.md").expect_err("非备份文件名必须拒绝");
    assert!(err.contains("别的东西.md"), "实得：{err}");
}

/// `folder`（本地目录）落点在手机上同样不成立——它与 obsidian 是两种不同的拒绝理由，
/// 文案不能都写成同一句，否则用户不知道该切哪个落点。
#[test]
fn folder_backup_is_refused_as_unsupported() {
    let err = restorable_on_mobile("folder__2026-11-06-20261108-120000.md")
        .expect_err("folder 落点在手机上不存在");
    assert!(err.contains("WebDAV") || err.contains("电脑"), "实得：{err}");
}
