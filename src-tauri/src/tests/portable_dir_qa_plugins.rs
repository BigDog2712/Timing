//! 便携落点（V0.11.6）**独立验收** · C 组（插件落点与去重）。
//!
//! 这里验两件事，各对应一条设计审查时标红的边界：
//!
//! - **C9** `plugin_base().join("plugins") == plugins_root()` 是否恒成立。
//!   结论写在断言注释里：对「`plugins_root` 没有父目录」这个构造**不会**退化成
//!   `plugins/plugins`（`Path::parent()` 对单段相对路径返回 `Some("")`）；真正脆弱的
//!   是另一件事——`plugin_base()` 无条件丢掉末段，末段不是字面量 `plugins` 时会静默
//!   指到隔壁目录。
//! - **C10 / C11** 便携模式下 `exe` 根与 `user` 根同路径：同一 id 只许一条记录、
//!   不许出现「被跳过」；同时记录「用户自己放的插件来源被标成 exe（前端显示随包）」
//!   这个语义偏差。

use std::path::{Path, PathBuf};

use crate::infra::plugin_fs;
use crate::models::plugin::{PluginInfo, PluginSource};

use super::portable_dir_qa::temp;

/// C9：不变式只在「末段是字面量 plugins」时成立。
#[test]
fn c9_plugin_base_invariant_holds_only_because_leaf_is_literally_plugins() {
    use crate::platform::app_dir;

    /* 现网口径（未注入 → 兜底 AppData）：不变式成立。 */
    assert_eq!(
        app_dir::plugin_base().join("plugins"),
        app_dir::plugins_root()
    );

    let base_of = |root: &Path| -> PathBuf {
        root.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root.to_path_buf())
    };

    /* 复现「plugins_root 没有父目录」：**不会**退化成 `plugins/plugins`，原因是
    `Path::new("plugins").parent() == Some("")`，而 `"".join("plugins") == "plugins"`。
    也就是说这条边界由 std 的语义兜住，不是代码显式处理过。 */
    assert_eq!(
        base_of(Path::new("plugins")).join("plugins"),
        PathBuf::from("plugins"),
        "单段相对路径不会多一层"
    );

    /* 真正会坏的反例：末段不是 `plugins` 时，`plugin_base()` 会跳到父目录，
    `plugin_fs` 于是扫的是**另一个目录**。今天三处构造（exe / appdata / sandbox）
    末段都是 `plugins`，所以恒成立；改成 `<exe>\\extensions` 就会静默扫错。 */
    assert_ne!(
        base_of(Path::new("extensions")).join("plugins"),
        PathBuf::from("extensions"),
        "末段不是 plugins 时不变式不成立 —— 这是 latent 耦合，不是恒等式"
    );
}

/// C10 / C11：exe 与 user 同根 → 一条记录、无「被跳过」、来源是 exe。
///
/// **[修复后口径]** `scan_roots` 现在读 `app_dir::is_portable()` 决定要不要 push `Exe`
/// 根（`infra/plugin_fs.rs`），而用例里不能调 `set()`，所以走 `scan_roots()` 时永远是
/// **非便携**分支。修复引入了可注入版本 `scan_roots_for(dir, portable)`，于是便携分支
/// 现在**可以**被机械验证了（`app_dir::is_portable()` 只留给生产路径读）。
#[test]
fn c10_c11_shared_root_yields_one_record_with_no_skip_note() {
    let exe_dir = std::env::current_exe()
        .expect("取测试二进制路径")
        .parent()
        .expect("有父目录")
        .to_path_buf();
    let key = |path: &Path| path.to_string_lossy().to_ascii_lowercase();
    let shared = exe_dir.join("plugins");

    /* ① 便携分支：只该有一条 `user`，路径就是 `<exe>\plugins`，且**没有** `exe` 根
    （用户自己放的插件不许自称「随包」）。 */
    let portable = plugin_fs::scan_roots_for(&exe_dir, true);
    assert!(
        portable
            .iter()
            .all(|(source, _)| *source != PluginSource::Exe),
        "便携模式不该产出 exe 根：{portable:?}"
    );
    let users: Vec<&PathBuf> = portable
        .iter()
        .filter(|(source, _)| *source == PluginSource::User)
        .map(|(_, dir)| dir)
        .collect();
    assert_eq!(users.len(), 1, "便携模式只该有一条 user 根：{portable:?}");
    assert_eq!(users[0], &shared, "便携模式的用户根就是 exe 旁边的 plugins");

    /* ② 回退分支：exe 与 user 是两个不同目录，两条都在（行为不许回归）。 */
    let fallback = plugin_fs::scan_roots_for(&exe_dir, false);
    let same: Vec<&PluginSource> = fallback
        .iter()
        .filter(|(_, dir)| key(dir) == key(&shared))
        .map(|(source, _)| source)
        .collect();
    assert_eq!(same.len(), 1, "同一目录只许出现一次：{fallback:?}");
    assert_eq!(same[0], &PluginSource::Exe, "去重保留先到的那条");

    /* ③ 端到端红线：真放一个插件进去，看 list() 是否只出一条、且没有「被跳过」。 */
    let id = format!("qa-dup-{}", std::process::id());
    let dir = shared.join(&id);
    std::fs::create_dir_all(&dir).expect("建插件目录");
    std::fs::write(
        dir.join("plugin.json"),
        format!(r#"{{"id":"{id}","name":"QA 去重","version":"1.0.0","apiVersion":3}}"#),
    )
    .expect("写启动头");

    let listed = crate::services::plugin::list(&exe_dir);
    let mine: Vec<&PluginInfo> = listed.plugins.iter().filter(|p| p.id == id).collect();
    let with_suffix: Vec<&PluginInfo> = listed
        .plugins
        .iter()
        .filter(|p| p.id.ends_with(&id))
        .collect();

    std::fs::remove_dir_all(&dir).ok();

    assert_eq!(mine.len(), 1, "同一 id 只许一条记录：{with_suffix:?}");
    assert_eq!(
        with_suffix.len(),
        1,
        "不许出现第二条「被跳过」记录（回归红线）：{with_suffix:?}"
    );
    assert!(
        mine[0].error.is_none(),
        "不该被同 id 挡住：{:?}",
        mine[0].error
    );
    /* C10 语义偏差（报告用断言固化）：用户自己放进便携版 plugins 的插件，
    来源被标成 `exe` → 设置页 `SOURCE_LABEL.exe = '随包'`，用户看到「随包」。 */
    assert_eq!(
        mine[0].source, "exe",
        "来源是 exe（前端显示「随包」，非「用户」）"
    );
    assert_eq!(
        key(Path::new(&mine[0].dir)),
        key(&dir),
        "目录指向的就是用户放的那个"
    );
}

/// C12：`<exe>\data\plugins` **不在扫描拓扑里**（记录事实，不是认可这个行为）。
///
/// 后果链（报告 C12 有完整引用）：便携 zip 里带 `<exe>\plugins\README.txt`
/// （`scripts/build-desktop.mjs:210-215` 用它占位，否则空目录不进 zip）→
/// `app::portable_boot::move_plugins`（`portable_boot.rs:210-217`）的
/// `if plugins_dir.exists() { warn; return; }` 对**每一个**解压便携包的用户都成立 →
/// 迁移过来的旧插件留在 `<exe>\data\plugins` → 而这里证明该目录**从不被扫描**。
/// 结论：升级到便携版后，用户原来装在 `%APPDATA%\com.timing.app\plugins` 的插件
/// 在设置页里全部消失（文件还在，功能没了）。
#[test]
fn c12_data_plugins_subtree_is_outside_the_scan_topology() {
    let exe_dir = std::env::current_exe()
        .expect("取测试二进制路径")
        .parent()
        .expect("有父目录")
        .to_path_buf();
    let key = |path: &Path| path.to_string_lossy().to_ascii_lowercase();

    /* 迁移后的形态：老插件在 <exe>\data\plugins，<exe>\plugins 已存在（zip 占位）。 */
    let id = format!("qa-stranded-{}", std::process::id());
    let stranded = exe_dir.join("data").join("plugins").join(&id);
    std::fs::create_dir_all(&stranded).expect("建 data\\plugins");
    std::fs::write(
        stranded.join("plugin.json"),
        format!(r#"{{"id":"{id}","name":"QA 遗留","version":"1.0.0","apiVersion":3}}"#),
    )
    .expect("写启动头");

    let roots = plugin_fs::scan_roots(&exe_dir);
    let in_data: Vec<String> = roots
        .iter()
        .filter(|(_, dir)| key(dir).contains("\\data\\"))
        .map(|(_, dir)| key(dir))
        .collect();
    let listed = crate::services::plugin::list(&exe_dir).plugins;
    let found = listed.iter().any(|p| p.id == id);

    std::fs::remove_dir_all(&stranded).ok();
    std::fs::remove_dir(exe_dir.join("data").join("plugins")).ok();
    std::fs::remove_dir(exe_dir.join("data")).ok();

    assert!(
        in_data.is_empty(),
        "scan_roots 不该扫 data 子树：{in_data:?}"
    );
    assert!(
        !found,
        "事实变了：data\\plugins 现在会被扫到 —— 那 C12 的后果链要重写"
    );
}

// ---------------------------------------------------------------------------
// C13 / C14：独立复验「便携 zip 形态下旧插件到底会不会被搬过去」
//
// `move_plugins` 现在 `pub(crate)` 且路径全注入，可以绕开 `prepare()` 直接跑真实形态，
// 不必依赖工程师自己那两条用例的夹具。
// ---------------------------------------------------------------------------

/// 造一个「解压后的便携目录 + 一份待迁移的老插件」。
fn portable_zip_shape(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let exe = temp(tag).join("app");
    let data = exe.join("data");
    let plugins = exe.join("plugins");
    std::fs::create_dir_all(&plugins).expect("建 <exe>\\plugins");
    /* zip 里的占位兼说明文件：它就是「<exe>\plugins 必然存在」的原因。 */
    std::fs::write(plugins.join("README.txt"), b"place plugins here").expect("写占位");
    std::fs::create_dir_all(data.join("plugins")).expect("建 <data>\\plugins");
    (exe, data, plugins)
}

fn write_plugin(dir: &Path, id: &str, version: &str) {
    std::fs::create_dir_all(dir).expect("建插件目录");
    std::fs::write(
        dir.join("plugin.json"),
        format!(r#"{{"id":"{id}","name":"{id}","version":"{version}","apiVersion":3}}"#),
    )
    .expect("写启动头");
}

/// C13：`<exe>\plugins` 已存在（zip 占位）时，老插件必须被搬到 `<exe>\plugins\<name>`。
#[test]
fn c13_old_plugins_are_moved_beside_exe_even_when_target_exists() {
    let (_exe, data, plugins) = portable_zip_shape("qa-c13");
    write_plugin(&data.join("plugins").join("demo"), "demo", "1.0.0");

    crate::app::portable_boot::move_plugins(&data, &plugins);

    assert!(
        plugins.join("demo").join("plugin.json").is_file(),
        "老插件没被搬到 <exe>\\plugins —— 升级用户的插件会全部失效"
    );
    assert_eq!(
        std::fs::read(plugins.join("README.txt")).expect("占位仍在"),
        b"place plugins here",
        "占位文件不许被覆盖或删除"
    );
    assert!(
        !data.join("plugins").exists(),
        "搬空后的 <data>\\plugins 应被清掉，免得留一个空目录让人以为还有插件"
    );
}

/// C14：撞名时两份都保留，**绝不覆盖** `<exe>\plugins` 里已有的那一份。
#[test]
fn c14_name_clash_keeps_both_and_never_overwrites() {
    let (_exe, data, plugins) = portable_zip_shape("qa-c14");
    write_plugin(&plugins.join("demo"), "demo", "2.0.0-bundled");
    write_plugin(&data.join("plugins").join("demo"), "demo", "1.0.0-old");

    crate::app::portable_boot::move_plugins(&data, &plugins);

    let kept =
        std::fs::read_to_string(plugins.join("demo").join("plugin.json")).expect("读已有一份");
    assert!(kept.contains("2.0.0-bundled"), "已有那份被覆盖了：{kept}");
    assert!(
        data.join("plugins")
            .join("demo")
            .join("plugin.json")
            .is_file(),
        "撞名的那份必须留在原地（两份都不删），否则用户数据没了"
    );
}
