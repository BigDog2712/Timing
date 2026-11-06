//! 便携落点的文件系统 IO（ADR-050 §3）：**可写性探测** + **回退证据标记**。
//!
//! ## 为什么单独成文件
//!
//! `app/portable_boot.rs` 只做「顺序与判据」（先探测还是先迁移、用户点了哪一项），
//! 本文件只做「碰磁盘」。两者混在一起时，想验「探测对不可写路径的判定」就得连带
//! 跑 `prepare()`——而它会写 `app_dir` 进程级 `OnceLock`，同进程内不可清除，会把
//! 并行跑的其它用例一起污染。
//!
//! ## 分层
//!
//! 属 `infra`（`infra → platform` 是允许方向）。用 `platform::app_dir::exe_dir()`
//! 只是为了把「程序当时在哪」写进标记文件——用户日后查「为什么回退了」要看它。

use std::path::Path;

/// 回退标记文件名（写在 `%APPDATA%\<identifier>\` 下）。
///
/// 名字与路径是 ADR-050 §3 的口径，**不许变**：文档里告诉用户「删掉这个文件即可
/// 恢复探测」，改名等于把恢复手段变成内部知识。
pub const OPTOUT_FILE: &str = "portable-optout.json";

/// 回退标记的 schema（字段只增不改）。
const OPTOUT_SCHEMA: u32 = 1;

/// 可写性探测：建目录 → 写 16 字节 → **回读比对** → 删。
///
/// 不用 `metadata().permissions().readonly()`：它只反映 `FILE_ATTRIBUTE_READONLY`
/// 位，与 ACL 无关——在 `C:\Program Files` 上返回 `false` 却写不进去（ADR-050 §3
/// Alternatives 表）。回读比对是为了拦住 Windows 的 VirtualStore 重定向：写入
/// 「成功」了，但内容落到了别处，`read` 回来与写进去的不一致。
///
/// 返回 `Err` 时字符串是**直接给用户看**的中文原因（不做 code 映射，也不进 IPC）。
pub fn probe(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建目录 {}：{e}", dir.display()))?;
    let probe = dir.join(".timing-write-probe.tmp");
    std::fs::write(&probe, b"timing-probe")
        .map_err(|e| format!("无法写入 {}：{e}", probe.display()))?;
    let back = std::fs::read(&probe).map_err(|e| format!("回读校验失败：{e}"))?;
    let _ = std::fs::remove_file(&probe);
    if back != b"timing-probe" {
        return Err("写入后的内容回读不一致（可能被系统重定向到 VirtualStore）".into());
    }
    Ok(())
}

/// 回退标记：用户已被告知的**书面证据**（对话框说过的话会消失，标记文件不会）。
///
/// 它同时是**恢复开关**：删除本文件 → 下次启动重新探测 `<exe>\data`。所以
/// `reason` 是稳定机读串而不是中文句子，`detail` 才是给人看的原始原因。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptOut {
    /// schema 版本（字段只增不改）
    pub schema: u32,
    /// 决策时刻（RFC 3339，本地时区）
    pub at: String,
    /// 当时的应用版本
    pub app_version: String,
    /// 稳定机读原因：`permission-denied` / `migrate-failed` / `exe-dir-unavailable`
    pub reason: String,
    /// 程序所在的目录（用户搬过文件夹时，这是「当时」的值）
    pub exe_dir: String,
    /// 最终选用的数据目录
    pub data_dir: String,
    /// 给人看的原始原因（系统错误原文 / 迁移失败的阶段）
    pub detail: String,
}

/// 读回退标记。坏文件当作**不存在**（重新探测，而不是永久卡在 AppData）：
/// 一个被编辑器改坏的 JSON 不该让用户永远失去便携模式。
pub fn read_optout(appdata: &Path) -> Option<OptOut> {
    let raw = std::fs::read_to_string(appdata.join(OPTOUT_FILE)).ok()?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()
}

/// 写回退标记。写失败**不阻断**启动——用户已经在用 AppData 了，报个 ERROR 就够。
///
/// 失败时不写半截文件：`serde_json::to_string_pretty` 先在内存里序列化完再落盘。
pub fn write_optout(appdata: &Path, reason: &str, detail: &str) {
    let record = OptOut {
        schema: OPTOUT_SCHEMA,
        at: chrono::Local::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        reason: reason.to_string(),
        exe_dir: crate::platform::app_dir::exe_dir()
            .map(|dir| dir.display().to_string())
            .unwrap_or_default(),
        data_dir: appdata.display().to_string(),
        detail: detail.to_string(),
    };
    if let Err(err) = std::fs::create_dir_all(appdata) {
        crate::log_error!("portable: 无法创建回退目录 {}：{err}", appdata.display());
        return;
    }
    match serde_json::to_string_pretty(&record) {
        Ok(text) => {
            if let Err(err) = std::fs::write(appdata.join(OPTOUT_FILE), text) {
                crate::log_error!("portable: 写 {OPTOUT_FILE} 失败：{err}");
            }
        }
        Err(err) => crate::log_error!("portable: optout 序列化失败：{err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例独占目录：同进程并行跑时共用 `process::id()` 会互相删目录。
    fn temp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "timing-probe-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    #[test]
    fn probe_rejects_path_under_a_file() {
        /* 用「父路径是一个文件」构造必然失败：比 `set_readonly` 更稳定
        （Windows 上对目录设只读位并不阻止 ACL 允许的写入）。 */
        let base = temp("reject");
        let file = base.join("not-a-dir");
        std::fs::write(&file, b"x").expect("写文件");
        let err = probe(&file.join("data")).expect_err("文件下面建不了目录");
        assert!(err.contains("无法创建目录"), "{err}");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn probe_accepts_writable_dir() {
        let dir = temp("ok").join("data");
        probe(&dir).expect("临时目录应可写");
        assert!(
            !dir.join(".timing-write-probe.tmp").exists(),
            "探测文件要删掉"
        );
        std::fs::remove_dir_all(dir.parent().expect("有父目录")).ok();
    }

    #[test]
    fn optout_roundtrip_and_bad_file_is_absent() {
        let appdata = temp("optout");
        write_optout(
            &appdata,
            "permission-denied",
            "无法创建目录 Z:\\data：拒绝访问",
        );
        let back = read_optout(&appdata).expect("刚写的标记读得回来");
        assert_eq!(back.reason, "permission-denied");
        assert_eq!(back.schema, OPTOUT_SCHEMA);
        assert_eq!(back.data_dir, appdata.display().to_string());
        /* 坏文件（用户手改 / 半截写入）当作不存在，重新探测。 */
        std::fs::write(appdata.join(OPTOUT_FILE), b"{ not json").expect("写坏标记");
        assert!(
            read_optout(&appdata).is_none(),
            "坏标记不该永久卡住便携模式"
        );
        std::fs::remove_dir_all(&appdata).ok();
    }
}
