//! [V0.11.33] 日记模板的落地判据（30-PRD P16 / P17 / P18）。
//!
//! 三分支走真 `services::md_sync::run`（不靠纯函数自证）：
//! - P16 模板已配 + 落点文件不存在 → 新文件 = 模板全文 + Timing 区块（模板在前）；
//! - P17 模板为空 → 与 HEAD 现状逐字节一致（回归钉）；
//! - P18 模板路径指不到文件 → 文件照常创建（仅 Timing 区块）、同步轮报成功。
//!
//! 另有 `seed_if_missing` 的单元用例（「文件已存在不套」等四条短路）。

use std::path::{Path, PathBuf};

use crate::infra::md_diary::seed_if_missing;
use crate::services;
use crate::services::md_sync::config;
use crate::tests::md_sync::{at, env, file_for, Env};
use crate::tests::support::{insert_saved, new_item, unique_dir};

const TEMPLATE: &str = "# 我的日记\n\n- 今日待办：\n";

/// 给环境配一条模板路径（写入 `diaryTemplate` 落库，其余配置原样）。
async fn save_with_template(env: &Env, template_path: &Path) {
    let mut current = config::load(&env.pool).await.unwrap();
    current.diary_template = template_path.display().to_string();
    config::save(&env.pool, &current).await.unwrap();
}

/// 临时模板文件（内容 = [`TEMPLATE`]），返回它的绝对路径。
fn write_template(env: &Env) -> PathBuf {
    let path = env.vault.join("template.md");
    std::fs::write(&path, TEMPLATE).unwrap();
    path
}

/// 塞一条已保存记录（`env()` 已把三档落点锁进临时目录；只有 Timers 有数据 →
/// 只有它的落点文件会因 `needs_write` 被创建）。
async fn seed_record(env: &Env) {
    let item = new_item(&env.pool, "喝水").await;
    insert_saved(&env.pool, item, at(env.date, 10, 0), at(env.date, 10, 5), 300).await;
}

/// P16：模板打底 + 区块在后；再跑一轮文件已存在，模板不参与（一个字节不碰）。
#[tokio::test]
async fn p16_template_seeded_before_section_on_first_write() {
    let env = env("md-diary-p16").await;
    let template = write_template(&env);
    save_with_template(&env, &template).await;
    seed_record(&env).await;

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    /* 模板在前：文件以模板全文开头（逐字）。 */
    assert!(text.starts_with(TEMPLATE), "{text}");
    /* 区块在后：模板结尾与 Timing 标题之间是 `append_section` 的既有拼接（空行分隔）。 */
    assert!(text.contains("\n\n#### 事项计时\n- [ ] 喝水"), "{text}");

    /* 第二轮：文件已存在 → 模板不参与，内容一个字节不变。 */
    let before = std::fs::read_to_string(file_for(&env)).unwrap();
    let again = services::md_sync::run(&env.pool).await.unwrap();
    assert!(again.errors.is_empty(), "{:?}", again.errors);
    let after = std::fs::read_to_string(file_for(&env)).unwrap();
    assert_eq!(before, after, "文件已存在时模板不许再碰它");
}

/// P17：模板为空（缺键同形）→ 首写内容与 HEAD 现状逐字节一致。
#[tokio::test]
async fn p17_empty_template_keeps_head_behavior_byte_for_byte() {
    let env = env("md-diary-p17").await;
    /* 不配模板：`config::load` 的 serde default 兜底为空串（零迁移）。 */
    seed_record(&env).await;

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    /* 与 HEAD 既有用例 `missing_file_is_created_with_heading_only_when_there_is_data`
       同一口径：无模板时首写仍以标题开头，模板内容零命中。 */
    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    assert!(text.starts_with("#### 事项计时\n- [ ] 喝水"), "{text}");
    assert!(!text.contains("我的日记"), "{text}");
}

/// P18：模板路径指不到文件 → 照常创建（仅 Timing 区块）+ 轮成功（降级不阻断）。
#[tokio::test]
async fn p18_missing_template_degrades_and_sync_still_succeeds() {
    let env = env("md-diary-p18").await;
    let missing = env.vault.join("no-such-template.md");
    save_with_template(&env, &missing).await;
    seed_record(&env).await;

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert!(report.exported >= 1, "同步轮必须报成功：{:?}", report);

    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    assert!(text.starts_with("#### 事项计时\n- [ ] 喝水"), "{text}");
}

/* ---- `seed_if_missing` 单元用例（四条短路） ---- */

/// 「文件已存在不套」：目标有内容 → 一个字节不碰（P16 后半句的单元钉）。
#[tokio::test]
async fn seed_leaves_existing_file_untouched() {
    let dir = unique_dir("md-diary-unit-existing");
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("2026-11-09.md");
    std::fs::write(&target, "用户已有的日记\n").unwrap();
    let template = dir.join("template.md");
    std::fs::write(&template, TEMPLATE).unwrap();

    seed_if_missing(&target, &template.display().to_string());

    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "用户已有的日记\n",
        "文件已存在时模板不许套"
    );
}

/// 空模板（空串 / 空白）→ 不产生任何文件。
#[tokio::test]
async fn seed_with_blank_raw_is_a_noop() {
    let dir = unique_dir("md-diary-unit-blank");
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("2026-11-09.md");

    seed_if_missing(&target, "");
    seed_if_missing(&target, "   \n\t ");

    assert!(!target.exists(), "空模板不许创建文件");
}

/// 模板可读 → 目标 = 模板原字节（逐字，不做任何归一）。
#[tokio::test]
async fn seed_writes_template_bytes_verbatim() {
    let dir = unique_dir("md-diary-unit-verbatim");
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("2026-11-09.md");
    let template = dir.join("template.md");
    std::fs::write(&template, TEMPLATE).unwrap();

    seed_if_missing(&target, &template.display().to_string());

    assert_eq!(std::fs::read_to_string(&target).unwrap(), TEMPLATE);
}

/// 模板读不到 → 降级不 panic、目标仍未创建（写区块由后续 `write_section` 照常进行）。
#[tokio::test]
async fn seed_with_unreadable_template_degrades_without_panic() {
    let dir = unique_dir("md-diary-unit-missing");
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("2026-11-09.md");

    seed_if_missing(&target, &dir.join("no-such.md").display().to_string());

    assert!(!target.exists(), "读不到模板时不许产出半成品文件");
}
