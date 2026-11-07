//! 启动期把「用户指定的自定义数据根」接上（V0.11.15，设计 §1.2 / §3.2）。
//!
//! 从 `portable_boot.rs` 拆出来是**行数**逼出来的，不是设计偏好：那边现在 284 行、
//! 上限 300，塞不进这棵三选一对话框的树。判据本身仍只有一处——它在落点链的**第 ① 步**，
//! 排在 optout 与 `<exe>\data` 探测之前：
//!
//! ```text
//! 无 data-root.json      → None（继续往下，行为与今天逐字一致）
//! 有指针，目录可写        → 注入 Roots{data:指针, plugins:<exe>\plugins} → Proceed
//! 有指针，目录不可写      → 阻塞对话框（重试 / 这次按默认流程 / 退出）
//! 坏 JSON / 读不出        → 当不存在 → None
//! ```
//!
//! ## 为什么指针优先于 optout
//!
//! 用户主动设的自定义根必须高于「程序自动回退」，否则他设了也永远不生效（PRD 4.2）。
//! 这条优先级的纯函数形态在 `services::data_root::decide`（可单测）；本文件是它在
//! 生产路径上的落点。
//!
//! ## 指针生效时**不做数据迁移**
//!
//! 数据是用户在图形界面里自己选、自己确认复制过去的。启动期再搬一次就成了「悄悄搬
//! 第二遍」——而那时源可能已经被用户删了。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::app::portable_boot::{self, BootChoice};
use crate::app::portable_prompt::{self as prompt, Choice};
use crate::infra::{portable_probe, root_pointer};
use crate::platform::app_dir::{self, Roots};
use crate::services::data_root;

/// 「指针在，但这次按默认流程启动」的书面证据（日志就绪后由 `bootstrap` 补记）。
///
/// 本层跑在 `platform::log::init` 之前，写不了日志；而这条路必须**可见**——否则用户
/// 看到数据落在别处、指针文件却好端端地在那儿，没人能解释为什么。
static SKIPPED: Mutex<Option<String>> = Mutex::new(None);

/// 读一次「被跳过的指针」（`bootstrap` 在日志就绪后调）。
pub fn skipped() -> Option<String> {
    SKIPPED.lock().ok().and_then(|guard| guard.clone())
}

/// `Some(..)` = 本函数已经做出决定（调用方直接把它当 `prepare` 的结果返回）；
/// `None` = 继续走原流程（optout → 探测 → 迁移）。
pub fn apply(identifier: &str) -> Option<BootChoice> {
    /* 拿不到 AppData 或 exe 目录时退回原流程：那两个位置正是指针与 `<exe>\plugins`
    的来源，缺任何一个都无法正确注入。 */
    let appdata = app_dir::appdata_dir(identifier)?;
    /* 优先级判据**只有一份**：`services::data_root::decide`（纯函数、可单测）。
    本文件不许再写一遍「有指针就用指针」——抄两份，改规则时必然漏一处。 */
    let pointer = root_pointer::read(&appdata);
    let optout_exists = portable_probe::read_optout(&appdata).is_some();
    match data_root::decide(pointer.as_ref(), optout_exists) {
        data_root::PointerChoice::Default => return None,
        data_root::PointerChoice::UsePointer => {}
    }
    let target = PathBuf::from(pointer?.data_dir.trim());
    let exe_dir = app_dir::exe_dir()?;
    let default_data = exe_dir.join("data");

    loop {
        match portable_probe::probe(&target) {
            Ok(()) => break,
            Err(reason) => {
                match prompt::ask_data_root_unavailable(&reason, &target, &default_data) {
                    /* 重试：用户可能刚插回移动盘 / 刚给完权限。 */
                    Choice::Proceed => continue,
                    /* 「这次按默认流程启动」：**指针保留**，下次启动仍先试它。 */
                    Choice::AppData(_) => {
                        remember_skipped(&target, &reason);
                        return None;
                    }
                    Choice::Quit => return Some(BootChoice::Abort),
                }
            }
        }
    }

    let portable = target == default_data;
    let plugins = exe_dir.join("plugins");
    /* 防御性的一次插件搬运：正常顺序下 `<exe>\data\plugins` 早在首启就搬完了，但若那次
    搬失败（撞名 / 权限），跳过整个探测分支会让用户「插件全都不见了」而没有任何日志。 */
    portable_boot::move_plugins(&default_data, &plugins);
    app_dir::set(Roots {
        data: target.clone(),
        plugins,
        portable,
    });
    portable_boot::cache_note(&target, portable, None, "pointer");
    Some(BootChoice::Proceed)
}

fn remember_skipped(target: &Path, reason: &str) {
    if let Ok(mut guard) = SKIPPED.lock() {
        *guard = Some(format!(
            "{}（不可写：{reason}）",
            target.display()
        ));
    }
}
