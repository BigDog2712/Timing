//! [O3] 更新通道死链的「不回来」哨兵（2026-11-16 整批删除）
//!
//! ## 删的是什么，为什么必须留判据
//!
//! 上游（Patina）自带一条自动更新链：启动自检 → `cmd_check_for_updates` →
//! `cmd_download_update` → `cmd_install_update` → 重启安装。它的 endpoints 指向
//! `github.com/Ceceliaee/patina` —— **别人的仓库**。这条链在本工程里从未真正可用：
//! `tauri-plugin-updater` 因为 `tauri.conf.json` 缺 `plugins.updater` 配置而**从未注册**，
//! 所以它一直是一段「点得到、永远失败」的死链，而界面上还挂着一个真按钮。
//!
//! 2026-11-16 按评审 O3 整批删除：后端 1 185 行、前端 642 行、4 条命令、1 个依赖、
//! 1 条启动分支。**半拆比全拆更坏**：命令删了、白名单没删 ⇒ `check:contract` 会红；
//! 前端删了、命令还在 ⇒ 白名单里留一条没人调的命令，下次有人照着它写前端就又接回别人的
//! 下载页。所以判据按「每个接点各一条」钉死，而不是只钉「文件不在了」。
//!
//! ## 为什么是源码哨兵而不是行为测试
//!
//! 这条链的**存在**本身才是缺陷（指向他人仓库的下载源），而不是它算错了什么。要在运行时
//! 观测它，得真起一个 Tauri App 并让插件初始化失败一次；而它的**消失**又不可能从行为上
//! 观测（没有行为）。只能钉「这些接点上没有它」。
//!
//! ## 防空转（`o3_05`）
//!
//! 负向断言最典型的失效形态是「文件被挪走 / 结构变了 ⇒ `contains` 恒假 ⇒ 永远绿」。
//! 所以最后一条是**正向对照**：每个 haystack 必须仍然含有它此刻确实含有的结构标记。
//! 改结构（比如把 `generate_handler![` 换掉）时它会先红，提醒先修本文件的扫描面。

const CARGO_MANIFEST: &str = include_str!("../../Cargo.toml");
const IPC_COMMANDS: &str = include_str!("../ipc_commands.rs");
const WINDOW_PERMS: &str = include_str!("../../permissions/window-commands.toml");
const BOOTSTRAP: &str = include_str!("../app/activity/bootstrap.rs");
const RUNTIME_TASKS: &str = include_str!("../app/activity/runtime_tasks.rs");
const DIAGNOSTICS: &str = include_str!("../commands/activity/diagnostics_cmd.rs");

/// 被删掉的四条命令。名字逐字写死：**改名字等于把通道接回来**，本条判据就该红。
const REMOVED_COMMANDS: [&str; 4] = [
    "cmd_get_update_snapshot",
    "cmd_check_for_updates",
    "cmd_download_update",
    "cmd_install_update",
];

#[test]
fn o3_01_removed_update_commands_are_gone_from_both_ipc_surfaces() {
    /* 两处必须同时消失：注册表（`generate_handler!`）与 ACL 白名单（`commands.allow`）。
    只删一处时 `check:contract` 也会红，但那是「脚本红」；本条钉的是**语义**：
    这四个名字一个都不许回来，无论写在哪一侧。 */
    for (name, src) in [
        ("ipc_commands.rs", IPC_COMMANDS),
        ("permissions/window-commands.toml", WINDOW_PERMS),
    ] {
        for command in REMOVED_COMMANDS {
            assert!(
                !src.contains(command),
                "{name} 里又出现了 `{command}`。\n\
                 这条命令属于指向他人仓库（github.com/Ceceliaee/patina）的更新通道，\n\
                 2026-11-16 已整批删除。真要给 Timing 做自动更新，请**按 Timing 自己的\n\
                 发布源**重写一套（含 tauri.conf.json 的 plugins.updater 配置），\n\
                 不要把这四个名字接回旧链——旧链的下发方不是本项目的仓库。"
            );
        }
    }
}

/// TOML 去注释（`#` 到行末）。**判据判的是依赖行，不是字面量**：说明「为什么删了它」
/// 的那段注释里必然写着 crate 名，不剥注释的话本判据会先红在自己的解释上
/// （`check-storage-keys.mjs` 判 `patina:` 字面量时踩过同一个坑，处理方式一致）。
fn toml_without_comments(src: &str) -> String {
    src.lines()
        .map(|line| line.split('#').next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn o3_02_updater_plugin_is_not_a_dependency() {
    /* 依赖在 `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`。
    加回来就会在 `cargo build` 时把 `tauri-plugin-updater` 编进桌面包——即使没人注册它。 */
    assert!(
        !toml_without_comments(CARGO_MANIFEST).contains("tauri-plugin-updater"),
        "Cargo.toml 又把 `tauri-plugin-updater` 加回来了。\n\
         它要求 `tauri.conf.json` 的 `plugins.updater` 是一份完整配置（pubkey + endpoints），\n\
         缺失时插件初始化直接 panic（整个应用起不来）；而本工程的 endpoints 曾经指向\n\
         别人的仓库。真要做自动更新，先把发布源换成 Timing 自己的，再一并改这条判据。"
    );
}

#[test]
fn o3_03_update_runtime_state_is_no_longer_managed() {
    /* 状态与自检任务：删了命令但状态还 `.manage(...)` 着，`diagnostics_cmd` 的
    `try_state` 就会拿到一个永不更新的快照——症状是「诊断面板里有一格永远是 0」。 */
    for (name, src) in [
        ("app/activity/bootstrap.rs", BOOTSTRAP),
        ("app/activity/runtime_tasks.rs", RUNTIME_TASKS),
    ] {
        for needle in ["UpdaterRuntimeState", "spawn_updater_startup_auto_check"] {
            assert!(
                !src.contains(needle),
                "{name} 里又出现了 `{needle}`：更新运行时状态已随 O3 删除，\n\
                 接回来等于恢复一条永远拿不到 plugin 的自检链（启动后只会往前端 emit\n\
                 一次失败快照，用户看到的是一次无意义的错误提示）。"
            );
        }
    }
}

#[test]
fn o3_04_diagnostics_no_longer_reports_updater_packages() {
    /* `updater_retained_package` 是「下载完待安装的包」的统计口径。它整条命都是更新的：
    没有下载就没有包。前端 `resourceDiagnosticsRuntimeGateway` 里的同名解析已同批删除，
    两侧任一处单独回来 ⇒ 解析器校验失败 ⇒ 诊断快照整份被判非法（面板空白、零日志）。 */
    assert!(
        !DIAGNOSTICS.contains("updater_retained_package"),
        "diagnostics_cmd.rs 又输出了 `updater_retained_package`。\n\
         它的唯一来源是更新引擎下载后保留的安装包，引擎已删 ⇒ 这一格永远是\n\
         {{retained:false}}；而前端校验器要求字段齐全，两边不同步就会让**整份**诊断\n\
         快照被判非法。要恢复请连同前端 gateway 的类型与校验一起改。"
    );
}

#[test]
fn o3_05_sentinels_are_not_vacuous() {
    /* 正向对照：上面四条都是 `!contains(...)`，扫描面一旦漂移（文件被拆、标记被改名），
    它们全部「恰好通过」——绿着空转。这里逐条确认每个 haystack 仍然是它声称的那个文件。 */
    assert!(
        CARGO_MANIFEST.contains("tauri-plugin-opener")
            && CARGO_MANIFEST.contains("[dependencies]"),
        "Cargo.toml 的扫描面不对了（找不到 opener 依赖或 [dependencies] 段）：先修本文件的 include_str! 路径"
    );
    assert!(
        IPC_COMMANDS.contains("generate_handler!["),
        "ipc_commands.rs 里找不到 `generate_handler![`：命令表结构变了，先修本文件的扫描口径"
    );
    assert!(
        WINDOW_PERMS.contains("cmd_get_web_activity_bridge_snapshot")
            && WINDOW_PERMS.contains("commands.allow"),
        "window-commands.toml 的扫描面不对了（找不到仍应存在的邻居命令或 allow 段）"
    );
    assert!(
        BOOTSTRAP.contains("fn register_managed_state_and_plugins"),
        "bootstrap.rs 里找不到状态注册函数：扫描面漂移"
    );
    assert!(
        RUNTIME_TASKS.contains("spawn_tracking_runtime_restart_loop"),
        "runtime_tasks.rs 里找不到仍应存在的任务启动函数：扫描面漂移"
    );
    assert!(
        DIAGNOSTICS.contains("ResourceDiagnosticsSnapshot"),
        "diagnostics_cmd.rs 里找不到诊断快照结构体：扫描面漂移"
    );
}
