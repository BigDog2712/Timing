//! 本机设备身份（`install_id`）的落盘读取。**零 `AppHandle`**：入参是目录。
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

use std::io::Write;
use std::path::{Path, PathBuf};

/// 身份文件名。名字是文档口径（用户能看到），**不许变**。
pub const INSTALL_ID_FILE: &str = "install_id.txt";

/// 身份的字符数（12 位小写 hex）。
const INSTALL_ID_LEN: usize = 12;

/// 完整路径。
pub fn path_of(config_dir: &Path) -> PathBuf {
    config_dir.join(INSTALL_ID_FILE)
}

/// 读出本机 `install_id`；文件不存在则生成一个并**原子落盘**。
///
/// 原子性：先写 `install_id.txt.tmp` 再 `rename`（同目录 rename 是原子的）。
/// 直接覆写会让「写到一半崩了」留下半截 id —— 那比没有文件更糟，因为下一次读会
/// 把它当成合法 id（校验只查长度与字符集）。
pub fn ensure_install_id(config_dir: &Path) -> Result<String, String> {
    let path = path_of(config_dir);
    if let Some(existing) = read_valid(&path)? {
        return Ok(existing);
    }
    let generated = generate()?;
    std::fs::create_dir_all(config_dir)
        .map_err(|error| format!("failed to create config dir `{}`: {error}", config_dir.display()))?;
    let temp = config_dir.join(format!("{INSTALL_ID_FILE}.tmp"));
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
    Ok(generated)
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
