//! Windows 侧凭据存储：DPAPI（`CryptProtectData` / `CryptUnprotectData`）。
//!
//! ## 为什么是 DPAPI
//!
//! 它绑定**当前 Windows 账户**：密文被拷到别的机器、或换个用户打开，都解不开。密钥由系统
//! 代管，我们既不生成也不保管——这是"存一个必须能取回的密码"最省事的正确做法。
//! `CRYPTPROTECT_UI_FORBIDDEN` 是硬要求：Timing 是后台同步的，绝不允许弹出一个
//! 「请输入 PIN」的系统框卡住一轮同步。
//!
//! ## 落点与原子写
//!
//! 密文写 `<数据根>\webdav.bin`，先写 `.bin.tmp` 再 `rename` 覆盖：断电只会留下一个可丢弃
//! 的临时文件，永远不会读到半个密文（半个密文 = 密码永久读不出来，用户只能重填）。
//!
//! ## 失败口径
//!
//! 一切失败折成同一句 `MISSING`（"系统凭据不可用"），Win32 错误码只进 DEBUG 日志。
//! **绝不回落明文**：宁可让云端那轮跳过 PUT，也不能把应用密码写进明文文件。

use std::ffi::c_void;
use std::path::Path;

use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use crate::infra::secret::MISSING;

/// `Ok(None)` = 文件不存在（没存过）；`Err` = 存过但解不开。
pub fn get(path: &Path) -> Result<Option<String>, String> {
    let sealed = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(MISSING.to_string()),
    };
    let plain = unprotect(&sealed)?;
    /* 解出来的不是 UTF-8，只可能是换了账户或密文被截断——都算"读不出来"，
    不猜编码：猜出来的乱码会被当成密码再去试一次，只会得到一串 401。 */
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| MISSING.to_string())
}

pub fn put(path: &Path, value: &str) -> Result<(), String> {
    let sealed = protect(value.as_bytes())?;
    write_atomic(path, &sealed)
}

/// 删不存在的文件算成功：界面上连按两次「清除」不该弹错。
pub fn clear(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(MISSING.to_string()),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| MISSING.to_string())?;
    }
    let tmp = path.with_extension("bin.tmp");
    std::fs::write(&tmp, bytes).map_err(|_| MISSING.to_string())?;
    if std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return Err(MISSING.to_string());
    }
    Ok(())
}

fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(plain);
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(win32_failure("protect"));
    }
    Ok(take(output))
}

fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(sealed);
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(win32_failure("unprotect"));
    }
    Ok(take(output))
}

/// 用户只看一句话；错误码落 DEBUG 日志（排障时要，界面上是噪音）。
fn win32_failure(what: &str) -> String {
    let code = unsafe { GetLastError() };
    crate::log_debug!("dpapi {what} failed: err={code}");
    MISSING.to_string()
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    }
}

/// DPAPI 用 `LocalAlloc` 分配输出缓冲，必须由我们 `LocalFree`；
/// 先拷成 `Vec` 再释放，任何提前返回都不至于漏掉这块内存。
fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    let _ = unsafe { LocalFree(output.pbData as *mut c_void) };
    bytes
}
