//! 单个落点的一轮同步：读懂 → 判定 → 写回（从 `mod.rs` 拆出，腾行数）。
//!
//! 三个函数的调用关系是一条直链：
//!
//! ```text
//! sync_all()                     （mod.rs：遍历落点、聚合报告）
//!   └─ sync_binding()            本文件：读写一个落点的区块
//!        ├─ render_expected()    SQL → md 应当长什么样
//!        └─ import_and_render()  md → SQL，然后立刻重渲染
//! ```
//!
//! ## 冲突处置（T03）
//!
//! `mode` 决定「文件侧被改过」时的动作：`AutoMerge` 直接导入（云端内部副本）、
//! `Awaiting` / `Pending` 则**登记待裁决**并原样保留文件内容。登记之后**不推进基线**——
//! 推进了下一轮就判不出 `file_changed`，冲突会静默消失，而两端内容仍然不一致。

use std::path::Path;

use sqlx::SqlitePool;

use super::decision::{self, ConflictMode};
use super::runtime::Runtime;
use super::{export, import};
use crate::error::AppResult;
use crate::infra::md_file;
use crate::infra::md_section::{self, SectionState};
use crate::models::md_sync::MdSyncBinding;

pub(super) struct BindingOutcome {
    pub(super) exported: bool,
    pub(super) imported: u32,
    pub(super) direction: &'static str,
    pub(super) exists: bool,
    pub(super) warnings: Vec<String>,
}

pub(super) async fn sync_binding(
    pool: &SqlitePool,
    rt: &mut Runtime,
    binding: &MdSyncBinding,
    date: chrono::NaiveDate,
    path: &Path,
    template: &str, /* [V0.11.33] 日记模板路径（全局一份）：经 `sync_all`（持有 config）传下，红线豁免 +2 净 0 已裁决放行 */
    mode: ConflictMode,
) -> Result<BindingOutcome, String> {
    let read = md_file::read_section(path, &binding.heading)?;
    /* 阻断级诊断：本轮既不写也不导入（不写保住手改内容，不导入不触发删除块）。 */
    let warnings = read.guard(binding.kind.label(), &md_section::heading_text(&binding.heading))?;
    let section = read.state;
    let expected = render_expected(pool, binding, date)
        .await
        .map_err(|err| err.to_string())?;
    /* mtime 仍读出来（`SectionState` 的一部分），但冲突判定不再用它：
    见下面「Markdown 永远赢」的注释。 */
    let (current, _mtime) = match &section {
        SectionState::MissingFile => (None, 0),
        /* 标题缺失按「文件侧没有这一节」处理：只补写，不把空内容当删除。
        `Blocked` 同档：它在上面已 return，这里只为穷尽 match。 */
        SectionState::MissingHeading { mtime_ms } | SectionState::Blocked { mtime_ms } => (None, *mtime_ms),
        SectionState::Present { body, mtime_ms } => (Some(body.clone()), *mtime_ms),
    };

    let baseline = rt.baseline(binding.kind, path, &binding.heading).cloned();
    let mut imported = 0;
    let mut deferred = false;
    let target = match &current {
        None => expected.body.clone(),
        Some(body) if body.trim() == expected.body.trim() => expected.body.clone(),
        Some(body) => {
            let file_changed = baseline.as_ref().is_none_or(|base| base.body != *body);
            /* [V0.11.3] 两边都改过时**不再静默 Markdown 赢**（T03 起）。
            判据仍是「baseline != body」的正文比较（不用 mtime，理由见下）：
            `latest_update` 是应用写库的毫秒墙钟，`mtime` 取决于谁最后碰过文件——
            Obsidian 关闭时补写、同步盘回写、甚至一次「无改动保存」都会把它推后。
            结果就是「偶尔 SQL 反向覆盖掉用户手改的日记」，对一份声明为权威的资料不可接受。
            T03 把「文件侧也变了」从直接 import 改成挂起裁决：只有云端落点（内部副本）
            仍自动 Markdown 赢；用户落点一律等 A/B/C，后台挂 Pending、前台弹 Awaiting。 */
            if file_changed {
                match mode.state() {
                    None => {
                        let old_body = baseline.as_ref().map_or("", |base| base.body.as_str());
                        let (rendered, count) =
                            import_and_render(pool, binding, date, old_body, body).await?;
                        imported = count;
                        rendered
                    }
                    Some(state) => {
                        let old_body = baseline.as_ref().map_or("", |base| base.body.as_str());
                        decision::register(
                            binding,
                            date,
                            path.display().to_string(),
                            old_body.to_string(),
                            body.clone(),
                            state,
                        );
                        deferred = true;
                        body.clone()
                    }
                }
            } else {
                expected.body.clone()
            }
        }
    };

    let needs_write = match &section {
        SectionState::MissingFile | SectionState::MissingHeading { .. } => {
            !target.trim().is_empty()
        }
        /* 阻断级诊断已在上面 return，这里只为穷尽 match：写 false 是「宁可少写不多写」。 */
        SectionState::Blocked { .. } => false,
        SectionState::Present { body, .. } => body.trim_end() != target.trim_end(),
    };
    if needs_write {
        crate::infra::md_diary::seed_if_missing(path, template); /* [V0.11.33] P16/P17/P18 首次写出套模板：文件已存在时它自己短路，零字节不碰 */
        md_file::write_section(path, &binding.heading, &target)?;
    }
    /* 挂起时不推进基线：下一轮仍判 file_changed，冲突保持 pending，不被静默改写。 */
    if !deferred {
        rt.set_baseline(binding.kind, path, &binding.heading, target);
    }

    Ok(BindingOutcome {
        exported: needs_write,
        imported,
        direction: if deferred {
            "pending"
        } else if imported > 0 {
            "import"
        } else if needs_write {
            "export"
        } else {
            "none"
        },
        exists: path.exists(),
        warnings,
    })
}

pub(super) async fn render_expected(
    pool: &SqlitePool,
    binding: &MdSyncBinding,
    date: chrono::NaiveDate,
) -> AppResult<export::Exported> {
    /* 分发在 `export::by_kind`：这里长一串 match 会越过 300 行硬约束，而种类只会更多。 */
    export::by_kind(pool, binding.kind, date).await
}

pub(super) async fn import_and_render(
    pool: &SqlitePool,
    binding: &MdSyncBinding,
    date: chrono::NaiveDate,
    old_body: &str,
    new_body: &str,
) -> Result<(String, u32), String> {
    let stats = import::by_kind(pool, binding.kind, date, old_body, new_body)
        .await
        .map_err(|err| err.to_string())?;
    let rendered = render_expected(pool, binding, date)
        .await
        .map_err(|err| err.to_string())?;
    Ok((rendered.body, stats.total()))
}
