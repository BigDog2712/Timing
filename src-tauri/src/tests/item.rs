//! 事项业务规则（Spec §9 AC-08/09/10/11；IPC-CONTRACT-v2 §4.1）。
//! 覆盖：名称 trim/空/重名（大小写+空白不敏感）、排序、系统事项保护、归档往返、软删除。

use crate::error::ErrorCode;
use crate::models::constants::ITEM_NAME_MAX_LEN;
use crate::models::item::ItemPatch;
use crate::services::item;
use crate::tests::support::{expect_err, fresh_pool, scalar_i64};

fn patch_name(name: &str) -> ItemPatch {
    ItemPatch {
        name: Some(name.to_string()),
        ..Default::default()
    }
}

#[tokio::test]
async fn create_trims_name_and_assigns_sort_order() {
    let pool = fresh_pool("item-create").await;
    let created = item::create(&pool, "  写方案  ", None).await.unwrap();
    assert_eq!(created.name, "写方案", "名称应 trim");
    assert_eq!(created.status, "active");
    assert!(!created.is_system);
    // 种子「未归类」sort_order=0 → 首建为 1
    assert_eq!(created.sort_order, 1);
}

#[tokio::test]
async fn create_empty_name_rejected() {
    let pool = fresh_pool("item-empty").await;
    let code = expect_err(item::create(&pool, "   ", None).await);
    assert_eq!(code, ErrorCode::ItemNameEmpty);
}

/// [V0.3.0] 后端补上名称长度校验（ADR-018）：此前只有前端 maxLength，
/// 直接调 IPC 可存进任意长名称，而托盘会按显示宽度截断。
#[tokio::test]
async fn create_overlong_name_rejected_without_insert() {
    let pool = fresh_pool("item-long").await;
    let long = "字".repeat(ITEM_NAME_MAX_LEN + 1);
    let code = expect_err(item::create(&pool, &long, None).await);
    assert_eq!(code, ErrorCode::ItemNameTooLong, "超长不得静默接受");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items WHERE is_system = 0").await,
        0,
        "拒绝后不得入库"
    );
}

/// 边界：恰好等于上限必须通过（避免「差一」把合法名字卡死）。
#[tokio::test]
async fn create_name_at_limit_accepted() {
    let pool = fresh_pool("item-limit").await;
    let exact = "字".repeat(ITEM_NAME_MAX_LEN);
    let created = item::create(&pool, &exact, None).await.unwrap();
    assert_eq!(created.name.chars().count(), ITEM_NAME_MAX_LEN);
}

#[tokio::test]
async fn update_overlong_name_rejected() {
    let pool = fresh_pool("item-upd-long").await;
    let a = item::create(&pool, "甲", None).await.unwrap();
    let long = "字".repeat(ITEM_NAME_MAX_LEN + 1);
    let code = expect_err(item::update(&pool, a.id, patch_name(&long)).await);
    assert_eq!(code, ErrorCode::ItemNameTooLong);
}

#[tokio::test]
async fn create_duplicate_name_allowed() {
    let pool = fresh_pool("item-dup").await;
    let a = item::create(&pool, "Project", None).await.unwrap();
    let b = item::create(&pool, "  project ", None).await.unwrap();
    assert_ne!(a.id, b.id, "同名两条是两条独立事项");
    assert_eq!(b.name, "project", "仍 trim，但不再按同名去重（ADR-021）");
    let same = item::list(&pool, false)
        .await
        .unwrap()
        .iter()
        .filter(|i| i.name.eq_ignore_ascii_case("project"))
        .count();
    assert_eq!(same, 2, "两条同名事项都应出现在列表里");
}

#[tokio::test]
async fn update_missing_item_rejected() {
    let pool = fresh_pool("item-upd-miss").await;
    let code = expect_err(item::update(&pool, 9999, patch_name("x")).await);
    assert_eq!(code, ErrorCode::ItemNotFound);
}

#[tokio::test]
async fn update_empty_name_rejected() {
    let pool = fresh_pool("item-upd-empty").await;
    let a = item::create(&pool, "甲", None).await.unwrap();
    let code = expect_err(item::update(&pool, a.id, patch_name("  ")).await);
    assert_eq!(code, ErrorCode::ItemNameEmpty);
}

#[tokio::test]
async fn update_to_existing_name_allowed() {
    let pool = fresh_pool("item-upd-dup").await;
    item::create(&pool, "甲", None).await.unwrap();
    let b = item::create(&pool, "乙", None).await.unwrap();
    let updated = item::update(&pool, b.id, patch_name("甲")).await.unwrap();
    assert_eq!(updated.name, "甲", "改名撞上已有名字不再被拦（ADR-021）");
    assert_ne!(updated.id, 1, "改的是自己那条，不是被撞的那条");
}

#[tokio::test]
async fn update_empty_color_is_noop() {
    let pool = fresh_pool("item-color-noop").await;
    let a = item::create(&pool, "甲", Some("#112233".to_string()))
        .await
        .unwrap();
    let updated = item::update(
        &pool,
        a.id,
        ItemPatch {
            color: Some("   ".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        updated.color.as_deref(),
        Some("#112233"),
        "空 color 视作不修改（MVP 取舍）"
    );
}

#[tokio::test]
async fn system_item_is_protected() {
    let pool = fresh_pool("item-protected").await;
    assert_eq!(
        expect_err(item::archive(&pool, 1).await),
        ErrorCode::ItemSystemProtected
    );
    assert_eq!(
        expect_err(item::delete(&pool, 1).await),
        ErrorCode::ItemSystemProtected
    );
    // 仍存在且 active
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM items WHERE id = 1 AND deleted_at IS NULL"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn archive_unarchive_roundtrip_and_list_filter() {
    let pool = fresh_pool("item-archive").await;
    let a = item::create(&pool, "归档项", None).await.unwrap();

    let archived = item::archive(&pool, a.id).await.unwrap();
    assert_eq!(archived.status, "archived");

    let active_only = item::list(&pool, false).await.unwrap();
    assert!(
        !active_only.iter().any(|i| i.id == a.id),
        "默认列表不含归档"
    );
    let all = item::list(&pool, true).await.unwrap();
    assert!(all.iter().any(|i| i.id == a.id), "include_archived 含归档");

    let back = item::unarchive(&pool, a.id).await.unwrap();
    assert_eq!(back.status, "active");
}

#[tokio::test]
async fn unarchive_with_same_name_allowed() {
    let pool = fresh_pool("item-unarch-dup").await;
    let a = item::create(&pool, "重名", None).await.unwrap();
    item::archive(&pool, a.id).await.unwrap();
    // 归档后同名 active 可再建
    item::create(&pool, "重名", None).await.unwrap();
    // 恢复也不冲突（ADR-021）
    let back = item::unarchive(&pool, a.id).await.unwrap();
    assert_eq!(back.status, "active");
    let same = item::list(&pool, false)
        .await
        .unwrap()
        .iter()
        .filter(|i| i.name == "重名")
        .count();
    assert_eq!(same, 2, "恢复后两条同名事项并存");
}

#[tokio::test]
async fn delete_is_soft_and_hides_item() {
    let pool = fresh_pool("item-del").await;
    let a = item::create(&pool, "待删", None).await.unwrap();
    item::delete(&pool, a.id).await.unwrap();

    let list = item::list(&pool, true).await.unwrap();
    assert!(!list.iter().any(|i| i.id == a.id));
    // 物理行仍在（软删除，保留其记录归属）
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items WHERE id = 1").await,
        1
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM items WHERE id = {} AND deleted_at IS NOT NULL",
                a.id
            )
        )
        .await,
        1
    );
}
