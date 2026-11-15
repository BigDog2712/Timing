//! 本机设备身份（`install_id`）的落盘读取 + 进程级缓存 + 本地日键。**零 `AppHandle`**。
//!
//! ## 为什么这一层在 `services/` 顶层而不是 `insight/schema_core/`
//!
//! 它原本是 `services/insight/schema_core/device.rs`（`insight` 整体 `#[cfg(desktop)]`）。
//! 但**计时事件流**（`services/timer_ops` + `repositories/timer_ops`）在两端都要写
//! `device_id`，而手机端编不进 `insight`。身份是「这台机器是谁」，与 patina 分析窗
//! 毫无关系，放这里才是它该在的层；`schema_core::device` 留了一个转发壳，
//! `adopt_local_rows` 那套老调用点一个字都不用改。
//!
//! ## 落盘位置（唯一权威，别在别处再存一份）
//!
//! `<app_config_dir>/install_id.txt` —— 桌面上 = `%APPDATA%\com.timing.app\`，
//! 安卓 = `/data/user/0/com.timing.app/`（Kotlin 侧 `context.getDataDir()`）。
//!
//! 为什么和 `data-root.json` / `portable-optout.json` 同目录：**它必须在「数据根被
//! 决定之前」可读**。正因为如此，也**不许**把 install_id 塞进 `patina.db` 的 settings
//! 或 `timing.db` 再读回来当权威——数据根一换（或整库拷到另一台机器），副本必然漂，
//! 于是同一台机器出现两个身份，同步时分片目录对不上。
//!
//! ## 格式
//!
//! 12 位小写 hex（`uuid v4` 的前 12 个 hex 字符，48 bit 熵）。选它而不是完整 UUID：
//! 它要出现在目录名、设备码和 uid 前缀里，短一半；同一个人手里的设备数量级是「台」，
//! 48 bit 足够。**不许**用主机名 / `Build.MODEL` / `'local'`：前两者会随用户改名而变，
//! 后者会与「本机 id 就叫 local」混淆。
//!
//! ## 失败 = 返回 Err（不许静默兜底）
//!
//! 写文件失败时**不能**「本次运行用一个临时 id」：那会让这一批行带着一个下次启动
//! 再也不存在的 device_id 落库，成为永久脏数据（release 是 `panic = "abort"`，
//! 也不许 `expect`）。调用方按 `IO_ERROR` 处理。
//!
//! 唯一的例外是 [`install_id`]：它服务「用户按下开始按钮」这条路径，失败时退化为
//! `None`（该会话不同步），而不是让计时用不了。区别写在那里的注释里。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 身份文件名。名字是文档口径（用户能看到），**不许变**。
pub const INSTALL_ID_FILE: &str = "install_id.txt";

/// 身份的字符数（12 位小写 hex）。
const INSTALL_ID_LEN: usize = 12;

/// 本机配置目录：`%APPDATA%\com.timing.app`（Windows）/ 等价的 per-user 目录。
///
/// **测试隔离**：`cargo test --lib` 会有几十处经 `prepare_pool_schema` 走到这里。
/// 那些用例的库全是 `:memory:` 或临时文件，绝不能让它们去读写开发机上**真实的**
/// `%APPDATA%\com.timing.app\install_id.txt`——那会在从没跑过 App 的机器上凭空造出一个
/// 身份文件，而且并行用例会互相看见同一个身份。测试二进制改用进程级临时目录。
pub fn config_dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    let dir = std::env::temp_dir().join(format!("timing-test-config-{}", std::process::id()));
    #[cfg(not(test))]
    let dir = crate::platform::app_dir::fallback_appdata();

    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create config dir `{}`: {error}", dir.display()))?;
    Ok(dir)
}

/// 用默认配置目录读/生成本机身份（`install_id` 的落盘版本，无缓存）。
pub fn load_install_id() -> Result<String, String> {
    ensure_install_id(&config_dir()?)
}

/// 进程级缓存的 `install_id`。
///
/// ## 为什么缓存
///
/// 计时接线（`services::timer` 的 start / pause / resume / stop）每次都要拿它来写
/// `timer_ops.device_id`，而读它是**同步文件 IO**。放在点按路径上等于每按一次按钮
/// 做一次系统调用，而那条路径是 async 的 —— 阻塞的是 runtime 线程。
///
/// ## 为什么是 `Option` 而不是 `Result`
///
/// 身份读不出来（权限被拒 / 磁盘满 / 配置目录不可写）时**不能阻塞计时**：
/// 用户按下「开始」必须能开始，哪怕这条会话最终无法同步。代价是诚实记在日志里
/// （下面的 WARN），而不是让它静默消失。
///
/// ## 谁会填它
///
/// 启动流程的两条身份接线（`services::device::startup_identity` /
/// `startup_business_identity`）都会调 [`remember_install_id`]，所以正常运行期这里
/// 恒为 `Some`。`None` 只出现在「启动接线失败但用户仍点了开始」这种降级路径上。
static INSTALL_ID: OnceLock<Option<String>> = OnceLock::new();

/// 本机身份（12 位小写 hex），首次调用时读/生成并缓存。
///
/// 失败返回 `None` 并打一行 WARN：调用方据此跳过事件写入，但**业务操作照常完成**。
pub fn install_id() -> Option<&'static str> {
    INSTALL_ID
        .get_or_init(|| match load_install_id() {
            Ok(id) => Some(id),
            Err(error) => {
                crate::log_warn!(
                    "install id unavailable, timer events will not be exported: {error}"
                );
                None
            }
        })
        .as_deref()
}

/// 启动流程已知身份时直接登记，省掉第一次读文件。
///
/// 只写一次（`OnceLock::set` 后续失败被忽略）：同一个进程里身份不该变，
/// 变了就意味着两次启动读到了不同的文件内容 —— 那是数据目录被换掉的信号，
/// 让它保持首次的值比静默切换更安全。
pub fn remember_install_id(install_id: &str) {
    let _ = INSTALL_ID.set(Some(install_id.to_string()));
}

/// 登记本机身份，并返回**本进程接下来真会用的那一份**（以缓存为准）。
///
/// ## 为什么不能直接用调用方手上那一个
///
/// [`remember_install_id`] 是「先到先得」：`OnceLock::set` 后续失败被忽略，所以
/// 传进去的 `candidate` 未必真的进了缓存。一旦两者不同，这次启动就会拿 `candidate`
/// 去认领历史行，而之后新写入的行用的是缓存里那个 ⇒ **同一台机器出现两个
/// `device_id`**：历史行被认领到一台「不存在」的设备上，新行归属另一台，
/// 同步时分片对不上，而两边都不报错。
///
/// 这不是假想：`ensure_install_id` 的并发写者各自 rename，落盘值以最后一个为准，
/// 于是「同时解析身份的两个线程」可以读到两个不同的值（两个池的启动接线一起跑、
/// 或身份文件刚被创建时都会命中）。所以对外只认缓存 —— 它是本进程接下来每条行都会
/// 写下的那个值。
pub fn remember_and_lock_install_id(candidate: String) -> String {
    remember_install_id(&candidate);
    match install_id() {
        Some(cached) => cached.to_string(),
        /* 缓存里明确是 `None`（读写失败降级）时没有更权威的值，用读到的这一份。 */
        None => candidate,
    }
}

/// 本地日键（`YYYY-MM-DD`，本地时区）。
///
/// 与 `activity_daily_totals.day_key` 和远端分片名 `day-YYYY-MM-DD.jsonl` 同一个口径：
/// 10 位、连字符位置固定。放这里是因为**两端都要**（桌面算分片名、手机算上报日），
/// 而原先的实现藏在 `insight`（`#[cfg(desktop)]`）里，手机端够不着。
///
/// 禁 `toISOString().slice(0,10)`：那是 UTC 日界，东八区每天 00:00–08:00 的记录
/// 会被算进前一天。
pub fn local_day_key(at_ms: i64) -> Result<String, String> {
    use chrono::TimeZone;

    chrono::Local
        .timestamp_millis_opt(at_ms)
        .single()
        .map(|moment| moment.format("%Y-%m-%d").to_string())
        .ok_or_else(|| format!("timestamp {at_ms} ms is out of the representable range"))
}

/// 完整路径。
pub fn path_of(config_dir: &Path) -> PathBuf {
    config_dir.join(INSTALL_ID_FILE)
}

/// 原子落盘用的临时文件序号（同进程内并发调用时区分，见 `ensure_install_id`）。
static TEMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 读出本机 `install_id`；文件不存在则生成一个并**原子落盘**。
///
/// 原子性：先写 `install_id.txt.<pid>.<seq>.tmp` 再 `rename`（同目录 rename 是原子的）。
/// 直接覆写会让「写到一半崩了」留下半截 id —— 那比没有文件更糟，因为下一次读会
/// 把它当成合法 id（校验只查长度与字符集）。
///
/// ## 临时文件名必须唯一（不是洁癖，是真踩过）
///
/// 早前用的固定名 `install_id.txt.tmp`：两个写者同时进来时，A 建好 tmp、B 已经把它
/// rename 走了，A 的 rename 直接 `os error 2`（系统找不到指定的文件）——
/// 在 `cargo test` 的并行线程下必现，表现为**随机某条**用例红。
/// 现在每个写者用自己的临时名，且**以落盘值为准**返回：并发时各写者生成的值可能不同，
/// 但目录里最终只有一份，所有调用者必须读到同一份，否则同一台机器会出现两个身份。
pub fn ensure_install_id(config_dir: &Path) -> Result<String, String> {
    let path = path_of(config_dir);
    if let Some(existing) = read_valid(&path)? {
        return Ok(existing);
    }
    let generated = generate()?;
    std::fs::create_dir_all(config_dir)
        .map_err(|error| format!("failed to create config dir `{}`: {error}", config_dir.display()))?;
    let seq = TEMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = config_dir.join(format!("{INSTALL_ID_FILE}.{}.{seq}.tmp", std::process::id()));
    {
        let mut file = std::fs::File::create(&temp)
            .map_err(|error| format!("failed to create install id file: {error}"))?;
        file.write_all(generated.as_bytes())
            .map_err(|error| format!("failed to write install id file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("failed to flush install id file: {error}"))?;
    }
    std::fs::rename(&temp, &path).map_err(|error| {
        /* rename 失败（例如目标被占用）时把临时文件清掉，别留垃圾。 */
        let _ = std::fs::remove_file(&temp);
        format!("failed to commit install id file: {error}")
    })?;
    /* 并发写者可能都 rename 成功（后写者覆盖前者）：以落盘的那一份为准。 */
    Ok(read_valid(&path)?.unwrap_or(generated))
}

/// 读一个**已存在且合法**的 id；不存在返回 `None`；存在但内容非法 → Err。
///
/// 非法内容不做「自动修复」：那会把「有人手工改过配置」这件事藏起来，
/// 而 device_id 一旦换掉，历史行就归属错了设备（不可逆）。
fn read_valid(path: &Path) -> Result<Option<String>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to read install id file: {error}")),
    };
    let trimmed = raw.trim().to_ascii_lowercase();
    if is_valid(&trimmed) {
        return Ok(Some(trimmed));
    }
    Err(format!(
        "install id file `{}` does not contain {INSTALL_ID_LEN} lowercase hex characters",
        path.display()
    ))
}

/// 12 位小写 hex 才算合法。
pub fn is_valid(value: &str) -> bool {
    value.len() == INSTALL_ID_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// 生成一个新的 id（`uuid v4` 的前 12 个 hex 字符）。
fn generate() -> Result<String, String> {
    let uuid = uuid::Uuid::new_v4().simple().to_string();
    uuid.get(..INSTALL_ID_LEN)
        .map(str::to_string)
        .ok_or_else(|| "failed to derive install id from uuid".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("timing-install-id-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn generates_once_then_reads_the_same_value() {
        let dir = temp_dir("stable");
        let first = ensure_install_id(&dir).expect("generates");
        assert!(is_valid(&first));
        let second = ensure_install_id(&dir).expect("reads back");
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_short_and_uppercase_free_garbage() {
        assert!(!is_valid(""));
        assert!(!is_valid("abc"));
        assert!(!is_valid("a1b2c3d4e5f"));
        assert!(!is_valid("a1b2c3d4e5fg"));
        assert!(!is_valid("A1B2C3D4E5F6"));
        assert!(is_valid("a1b2c3d4e5f6"));
    }

    #[test]
    fn existing_file_is_trimmed_and_lowercased() {
        let dir = temp_dir("trim");
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(path_of(&dir), "  A1B2C3D4E5F6\n").expect("write");
        assert_eq!(ensure_install_id(&dir).expect("reads"), "a1b2c3d4e5f6");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_fails_closed_instead_of_rotating_the_identity() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(path_of(&dir), "not-an-id").expect("write");
        assert!(ensure_install_id(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
