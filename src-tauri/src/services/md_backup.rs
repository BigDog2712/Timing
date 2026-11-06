//! 备份的列表与「恢复覆写」（V0.11.13，设计 §2.4b / §4.3）。
//!
//! ## 恢复是「用户明确要求用这份覆盖」，不是合并
//!
//! 所以这里调 `import::by_kind` / `export::by_kind`（都吃 `date` 参数），**绝不**碰
//! `sync_all`：三方判定（基线 / 文件 / SQL）在恢复里没有意义，反而会让「我就是要回到
//! 昨天那份」被拦住。也因为不碰它，这条路可以在持锁状态下走完——`sync_all` 内部也要
//! 那把锁，`tokio::sync::Mutex` 不可重入，锁内调它就是死锁。
//!
//! ## 「恢复本身不会再丢一次」是真的
//!
//! 第 ⑤ 步 `write_section` 内部会先 `md_backup::save` 把当前内容存一份，走的是和同步
//! 完全相同的留底路径。所以确认文案可以照此承诺。

/* 调用点是 T04 的两个备份命令（`md_backup_list` / `md_backup_restore`），接上之前必被
判死码。与本轮其它 T03/T04 交界文件同一口径：模块级 allow，一份维护面。 */
#![allow(dead_code)]

use std::fs;
use std::path::PathBuf;

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::md_backup as store;
use crate::infra::md_file::{self, SectionState};
use crate::models::md_sync::MdSyncBinding;
use crate::models::md_sync_cloud::{CloudMode, MdBackupItem, MdBackupRestoreResult, MdSyncCloud};
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending;
use crate::services::md_cloud::pending;
use crate::services::md_sync::{self, export, import};

/// 备份列表（按 `at_ms` 降序，来源是 `md_backup_store::list`）。
pub fn items() -> Vec<MdBackupItem> {
    store::list()
        .into_iter()
        .map(|file| MdBackupItem {
            date: date_of(&file.source),
            name: file.name,
            /* `Option<&'static str>` → `Option<String>`：列表要序列化给前端，
            `&'static str` 过不了 serde 之外的生命周期检查。 */
            target: file.target.map(str::to_string),
            source: file.source,
            at_ms: file.at_ms,
            bytes: file.bytes,
        })
        .collect()
}

/// 用一份备份覆盖回去：文件、SQL、基线三者一起回到备份那一刻。
///
/// `target` 是落点标识（`"obsidian"` / `"webdav"` / `"folder"`）：`None` = 按备份文件名
/// 推出来的归属；老备份（无前缀）由前端让用户自己选。`Some("webdav")` 结尾会排一笔
/// 待传，下一轮把回滚结果也传上去。
pub async fn restore(
    pool: &SqlitePool,
    name: &str,
    target: Option<&str>,
) -> AppResult<MdBackupRestoreResult> {
    /* ① 名字 → (归属, 来源文件名) → 日期。名字来自前端，按不可信输入处理。 */
    let (name_target, source) = store::parse_name(name).ok_or_else(|| {
        AppError::md_sync_config_invalid(format!("「{name}」不是 Timing 的备份文件"))
    })?;
    let date_text = date_of(&source).ok_or_else(|| {
        AppError::md_sync_config_invalid(format!(
            "备份里的来源文件名「{source}」读不出日期（需要 yyyy-MM-dd.md）"
        ))
    })?;
    let date = NaiveDate::parse_from_str(&date_text, "%Y-%m-%d")
        .map_err(|_| AppError::md_sync_config_invalid(format!("日期「{date_text}」不合法")))?;

    /* ② 备份全文。放在拿锁之前：读盘不涉及同步状态，早失败早返回。 */
    let text = String::from_utf8_lossy(&store::read(name).map_err(AppError::io)?).into_owned();

    /* ③ 按「解析后的路径」分组：三个 kind 常落同一个 `{date}.md`，一个文件只该被
    算一次 `written`。 */
    let effective = target.or(name_target);
    let config = md_sync::config::load(pool).await?;
    /* 云端配置对 `folder` / `webdav` 两个落点才有意义，判据集中在 `root_of` 一处判，
    这里不做第二遍筛选——两处判据必然漂移。 */
    let groups = group_by_path(&config.bindings, effective, config.cloud.as_ref(), date)?;
    if groups.is_empty() {
        return Err(AppError::md_sync_config_invalid(
            "没有可恢复的落点：请先在设置里启用一个并填写完整",
        ));
    }

    /* ④–⑧ 全程持锁，且锁内不调 `sync_all`（见模块注释）。 */
    let mut rt = md_sync::runtime::lock().await;
    let mut imported: u32 = 0;
    let mut written: Vec<PathBuf> = Vec::new();
    for (path, bindings) in &groups {
        for binding in bindings {
            let Some(body_backup) = md_file::body_in_text(&text, &binding.heading) else {
                /* 备份里没有这个标题 = 这份备份本来就不含该种类的数据。此时「写入」只会
                追加一个空区块，导入则会按「文件侧删光了」处理——两件事都是坏结果。 */
                crate::log_warn!("md backup restore: {name} 里没有「{}」，跳过", binding.heading);
                continue;
            };
            let body_old = match md_file::read_section(path, &binding.heading) {
                Ok(SectionState::Present { body, .. }) => body,
                Ok(_) => String::new(),
                Err(err) => return Err(AppError::io(err)),
            };
            /* ⑤ 先写回去：`write_section` 内部会把当前（坏）内容再留一份底，
            于是「恢复」这个动作本身也不会让内容凭空消失。 */
            md_file::write_section(path, &binding.heading, &body_backup).map_err(AppError::io)?;
            /* ⑥ 强制导入，不做冲突判定（用户明确要求覆盖）。 */
            let stats = import::by_kind(pool, binding.kind, date, &body_old, &body_backup).await?;
            imported += stats.total();
            /* ⑦ 再按库里的结果重渲染：导入会把时间格式、分组顺序规范化，文件要与库一致，
            否则下一轮同步立刻又判出「文件变了」。 */
            let rendered = export::by_kind(pool, binding.kind, date).await?;
            md_file::write_section(path, &binding.heading, &rendered.body).map_err(AppError::io)?;
            /* ⑧ 基线跟上，下一轮不判「文件变了」。 */
            rt.set_baseline(binding.kind, path, &binding.heading, rendered.body);
            if !written.contains(path) {
                written.push(path.clone());
            }
        }
    }
    drop(rt);

    if effective == Some("webdav") {
        /* 恢复是本地动作。要让云端也回滚，唯一办法是排一笔待传：下一轮 round 会先把
        Obsidian 那份并进云端那份、再 PUT 上去。 */
        let hash = fs::read(groups[0].0.as_path())
            .map(|bytes| pending::fingerprint(&bytes))
            .unwrap_or_else(|_| pending::fingerprint(b""));
        md_cloud_pending::mark_pending(pool, &date_text, &hash, now_ms()).await?;
    }
    /* `folder` 落点**不排待传**：本地目录通道没有「待传」这一步，恢复已经直接把备份
    写进了云端那份所在的目录（写进去就是同步完了，剩下的交给网盘客户端），
    再排一笔只会在设置页显示一个永远不会被消费的欠账。指纹也不在这里刷：
    下一轮 folder 轮会把这份内容照原样再写一遍并记下它的指纹。 */

    Ok(MdBackupRestoreResult {
        date: date_text,
        target: effective.unwrap_or("obsidian").to_string(),
        imported,
        written: written.len() as u32,
    })
}

/// 某个落点的生效根。
///
/// ## 解析不出来必须报错（[V0.11.14] 修 O4）
///
/// 旧版只认 `webdav`：`folder` 与「`webdav` 但云端没启用」都**静默回落**到
/// `binding.root` —— 那是 Obsidian 落点。于是「恢复一份 folder 备份」会改写 Obsidian
/// 里那份日记，用户以为自己恢复的是云端那份：改到了错的文件，还没有任何提示。
/// 恢复是**覆盖写**，落点写错就是数据正确性问题，所以这里一律 `Err`、绝不猜。
///
/// `obsidian` / `None`（老备份无前缀，前端让用户自己选落点）仍回 `binding.root`：
/// 那是对这两种输入唯一有意义的解释。
fn root_of(
    binding: &MdSyncBinding,
    target: Option<&str>,
    cloud: Option<&MdSyncCloud>,
) -> AppResult<String> {
    /* 落点名与它要求的通道模式绑在一起写：错误文案要说清「这份备份属于哪个落点」，
    用户才知道该去设置里切哪一项。 */
    let (label, need) = match target {
        Some("webdav") => ("WebDAV", CloudMode::Webdav),
        Some("folder") => ("本地目录", CloudMode::LocalFolder),
        _ => return Ok(binding.root.clone()),
    };
    let cloud = cloud
        .filter(|cloud| cloud.enabled && cloud.is_usable())
        .ok_or_else(|| {
            AppError::md_sync_config_invalid(format!(
                "这份备份属于「{label}」落点，但云端通道没开启或没填完整；\
                 请先在设置里配好「{label}」，或换一个落点恢复"
            ))
        })?;
    if cloud.mode != need {
        let now = match cloud.mode {
            CloudMode::LocalFolder => "本地目录",
            CloudMode::Webdav => "WebDAV",
        };
        return Err(AppError::md_sync_config_invalid(format!(
            "这份备份属于「{label}」落点，但云端通道现在是「{now}」；\
             请先在设置里切到「{label}」，或换一个落点恢复"
        )));
    }
    cloud
        .resolve_root()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|err| {
            AppError::md_sync_config_invalid(format!(
                "「{label}」落点解析不出来：{err}；请先在设置里改好再恢复"
            ))
        })
}


/// 按解析后的绝对路径分组（保序）。相对路径直接拒绝：`create_dir_all` 会写到进程 CWD。
fn group_by_path(
    bindings: &[MdSyncBinding],
    target: Option<&str>,
    cloud: Option<&MdSyncCloud>,
    date: NaiveDate,
) -> AppResult<Vec<(PathBuf, Vec<MdSyncBinding>)>> {
    let mut groups: Vec<(PathBuf, Vec<MdSyncBinding>)> = Vec::new();
    for binding in bindings
        .iter()
        .filter(|binding| binding.enabled && binding.is_configured())
    {
        let path = md_file::resolve_path(&root_of(binding, target, cloud)?, &binding.file, date);
        if !path.is_absolute() {
            return Err(AppError::md_sync_config_invalid(format!(
                "「{}」的落点无法解析为绝对路径：{}",
                binding.kind.label(),
                path.display()
            )));
        }
        match groups.iter_mut().find(|(seen, _)| *seen == path) {
            Some((_, list)) => list.push(binding.clone()),
            None => groups.push((path, vec![binding.clone()])),
        }
    }
    Ok(groups)
}

/// `2026-11-06.md` → `2026-11-06`。读不出（自定义文件模板、老名字）→ `None`。
fn date_of(source: &str) -> Option<String> {
    let stem = source.strip_suffix(".md")?;
    NaiveDate::parse_from_str(stem, "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}
