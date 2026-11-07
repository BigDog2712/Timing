//! 数据根指针（V0.11.15，设计 §3.1）：`%APPDATA%\<identifier>\data-root.json`。
//!
//! ## 为什么放在 `%APPDATA%\<identifier>\`
//!
//! 它必须在「数据根被决定之前」可读——那时库、日志、`app_dir` 都还不存在。与
//! `portable-optout.json` 同目录是唯一已被证明在此之前可达、可写的地方。
//!
//! ## 坏文件当不存在
//!
//! 与 `portable_probe::read_optout` 同一口径：一个被编辑器改坏 / 半截写入的 JSON
//! 不该让用户**永久**卡在一个不存在的目录上。读不出来就重新走默认流程。
//!
//! ## 纯 IO，不读 identifier
//!
//! 目录由调用方传进来（生产 = `app_dir::appdata_dir(identifier)`，测试 = 临时目录），
//! 于是这个文件可以用一个临时目录直接测，不必碰 `app_dir` 的 `OnceLock`。

use std::path::{Path, PathBuf};

/// 指针文件名。名字是文档口径（告诉用户「删掉它即可回到默认」），**不许变**。
pub const POINTER_FILE: &str = "data-root.json";

/// schema 版本（字段只增不改，与 `OptOut` 同一口径）。
const POINTER_SCHEMA: u32 = 1;

/// 指针内容。`data_dir` 是**下次启动**要用的数据根，不是当前生效的那个。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootPointer {
    pub schema: u32,
    /// 切换时刻（RFC 3339，本地时区）
    pub at: String,
    pub app_version: String,
    pub data_dir: String,
    /// 切换那一刻**正在生效**的数据根（可能是 `<exe>\data`、`%APPDATA%\<id>`，
    /// 或上一个自定义根）。撤销时用它回退。
    #[serde(default)]
    pub previous: Option<String>,
}

/// 指针文件的完整路径。
pub fn path_of(appdata: &Path) -> PathBuf {
    appdata.join(POINTER_FILE)
}

/// 读指针。无文件 / 坏 JSON / `dataDir` 为空 → `None`（当不存在）。
pub fn read(appdata: &Path) -> Option<RootPointer> {
    let raw = std::fs::read_to_string(path_of(appdata)).ok()?;
    let pointer: RootPointer = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    /* 空路径的指针等于「把数据根指到进程 CWD」，比没有指针更糟：当作不存在。 */
    if pointer.data_dir.trim().is_empty() {
        return None;
    }
    Some(pointer)
}

/// 写指针。先在内存里 `to_string_pretty` 序列化完再落盘（不写半截文件）。
///
/// 与 `write_optout` 的差别：那边失败只记 ERROR（用户已经在用那个目录了）；这边
/// 失败必须回给用户——切换动作的**唯一**可见结果就是这个文件。
pub fn write(appdata: &Path, data_dir: &str, previous: Option<&str>) -> Result<(), String> {
    let record = RootPointer {
        schema: POINTER_SCHEMA,
        at: chrono::Local::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: data_dir.to_string(),
        previous: previous
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string),
    };
    let text = serde_json::to_string_pretty(&record).map_err(|err| format!("序列化失败：{err}"))?;
    std::fs::create_dir_all(appdata).map_err(|err| format!("建不了配置目录：{err}"))?;
    std::fs::write(path_of(appdata), text).map_err(|err| format!("写不了 {POINTER_FILE}：{err}"))
}

/// 删指针（撤销到默认根）。文件本来就不在 = 成功（幂等）。
pub fn clear(appdata: &Path) -> Result<(), String> {
    match std::fs::remove_file(path_of(appdata)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("删不掉 {POINTER_FILE}：{err}")),
    }
}
