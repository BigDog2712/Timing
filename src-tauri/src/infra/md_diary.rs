//! Markdown 日记模板的首次写出（[V0.11.33]，30-PRD 变更五 / P16–P18）。
//!
//! 语义基线（R4 已定稿）：应用**没有**「新建日记」按钮——日记 = `md_file::write_section`
//! 在目标文件不存在时顺手创建。模板生效点 = **首次写出**：文件不存在且本轮确要写
//! （调用点挂在 `services::md_sync::sync_binding` 的 `needs_write` 分支首行）→ 先把
//! 模板全文写到目标路径，随后 `write_section` 读到「已存在的文件」自然走
//! `append_section` 追加 Timing 区块——**模板在前、区块在后**由既有拼接逻辑免费保证，
//! `write_section` / `append_section` 零改动。
//!
//! 桌面 only（PM 裁定）：手机端写的是 WebDAV 云端文件，不套模板；
//! `cfg!(mobile)` 在函数内部短路，调用点保持一行。
//!
//! 模板路径规则与「落点目录」同规则：复用 [`expand_env`]（`%APP_DIR%` / `~` / `%VAR%`
//! 展开 + 分隔符归一是其最后一步既有约定，不写第二份）。

use std::path::Path;

use crate::infra::md_env::expand_env;

/// 首次写出前套模板。**无返回值**：降级语义内部消化，绝不把模板失败变成同步失败（P18）。
///
/// 顺序不可换：mobile 短路 → 空模板 → 文件已存在（不套，一个字节不碰）→
/// 路径展开 → 读失败降级 → 原字节写出。
pub fn seed_if_missing(path: &Path, raw: &str) {
    if cfg!(mobile) || raw.trim().is_empty() || path.exists() {
        return;
    }
    let template = expand_env(raw);
    let content = match std::fs::read_to_string(&template) {
        Ok(content) => content,
        Err(err) => {
            /* P18：模板路径指不到文件 → 照常创建（不带模板）+ warn 一条，不阻断同步轮。 */
            crate::log_warn!("日记模板读取失败：{err}（按无模板处理）");
            return;
        }
    };
    /* 与 `write_section` 同一道工序：父目录先建（新建日记的落点目录往往还不存在）。 */
    if let Some(parent) = path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            crate::log_warn!("日记模板落点目录创建失败：{err}（按无模板处理）");
            return;
        }
    }
    match std::fs::write(path, content) {
        Ok(()) => crate::log_info!("日记模板已套用：{}", path.display()),
        Err(err) => crate::log_warn!("日记模板写出失败：{err}（按无模板处理）"),
    }
}
