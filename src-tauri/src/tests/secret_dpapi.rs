//! DPAPI 落盘的机器证据（任务书 §4.5「凭证」一节的人工项改成断言）。
//!
//! 人工项原文是「`data\webdav.bin` 写入后用记事本看是二进制」。这里直接断言：
//! ① 取回来与存进去逐字相同；② 文件内容**不含**明文（不是把密码套个壳写盘）；
//! ③ 删掉之后回到「没存过」。只在 Windows 编译，DPAPI 是系统能力，不需要任何桩。

use crate::infra::secret_dpapi;

fn temp_file() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|gap| gap.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("timing-webdav-secret-{}-{nanos}.bin", std::process::id()))
}

#[test]
fn round_trips_and_never_writes_plaintext() {
    let path = temp_file();
    let password = "应-用-密-码-app-pass-2024";

    assert_eq!(
        secret_dpapi::get(&path).expect("没存过应返回 Ok(None)"),
        None,
        "文件不存在是「没存过」，不是错误"
    );

    secret_dpapi::put(&path, password).expect("DPAPI 应能加密落盘");
    assert_eq!(
        secret_dpapi::get(&path).expect("刚写完应能读回"),
        Some(password.to_string())
    );

    let sealed = std::fs::read(&path).expect("密文应已落盘");
    assert_ne!(sealed, password.as_bytes(), "落盘的不能是明文");
    assert!(
        !sealed
            .windows(password.len())
            .any(|window| window == password.as_bytes()),
        "密文里不该出现明文密码的任何一段"
    );

    secret_dpapi::clear(&path).expect("清除应成功");
    assert_eq!(secret_dpapi::get(&path).expect("清掉后仍是「没存过」"), None);
    secret_dpapi::clear(&path).expect("再清一次也要成功（幂等）");
}
