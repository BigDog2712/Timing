//! [V0.11.16] B2 的**文件层**证据：三档 `file` 同名时，落点目录里只出现**一个**文件，
//! 而且三个种类的标题都在里面（PRD R2「所有功能都存在一个文件中」）。
//!
//! 本轮把块①的「文件模板」从三个框收成一个（只有用户改过才扇出），判据不能停在
//! 「传给后端的 `file` 都是新值」——那只是配置层。用户真正会在乎的是磁盘上**多没多出
//! 一个文件**：若某个种类漏扇出，落点目录里就会同时出现 `2026-11-07.md` 与
//! `2026-11-07-asd.md`，同一份日记被劈成两半。
//!
//! 夹具说明：`env()` 预置的三档本来就指向同一个临时 vault、同一个 `{date}.md`、三个
//! 不同标题——正是新装用户的形状，也正是 B2 要验的那一条。

use crate::models::note::NoteGeometry;
use crate::repositories::note as note_repo;
use crate::services;
use crate::services::md_sync::config;
use crate::tests::support::{insert_saved, new_item};

use super::md_sync::{NOTES_HEADING, TIMERS_HEADING, TODOS_HEADING, at, env};

/// 三个种类各放一条**当天**的数据：没有数据时 `mirror` 不建文件、也不写那个区块，
/// 测不到「只落一个文件、三个标题都在」。
///
/// 便利贴与待办都是「按当天相关归日」的（`export.rs`）：便利贴必须今天创建/改过，
/// 待办必须是今天的，否则它们属于别的日子，不会出现在今天这篇日记里。
async fn seed_three_kinds(env: &super::md_sync::Env) {
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;
    let geometry = NoteGeometry {
        pos_x: 160.0,
        pos_y: 160.0,
        width: 280.0,
        height: 200.0,
    };
    note_repo::insert(&env.pool, None, "灵感一", geometry, at(env.date, 10, 0))
        .await
        .expect("建便利贴应成功");
    services::todo::create(&env.pool, "买牛奶", None, None, None)
        .await
        .expect("建待办应成功");
}

#[tokio::test]
async fn one_file_name_for_all_kinds_writes_exactly_one_file_with_three_headings() {
    let env = env("md-one-file").await;
    seed_three_kinds(&env).await;

    /* 用户把「日记文件名」改成 `{date}-asd.md` 并保存：前端扇出后三档同值 */
    let mut current = config::load(&env.pool).await.expect("读取配置应成功");
    assert_eq!(current.bindings.len(), 3, "夹具应有三档");
    for binding in &mut current.bindings {
        binding.file = "{date}-asd.md".to_string();
    }
    config::save(&env.pool, &current).await.expect("保存应成功");

    let report = services::md_sync::run(&env.pool).await.expect("同步应成功");
    assert!(report.errors.is_empty(), "同步不该有落点错误：{:?}", report.errors);

    /* 落点目录里只能有一个 .md */
    let mut names: Vec<String> = std::fs::read_dir(&env.vault)
        .expect("落点目录应存在")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.to_lowercase().ends_with(".md"))
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec![format!("{}-asd.md", env.date.format("%Y-%m-%d"))],
        "三档同名时必须只落一个文件（多出来的是被劈开的日记）"
    );

    /* 三个标题都在同一个文件里 */
    let text = std::fs::read_to_string(env.vault.join(&names[0])).expect("日记应可读");
    for heading in [TIMERS_HEADING, NOTES_HEADING, TODOS_HEADING] {
        assert!(
            text.contains(heading),
            "三个种类的标题必须都在这一个文件里，缺「{heading}」：\n{text}"
        );
    }
}
