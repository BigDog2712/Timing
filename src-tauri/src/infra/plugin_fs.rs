//! 插件文件系统适配（只做 IO 与解析，业务判断在 `services::plugin`）。
//!
//! ## 目录优先级
//!
//! | 优先级 | 来源 | 路径 | 可写 |
//! |---|---|---|---|
//! | 1 | `dev`（仅调试构建） | `<仓库根>/plugins` | 是 |
//! | 2 | `exe`（随包分发） | `<exe 目录>/plugins` | 视安装位置 |
//! | 3 | `user` | `%APPDATA%\com.tickbar.app\plugins` | 是 |
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
use std::process::Command;

use crate::models::plugin::{PluginManifest, PluginSource, MANIFEST_FILE, PLUGIN_API_VERSION};

/// 启动头体积上限：正常几百字节，64K 已经离谱到只可能是放错了文件。
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// 单插件贡献的快捷计时条数上限（菜单放不下更多，也防止刷屏）。
pub const MAX_QUICK_TIMERS: usize = 12;
/// 单条快捷计时的时长上限（分钟）。
pub const MAX_QUICK_TIMER_MINUTES: u32 = 1440;

/// 一个子目录的读取结果。
pub struct ScanHit {
    pub source: PluginSource,
    pub dir: PathBuf,
    pub manifest: Result<PluginManifest, String>,
}

/// 用户插件目录：**程序所在目录**下的 `plugins`（绿色版解压到哪就跟到哪，不写 C 盘）。
///
/// 只有拿不到 exe 路径时才退回 `app_data/plugins`——那种情况实际上不会发生，
/// 留着是为了别把函数写成 `unwrap`。
///
/// 安卓 / iOS 例外：APK 是只读包，装不下「exe 同级可写目录」，仍用 app_data。
pub fn user_plugin_dir(app_data_dir: &Path) -> PathBuf {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return app_data_dir.join("plugins");
    }
    exe_plugin_dir().unwrap_or_else(|| app_data_dir.join("plugins"))
}

/// 调试构建时仓库根的 `plugins/`；发布构建返回 `None`（编译期路径在别处无意义）。
fn dev_plugin_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let manifest_dir = option_env!("CARGO_MANIFEST_DIR")?;
    Some(PathBuf::from(manifest_dir).join("..").join("plugins"))
}

/// exe 同级的 `plugins/`（便携版的「随包」与「用户」目录是同一个）。
fn exe_plugin_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("plugins"))
}

/// 待扫描的根目录（按优先级排序；不保证存在）。
///
/// `user_dir` 由调用方解析好后传进来，而不是在这里再算一遍：测试要能把用户目录指到
/// 临时目录，否则一跑测试就会去翻程序旁边的真实 `plugins/`。
pub fn scan_roots(user_dir: &Path) -> Vec<(PluginSource, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(dir) = dev_plugin_dir() {
        roots.push((PluginSource::Dev, dir));
    }
    /* 用户目录通常**就是** exe 同级目录，此时不能再单独推一条「随包」——同一批
     `plugin.json` 会被扫两遍，第二遍还会以「同 id 被跳过」的错误条目出现在设置页。
    只有用户目录被迫退回 app_data（拿不到 exe 路径）时，两者才不同，才分开扫。 */
    if let Some(dir) = exe_plugin_dir() {
        if dir != user_dir {
            roots.push((PluginSource::Exe, dir));
        }
    }
    roots.push((PluginSource::User, user_dir.to_path_buf()));
    roots
}

/// 读一个插件目录的启动头；失败返回一句能直接给用户看的中文原因。
pub fn read_manifest(dir: &Path) -> Result<PluginManifest, String> {
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
    Ok(manifest)
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
        return Err("entry=script 暂不支持，当前宿主只执行 manifest".into());
    }
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
    /* [v3] 面板：没升到 3 却写 panels 的清单要明确拒载，而不是让作者对着一个
       「写了但没出现」的插件猜。 */
    if !manifest.contributes.panels.is_empty() {
        if manifest.api_version < 3 {
            return Err("panels 需要 apiVersion 3".into());
        }
        crate::models::plugin_panel::validate_panels(&manifest.contributes.panels)?;
    }
    Ok(())
}

/// 扫描全部根目录下的插件子目录。
pub fn scan(user_dir: &Path) -> Vec<ScanHit> {
    let mut hits = Vec::new();
    for (source, root) in scan_roots(user_dir) {
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

/// 在资源管理器里打开插件目录（Windows）。
pub fn open_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("创建插件目录失败：{err}"))?;
    /* explorer 即使成功也常以退出码 1 结束，所以只 spawn 不 wait。 */
    Command::new("explorer")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("打开目录失败：{err}"))
}

#[cfg(test)]
#[path = "plugin_fs_test.rs"]
mod tests;
