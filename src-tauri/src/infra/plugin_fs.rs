//! 插件文件系统适配（只做 IO 与解析，业务判断在 `services::plugin`）。
//!
//! ## 目录优先级
//!
//! | 优先级 | 来源 | 路径 | 可写 |
//! |---|---|---|---|
//! | 1 | `dev`（仅调试构建） | `<仓库根>/plugins` | 是 |
//! | 2 | `exe`（随包分发） | `<exe 目录>/plugins` | 视安装位置 |
//! | 3 | `user` | `%APPDATA%\com.timing.app\plugins` | 是 |
//!
//! 三处合并扫描，**同 id 先到先得**。用户目录首次启动只**建空目录**，不放任何文件：
//! 插件是用户自己放进去的东西，宿主替用户塞一份"示例"只会让「设置 → 插件」在全新
//! 安装时就有内容（V0.3.4 起明确不要这个形态，见 ADR-023）。格式指引走
//! `docs/plugin-spec.md`，而不是往用户目录里丢文件。
//!
//! ## 为什么不做缓存
//!
//! 一次扫描 = 几个几十字节的 `plugin.json`，毫秒级。缓存反而要处理「用户改了文件
//! 但界面没变」的解释成本。设置页的「重新加载」就是重新扫一遍，语义最直白。

use std::path::{Path, PathBuf};

use crate::models::plugin::{PluginManifest, PluginSource, MANIFEST_FILE, PLUGIN_API_VERSION};

/// 启动头体积上限：正常几百字节，64K 已经离谱到只可能是放错了文件。
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// 单插件贡献的快捷计时条数上限（菜单放不下更多，也防止刷屏）。
pub const MAX_QUICK_TIMERS: usize = 12;
/// 单条快捷计时的时长上限（分钟）。
pub const MAX_QUICK_TIMER_MINUTES: u32 = 1440;

/// 一个子目录的读取结果。
///
/// `manifest` 成功时带一份「非致命提示」（[v3] 起有些字段是被忽略而不是拒载的）。
pub struct ScanHit {
    pub source: PluginSource,
    pub dir: PathBuf,
    pub manifest: Result<(PluginManifest, Vec<String>), String>,
}

/// 用户插件目录（可写、首次自动创建）。
pub fn user_plugin_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("plugins")
}

/// 调试构建时仓库根的 `plugins/`；发布构建返回 `None`（编译期路径在别处无意义）。
fn dev_plugin_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let manifest_dir = option_env!("CARGO_MANIFEST_DIR")?;
    Some(PathBuf::from(manifest_dir).join("..").join("plugins"))
}

fn exe_plugin_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("plugins"))
}

/// 待扫描的根目录（按优先级排序；不保证存在）。
pub fn scan_roots(app_data_dir: &Path) -> Vec<(PluginSource, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(dir) = dev_plugin_dir() {
        roots.push((PluginSource::Dev, dir));
    }
    if let Some(dir) = exe_plugin_dir() {
        roots.push((PluginSource::Exe, dir));
    }
    roots.push((PluginSource::User, user_plugin_dir(app_data_dir)));
    roots
}

/// 读一个插件目录的启动头；失败返回一句能直接给用户看的中文原因。
///
/// 返回 `(清单, 非致命提示)`：与 `String` 错误不同，提示不影响插件生效。
pub fn read_manifest(dir: &Path) -> Result<(PluginManifest, Vec<String>), String> {
    let path = dir.join(MANIFEST_FILE);
    let meta = std::fs::metadata(&path).map_err(|_| format!("缺少启动头 {MANIFEST_FILE}"))?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "启动头超过 {} KB，疑似放错文件",
            MAX_MANIFEST_BYTES / 1024
        ));
    }
    let raw = std::fs::read_to_string(&path).map_err(|err| format!("读取启动头失败：{err}"))?;
    /* 允许 BOM：Windows 记事本另存为 UTF-8 时会加，不加处理用户会看到一句
    「expected value at line 1 column 1」而完全不知道哪里错了。 */
    let raw = raw.trim_start_matches('\u{feff}');
    let manifest: PluginManifest =
        serde_json::from_str(raw).map_err(|err| format!("启动头 JSON 不合法：{err}"))?;
    validate(&manifest)?;
    let notes = warnings(&manifest);
    Ok((manifest, notes))
}

/// 非致命提示：清单合法、插件照常生效，但有东西**被忽略了**。
///
/// 单独一个函数而不是把 `validate` 的返回值改成 `Result<Vec<String>, String>`：
/// “警告”不该跟“能不能载入”共用一条返回通路，否则调用方一不小心就会把警告当失败。
/// [v3] 目前只有一条：`contributes.mdSync` 已随内核化下架。
pub fn warnings(manifest: &PluginManifest) -> Vec<String> {
    let mut notes = Vec::new();
    if manifest.contributes.md_sync.is_some() {
        notes.push(
            "contributes.mdSync 已在 apiVersion 3 下架：Markdown 同步已归内核，本段被忽略；\
             同步请在「设置 → 同步」里配置"
                .to_string(),
        );
    }
    notes
}

/// 启动头语义校验。做的是「宿主要不要执行它」的判断，不是给作者挑刺。
fn validate(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.id.is_empty() || manifest.id.len() > 48 {
        return Err("id 必须为 1~48 个字符".into());
    }
    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err("id 只能用小写字母、数字、- 和 _".into());
    }
    if manifest.name.trim().is_empty() {
        return Err("name 不能为空".into());
    }
    if manifest.version.trim().is_empty() {
        return Err("version 不能为空".into());
    }
    if manifest.api_version == 0 || manifest.api_version > PLUGIN_API_VERSION {
        return Err(format!(
            "apiVersion 必须为 1..={PLUGIN_API_VERSION}（本机宿主版本更低）"
        ));
    }
    if manifest.entry == crate::models::plugin::EntryKind::Script {
        return Err("entry=script 尚未实现运行时，当前宿主只执行 manifest".into());
    }
    /* [v3] `contributes.mdSync` 不在这里校验：它已下架，内容一律忽略（见 `warnings`）。
    不再校验等于不再支持——报一个“mdSync 配置不合法”会让人以为写了就能用。 */
    if manifest.contributes.quick_timers.len() > MAX_QUICK_TIMERS {
        return Err(format!("quickTimers 最多 {MAX_QUICK_TIMERS} 条"));
    }
    for quick in &manifest.contributes.quick_timers {
        if quick.item.trim().is_empty() {
            return Err("quickTimers.item 不能为空".into());
        }
        if quick.minutes == 0 || quick.minutes > MAX_QUICK_TIMER_MINUTES {
            return Err(format!(
                "quickTimers.minutes 必须为 1..={MAX_QUICK_TIMER_MINUTES}"
            ));
        }
    }
    Ok(())
}

/// 扫描全部根目录下的插件子目录。
pub fn scan(app_data_dir: &Path) -> Vec<ScanHit> {
    let mut hits = Vec::new();
    for (source, root) in scan_roots(app_data_dir) {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        dirs.sort();
        for dir in dirs {
            /* 以 . 开头的目录视为「放这儿备份的旧版本」，静默跳过：
            它们没有启动头是正常的，不该在设置页报错。 */
            if dir
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with('.'))
            {
                continue;
            }
            let manifest = read_manifest(&dir);
            hits.push(ScanHit {
                source,
                dir,
                manifest,
            });
        }
    }
    hits
}

/// 建好用户插件目录（只建目录，**不写任何文件**）。
///
/// V0.3.4 起不再向用户目录播种任何内容：`plugin_list` 的返回必须如实反映
/// 「用户装了什么」，宿主自己塞进去的那一份会让设置页在全新安装时就显示出内容，
/// 而用户此时一个插件都没装（ADR-023）。
pub fn ensure_user_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("创建插件目录失败：{err}"))
}

/// 在资源管理器里打开插件目录（不存在则**先建后用**）。
///
/// 打开动作委托 `infra::shell_open`：那里已经有一份「explorer 只 spawn 不 wait」的
/// 实现，两处各写一遍只会让「explorer 退出码不可信」这条经验失传一处。
pub fn open_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("创建插件目录失败：{err}"))?;
    crate::infra::shell_open::open_dir(dir)
}

#[cfg(test)]
#[path = "plugin_fs_test.rs"]
mod tests;
