//! [R1] 「解绑」的端到端边界：**两处真源都清干净才不复活**。
//!
//! 从 `item_app_mirror_tests.rs` 分出来的（那边正好 300 行，是 `check:size` 硬限），
//! 夹具直接复用它的 `fixture` / `new_item` / `put` / `rows_for`。
//!
//! ## 为什么这条必须存在
//!
//! `item_app_mirror` 是「只增不减」的：它只按配置表补缺失的行，从不删。所以"用户解绑了"
//! 这件事**必须**由写路径落进配置表（分析窗 `saveAppItemBinding`：删 1:1 键 **并且**
//! 把 `__app_override::.itemBindings` 里那一条摘掉）。少了任何一处，下次开机就会把行
//! 补回来 —— 用户看到的是"我解绑了，重启又自动计时"。
//!
//! 这两条用例一条证明"两处都清 → 不复活"，一条证明"只清一处 → 一定复活"，
//! 于是那条不变量不再依赖前端自觉。

use sqlx::SqlitePool;

use super::item_app_mirror_tests::{fixture, new_item, put, rows_for};
use crate::services::item_app::{bind, unbind};
use crate::services::item_app_mirror::mirror;

/// 重写 override 的那一行（模拟 `saveAppItemBinding` 的第二半：摘掉 itemId）。
async fn rewrite_override(kv: &SqlitePool, exe: &str, item_ids: &[i64]) {
    let bindings: Vec<String> = item_ids
        .iter()
        .map(|item_id| format!("{{\"itemId\":{item_id}}}"))
        .collect();
    let value = format!(
        "{{\"enabled\":true,\"itemBindings\":[{}]}}",
        bindings.join(",")
    );
    put(kv, &format!("__app_override::{exe}"), &value).await;
}

/// 删 1:1 那一行（模拟 `saveAppItemBinding(exe, null)` 的第一半）。
async fn delete_single(kv: &SqlitePool, exe: &str) {
    sqlx::query("DELETE FROM settings WHERE key = ?1")
        .bind(format!("__app_item_binding::{exe}"))
        .execute(kv)
        .await
        .unwrap();
}

/// 两处都清干净 → 解绑之后再跑一次启动补镜像，一条都不许补。
#[test]
fn unbind_is_final_only_when_both_sources_are_cleaned() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let yanyun = new_item(&business, "燕云十六声").await;
        let code = new_item(&business, "写代码").await;

        /* 现场：弹窗保存把两条都镜像进了 item_app（发的是并集），排行卡又绑过 1:1（指向燕云）。
        注意不能靠 `mirror` 自己造出现场：口径 3「单事项键优先」下它只补 1:1 那一条
        （只少补、不删 —— 那是另一条已记账的口径，不是本用例的主题）。 */
        bind(&business, yanyun, "yanyun.exe", Some(1))
            .await
            .unwrap();
        bind(&business, code, "yanyun.exe", Some(1)).await.unwrap();
        rewrite_override(&kv, "yanyun.exe", &[yanyun, code]).await;
        put(
            &kv,
            "__app_item_binding::yanyun.exe",
            &format!("{{\"itemId\":{yanyun}}}"),
        )
        .await;

        /* 用户在事项编辑里解绑燕云：删 1:1 + 摘 override 里那一条 + 宿主解绑（前端三件事的顺序） */
        delete_single(&kv, "yanyun.exe").await;
        rewrite_override(&kv, "yanyun.exe", &[code]).await;
        unbind(&business, yanyun, "yanyun.exe").await.unwrap();

        let second = mirror(&business, &kv).await.unwrap();
        assert_eq!(second.inserted, 0, "两处都清了还被补回来");
        /* 同应用另一个事项不许受牵连（这正是 R1 里"发 [] 误删"的用户可见后果） */
        assert_eq!(rows_for(&business, "yanyun.exe").await, vec![(code, 1)]);
    });
}

/// 只清 1:1、override 里那条还在 → **一定**复活。这就是为什么写路径必须同时摘 override。
#[test]
fn leftover_override_entry_resurrects_the_unbound_row() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let yanyun = new_item(&business, "燕云十六声").await;
        rewrite_override(&kv, "yanyun.exe", &[yanyun]).await;
        put(
            &kv,
            "__app_item_binding::yanyun.exe",
            &format!("{{\"itemId\":{yanyun}}}"),
        )
        .await;
        mirror(&business, &kv).await.unwrap();

        /* 只删 1:1（老实现的解绑），override 没动 */
        delete_single(&kv, "yanyun.exe").await;
        unbind(&business, yanyun, "yanyun.exe").await.unwrap();

        let report = mirror(&business, &kv).await.unwrap();
        assert_eq!(report.inserted, 1, "override 里那条才是复活源");
        assert_eq!(rows_for(&business, "yanyun.exe").await, vec![(yanyun, 1)]);
    });
}
