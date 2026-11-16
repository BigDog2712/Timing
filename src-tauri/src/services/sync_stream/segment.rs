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
//! JSONL 不选数组：流式读写、断点续读（游标落在「读到的最大 op_id」而非字节偏移，
//! 抗部分写/重试）。

use crate::services::timer_ops::TimerOp;

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

/// 一批事件 → 一段 JSONL（一行一条 + 尾换行）。
pub fn encode_segment(ops: &[TimerOp]) -> String {
    let mut out = String::with_capacity(ops.len() * 220);
    for op in ops {
        /* TimerOp 是纯数据 struct（无 map / 无自定义 Serialize），to_string 不会失败。 */
        let line = serde_json::to_string(op).expect("TimerOp 序列化不会失败");
        out.push_str(&line);
        out.push('\n');
    }
    out
}

/// 一段 JSONL → 事件。空行跳过；非空行解析失败报错（带行号，方便定位坏分段）。
pub fn decode_segment(bytes: &[u8]) -> Result<Vec<TimerOp>, String> {
    let text = std::str::from_utf8(bytes).map_err(|err| format!("分段不是 UTF-8：{err}"))?;
    let mut ops = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let op: TimerOp = serde_json::from_str(line)
            .map_err(|err| format!("分段第 {} 行解析失败：{err}", index + 1))?;
        ops.push(op);
    }
    Ok(ops)
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
        assert_eq!(encoded.lines().count(), 2, "两条事件 = 两行");
        let decoded = decode_segment(encoded.as_bytes()).expect("round-trip 必须成功");
        assert_eq!(decoded, ops);
    }

    #[test]
    fn decode_skips_blank_lines_and_reports_bad_lines() {
        let good = encode_segment(&[op("p:a:1", 1, "a", "t:a:1", "i:a:1", 1)]);
        assert_eq!(decode_segment(b"\n\n").expect("全空 = 空事件").len(), 0);
        assert!(decode_segment(b"not-json\n").is_err(), "坏行必须报错");
        let _ = good;
    }
}
