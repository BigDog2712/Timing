//! 数据根落点的对外形状（V0.11.15，设计 §4.2）。
//!
//! `data_root_get` / `data_root_change` 的返回值，与 `src/types/domain/dataRoot.ts`
//! 逐字对应（`rename_all = "camelCase"`）。这里只有形状，没有判据——「该不该切、
//! 能不能切」在 `services::data_root`。

/// 五项清单里的一项（PRD 4.2：切换前必须让用户看清「搬什么、多大」）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootEntry {
    /// `timing.db` / `backups` / `logs` / `md` / `migrated-from-tickbar-app.json`
    pub name: String,
    pub is_dir: bool,
    /// 源里到底有没有这一项。`false` 时前端不显示体积——「0 B」与「没有」是两件事。
    pub present: bool,
    /// 递归求和（`is_dir` 时）；文件不存在为 0。
    pub bytes: u64,
}

/// 数据根的一次快照。`current` 是**当前生效**的路径，`default_path` 是**出厂值**
/// （`<exe>\data`）——两者混在一处会让用户看到错的路径（设计 §8-7）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootInfo {
    pub current: String,
    pub default_path: String,
    /// `current == default_path`（回退到 `%APPDATA%` 或自定义根时都是 `false`）
    pub is_default: bool,
    /// 进页签时探测一次（PRD 4.2）。不做轮询：拔掉移动盘后徽标仍显示可写，
    /// 真正的失败会在 `data_root_change` 的预检里当场说出来。
    pub writable: bool,
    pub writable_error: Option<String>,
    /// 指针里写的、**重启后才生效**的新位置。`Some` 时前端常驻黄条。
    pub pending: Option<String>,
    /// 「改回旧位置」的目标（指针里的 `previous`）。
    pub previous: Option<String>,
    /// 五项体积之和。
    pub size_bytes: u64,
    pub entries: Vec<DataRootEntry>,
    /// 受 `%APP_DIR%` 影响的落点种类名（`事项计时` / `便利贴` / `待办事项`）。
    /// 写成绝对路径的落点不受影响，不列出。
    pub affected: Vec<String>,
    /// 插件目录现在是否就在数据根里（回退态下属实）。`true` 时前端要追加一句
    /// 「plugins 不会跟着搬，请自己搬」——这是唯一一种「搬完以后插件不见了」。
    pub plugins_in_data_root: bool,
}

/// 承载用户数据的五张表（设计 §3.5，已在迁移文件里核实）。
///
/// `md_cloud_pending` **不在其中**：它是同步簿记，丢了下一轮会自己重建。
/// `VACUUM INTO` 会把整库（含它）都带过去，所以这份清单只用于「核对搬运结果」，
/// 不是「复制清单」。
pub const USER_TABLES: [&str; 5] = ["items", "time_records", "notes", "todos", "settings"];
