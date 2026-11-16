//! 事件分段文件：命名 + JSONL 读写（T02 实现体，纯函数为主）。
//!
//! 分段是**不可变文件** `sync/events/<device_id>/<seq>.jsonl`（架构设计 §1.2）：
//! 每轮把本机新增事件写进一个「只写一次、永不修改」的新文件。命名、JSONL 读写、
//! 游标推进都是纯函数，放这里可单测，也让 [`super::repository`] 与编排层引用同一份
//! 形状而不发明第二套。
//!
//! ## JSONL 不是数组
//!
//! 一行一条 [`TimerOp`] 的 `serde_json` 序列化，字段序即 struct 序，kind 用
//! `snake_case`（与 [`TimerOp`] 的 `#[serde(rename_all="snake_case")]` 一致）。选
//! JSONL 不选数组：流式读写、断点续读（游标落在「读到的最大 op_id」而非字节偏移）。
//!
//! ## 为什么末尾必须有一行完整性标记（2026-11-16，评审 P1-1）
//!
//! 「读到一份**有效 JSONL 前缀**」和「读到完整分段」在字节层面完全同形：一条 op 是
//! 一整行 JSON，写到第 3 条时进程被杀 / 网盘只传了前半段，前 2 行依然是合法 JSON。
//! 只按行解析的话这份残段会被当成「这个分段只有 2 条事件」而**成功应用并推进游标**，
//! 剩下的 2 条从此不会再被拉取 —— 静默丢数据，两端时长永久对不上。
//!
//! 所以段格式的**最后一行**是一份自描述尾标：
//!
//! ```text
//! {"integrity":{"count":2,"sha256":"<前两行全部字节的 sha256>"}}
//! ```
//!
//! [`decode_segment`] 的三条硬规则：**没有尾标 → 拒绝**（残段 / 空文件）、
//! **sha256 对不上 → 拒绝**（被截断或改写）、**count 与实际行数不符 → 拒绝**。
//! 拒绝的后果是游标不前进（`pull` 那边 `break`），下一轮重试 —— 这正是
//! 「永不自动丢弃」要求的行为。

use sha2::{Digest, Sha256};

use crate::services::timer_ops::TimerOp;

/// 完整性尾标里 `integrity` 的前缀：用来把尾标行与事件行区分开。
const INTEGRITY_KEY: &str = "{\"integrity\":";

/// 尾标解析形状（只读这两个字段，别的都忽略）。
#[derive(serde::Deserialize)]
struct IntegrityLine {
    integrity: Integrity,
}

#[derive(serde::Deserialize)]
struct Integrity {
    count: usize,
    sha256: String,
}

/// 分段序号宽度：`00000001`…（8 位零填充，本机单调递增）。
pub const SEGMENT_SEQ_WIDTH: usize = 8;

/// 一个事件分段的稳定标识：属于哪台设备、第几段。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SegmentId {
    /// 产生这批事件的设备 id（12 位小写 hex）。
    pub device_id: String,
    /// 分段序号（8 位零填充的**源数值**，落盘时才补零）。
    pub seq: u32,
}

/// 一个事件分段文件（只写一次、永不修改）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentFile {
    /// 分段标识。
    pub id: SegmentId,
    /// 远端相对路径 `sync/events/<device_id>/<seq>.jsonl`。
    pub path: String,
}

/// 某台设备的远端分段目录：`sync/events/<device_id>`。
pub fn segment_dir(device_id: &str) -> String {
    format!("sync/events/{device_id}")
}

/// 一个分段的远端相对路径：`sync/events/<device_id>/<seq>.jsonl`。
pub fn segment_path(device_id: &str, seq: u32) -> String {
    format!("sync/events/{device_id}/{}.jsonl", format_seq(seq))
}

/// `seq` 的 8 位零填充文件名段（`00000001`…）。
pub fn format_seq(seq: u32) -> String {
    format!("{seq:0width$}", width = SEGMENT_SEQ_WIDTH)
}

/// 从分段文件名反解序号：`"00000001.jsonl"` → `Some(1)`；名字形状不对返回 `None`。
pub fn parse_seq(file_name: &str) -> Option<u32> {
    let stem = file_name.strip_suffix(".jsonl")?;
    if stem.len() != SEGMENT_SEQ_WIDTH || !stem.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    stem.parse::<u32>().ok()
}

/// 一批事件 → 一段 JSONL（一行一条 + 尾换行 + 完整性尾标）。
///
/// 尾标盖的是**它前面全部字节**的 sha256，所以「少了一行」「多了一行」「某一行被改过」
/// 都会在 [`decode_segment`] 那里失败，而不是被当成一份更小的分段接受。
pub fn encode_segment(ops: &[TimerOp]) -> String {
    let mut out = String::with_capacity(ops.len() * 220 + 96);
    for op in ops {
        /* TimerOp 是纯数据 struct（无 map / 无自定义 Serialize），to_string 不会失败。 */
        let line = serde_json::to_string(op).expect("TimerOp 序列化不会失败");
        out.push_str(&line);
        out.push('\n');
    }
    let digest = hex(&Sha256::digest(out.as_bytes()));
    out.push_str(&format!(
        "{INTEGRITY_KEY}{{\"count\":{},\"sha256\":\"{digest}\"}}}}\n",
        ops.len()
    ));
    out
}

/// 一段 JSONL → 事件。**先验尾标，再解析事件**；空行跳过、非空行解析失败报错（带行号）。
///
/// 校验顺序是刻意的：尾标不过就直接返回，不必去解析一份已经知道不完整的正文
/// （那样报出来的会是「第 3 行 JSON 语法错」，而真正的原因是「这份文件没写完」）。
pub fn decode_segment(bytes: &[u8]) -> Result<Vec<TimerOp>, String> {
    let text = std::str::from_utf8(bytes).map_err(|err| format!("分段不是 UTF-8：{err}"))?;
    let (body, marker) = split_trailer(text)?;

    let declared = parse_trailer(marker)?;
    let actual_hash = hex(&Sha256::digest(body.as_bytes()));
    if actual_hash != declared.sha256 {
        return Err(format!(
            "分段完整性校验失败（尾标记 {} 条 / sha256 {}，实际内容 sha256 {actual_hash}）：\
             这份文件被截断或改写，拒绝应用",
            declared.count, declared.sha256
        ));
    }

    let mut ops = Vec::new();
    for (index, line) in body.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let op: TimerOp = serde_json::from_str(line)
            .map_err(|err| format!("分段第 {} 行解析失败：{err}", index + 1))?;
        ops.push(op);
    }
    /* 尾标与正文一致之后这仍可能不等：只有「尾标是别人补的」或编码侧改了逻辑才会这样。
       留着它当第二道闸门，比事后查「为什么会少一条」便宜得多。 */
    if ops.len() != declared.count {
        return Err(format!(
            "分段尾标写 {} 条、实际解析出 {} 条：格式不一致，拒绝应用",
            declared.count,
            ops.len()
        ));
    }
    Ok(ops)
}

/// 把文本切成「正文」与「尾标」两段：正文含它最后一行的换行（与 [`encode_segment`] 一致）。
fn split_trailer(text: &str) -> Result<(&str, &str), String> {
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return Err("分段是空的（0 字节或只有空白）：写入没有完成，拒绝应用".to_string());
    }
    let marker_start = trimmed.rfind('\n').map_or(0, |at| at + 1);
    let (body, marker) = trimmed.split_at(marker_start);
    if !marker.trim_start().starts_with(INTEGRITY_KEY) {
        return Err(format!(
            "分段末尾缺少完整性标记（最后一行是 {:.60}）：这份文件没写完，拒绝应用",
            marker.trim()
        ));
    }
    Ok((body, marker.trim()))
}

/// 尾标行 → `count` / `sha256`。形状不对报错，**不回退成「当它没有尾标」**。
fn parse_trailer(marker: &str) -> Result<Integrity, String> {
    let line: IntegrityLine = serde_json::from_str(marker)
        .map_err(|err| format!("分段完整性标记解析失败：{err}"))?;
    if line.integrity.sha256.len() != 64
        || !line.integrity.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("分段完整性标记里的 sha256 不是 64 位十六进制".to_string());
    }
    Ok(line.integrity)
}

/// 字节 → 小写十六进制（不引 `hex` crate，这点逻辑还不够一个依赖）。
fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::timer_ops::TimerOpKind;

    fn op(uid: &str, op_id: i64, device: &str, session: &str, item: &str, at_ms: i64) -> TimerOp {
        TimerOp {
            uid: uid.to_string(),
            op_id,
            device_id: device.to_string(),
            session_uid: session.to_string(),
            item_uid: item.to_string(),
            kind: TimerOpKind::Start,
            at_ms,
            payload: None,
        }
    }

    #[test]
    fn seq_is_zero_padded_to_eight_digits() {
        assert_eq!(format_seq(1), "00000001");
        assert_eq!(format_seq(12345678), "12345678");
        assert_eq!(parse_seq("00000001.jsonl"), Some(1));
        assert_eq!(parse_seq("00123456.jsonl"), Some(123456));
        assert_eq!(parse_seq("1.jsonl"), None, "位数不对");
        assert_eq!(parse_seq("00000001.txt"), None, "后缀不对");
    }

    #[test]
    fn path_is_relative_and_stable() {
        assert_eq!(
            segment_path("aaaaaaaaaaaa", 1),
            "sync/events/aaaaaaaaaaaa/00000001.jsonl"
        );
        assert_eq!(segment_dir("aaaaaaaaaaaa"), "sync/events/aaaaaaaaaaaa");
    }

    #[test]
    fn jsonl_roundtrips_with_snake_case_kind() {
        let ops = vec![
            op("p:aaaaaaaaaaaa:1", 1, "aaaaaaaaaaaa", "t:aaaaaaaaaaaa:1", "i:aaaaaaaaaaaa:1", 1000),
            op("p:aaaaaaaaaaaa:2", 2, "aaaaaaaaaaaa", "t:aaaaaaaaaaaa:1", "i:aaaaaaaaaaaa:1", 2000),
        ];
        let encoded = encode_segment(&ops);
        assert!(encoded.contains("\"kind\":\"start\""));
        /* 2 条事件 + 1 行尾标。原来的断言是 `lines().count() == 2`，把「尾标」这件事
           钉进计数里才能防住「有人悄悄把尾标删了、单测还绿」。 */
        assert_eq!(encoded.lines().count(), 3, "两条事件 + 一行完整性尾标");
        assert!(encoded.trim_end().ends_with('}'));
        assert!(encoded.contains("\"integrity\":{\"count\":2,"), "尾标要自报条数");
        let decoded = decode_segment(encoded.as_bytes()).expect("round-trip 必须成功");
        assert_eq!(decoded, ops);
    }

    /// 尾标的三条硬规则：空文件 / 缺尾标（= 写到一半）/ 尾标不过一律拒绝。
    #[test]
    fn incomplete_segments_are_rejected() {
        let ops = vec![
            op("p:a:1", 1, "a", "t:a:1", "i:a:1", 1),
            op("p:a:2", 2, "a", "t:a:1", "i:a:1", 2),
        ];
        let good = encode_segment(&ops);

        assert!(decode_segment(b"").is_err(), "空文件必须拒绝");
        assert!(decode_segment(b"\n\n").is_err(), "只有空白也必须拒绝");

        /* 截断在尾标之前 —— 这是评审说的「有效 JSONL 前缀」：前 1 行本身完全合法。 */
        let one_line = &good[..good.find('\n').map(|at| at + 1).unwrap()];
        let err = decode_segment(one_line.as_bytes()).expect_err("没有尾标就是残段");
        assert!(err.contains("缺少完整性标记"), "报错要说清是「没写完」而不是「语法错」：{err}");

        /* 尾标还在、正文被改：sha256 对不上。 */
        let tampered = good.replacen("\"at_ms\":1", "\"at_ms\":9", 1);
        let err = decode_segment(tampered.as_bytes()).expect_err("改过正文必须拒绝");
        assert!(err.contains("完整性校验失败"), "{err}");

        /* 尾标自报的条数对不上实际：第二道闸门。 */
        let lying = good.replacen("\"count\":2", "\"count\":3", 1);
        let err = decode_segment(lying.as_bytes()).expect_err("条数不符必须拒绝");
        assert!(
            err.contains("完整性校验失败") || err.contains("实际解析出"),
            "{err}"
        );

        assert!(decode_segment(b"<xml/>\n").is_err(), "非 JSON 行仍按行号报错");
    }
}
