//! 计时操作日志（`timer_ops`）与折叠。
//!
//! ## 为什么是事件流而不是状态行
//!
//! 要求是「PC 9:40 发起 → 手机同步后进入计时中 → 手机 9:50 结束 → PC 同步后结束」。
//! 若同步传**状态**，手机就得改 PC 那一行，直接推翻 P4 的支点「一行永远只有属主写」；
//! 一旦允许非属主写，冲突解决与服务端 seq 全部回归，整个「服务端可以砍掉」的结论作废。
//!
//! 传**操作**则不需要：手机的 `stop` 是一条**属于手机**的新行，PC 的 `start` 一个字节
//! 都没被动过。两端各自 `fold` 同一批事件，得到同一个会话状态。
//!
//! ## 三条硬约定（都有用例钉住）
//!
//! 1. **排序键是 `(at_ms, device_id, op_id)`**，不是本地时钟单排。时钟回拨会让
//!    `at_ms` 乱序，同毫秒并列时若没有确定性 tiebreak，两端会 fold 出不同结果 ——
//!    而这类不一致只在两端都同步过完整历史后才显形，最难查。
//! 2. **`stop` 之后再来 `resume` 一律忽略**。对端不知道已结束还会操作，复活会话会
//!    造出一段无主时间（块在跑、用户已经走了）。
//! 3. **同一会话出现两次 `stop` 取排序键最小的那条**。两端同时结束时它是收敛的：
//!    先到的那条定局，后到的只是重复信息。

use serde::{Deserialize, Serialize};

/// 一次操作。与 `timer_ops` 表逐列对应（`uid` / `created_at` 在折叠里用不到）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimerOp {
    /// `p:<device>:<id>`，事件身份，永不变。
    pub uid: String,
    /// 自增主键，兼作排序 tiebreak 的第二位。
    pub op_id: i64,
    pub device_id: String,
    /// 被操作的会话（= `start` 造出来的那个 `time_records.uid`）。
    pub session_uid: String,
    pub item_uid: String,
    pub kind: TimerOpKind,
    /// **语义时刻**：用户按下按钮那一刻，不是写入库的时刻。
    /// 「手机 9:50 结束、PC 9:55 才同步」时，PC 收到的 `ended_at` 必须是 9:50 —— 全靠这一列。
    pub at_ms: i64,
    pub payload: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerOpKind {
    Start,
    Pause,
    Resume,
    Stop,
    /// 改起点（用户手工修正）。`payload` 为 `{"started_at": <ms>}`。
    Adjust,
    /// 作废整个会话：折叠后不产出块，但事件本身留在流里。
    Drop,
}

impl TimerOpKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Stop => "stop",
            Self::Adjust => "adjust",
            Self::Drop => "drop",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "start" => Some(Self::Start),
            "pause" => Some(Self::Pause),
            "resume" => Some(Self::Resume),
            "stop" => Some(Self::Stop),
            "adjust" => Some(Self::Adjust),
            "drop" => Some(Self::Drop),
            _ => None,
        }
    }
}

/// 折叠出来的块。`dropped` 为真时调用方**不要**把它投影进 `focus_blocks`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FoldedBlock {
    pub session_uid: String,
    pub item_uid: String,
    /// 发起设备（`start` 的属主），不是「本机」。共享会话后 `time_records.device_id`
    /// 就是这个含义 —— 见 `uq_records_open_per_device` 的语义说明。
    pub device_id: String,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    /// 已结算的时长（不含正在跑的这一段）。
    pub accumulated_ms: i64,
    /// 正在跑时非空：从这一刻起累计。
    pub running_since_ms: Option<i64>,
    pub dropped: bool,
}

impl FoldedBlock {
    /// 落 `time_records.accumulated_sec` 用的整秒值（向下取整）。
    pub fn accumulated_sec(&self) -> i64 {
        self.accumulated_ms / 1000
    }

    /// 这条块还在跑（没有 `stop`）。
    ///
    /// `#[cfg(test)]`：生产代码判「进行中」一律看 `ended_at_ms.is_none()`（同一个表达式），
    /// 多一个 public 方法就多一处「两处口径各自演化」的机会；而用例里 `!folded.is_running()`
    /// 比 `assert!(folded.ended_at_ms.is_none())` 更直白，值得留。
    #[cfg(test)]
    pub fn is_running(&self) -> bool {
        self.running_since_ms.is_some()
    }

    /// 整段的墙钟跨度（含暂停）。`None` 表示进行中。理由同 [`Self::is_running`]。
    #[cfg(test)]
    pub fn wall_clock_ms(&self) -> Option<i64> {
        self.ended_at_ms
            .map(|ended| (ended - self.started_at_ms).max(0))
    }
}

/// 被忽略的事件及原因。用例要能**点名**哪一条被忽略，所以不能只返回计数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ignored {
    pub uid: String,
    pub reason: IgnoreReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreReason {
    /// 该会话还没出现过 `start`（事件缺失，或拉到了不完整的分片）。
    NoStart,
    /// 会话已 `stop`，之后的操作全部无效。
    AfterStop,
    /// 重复的 `start`（同一会话只开一次）。
    DuplicateStart,
    /// `adjust` 的 payload 解析不出来。
    MalformedAdjust,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldResult {
    pub block: Option<FoldedBlock>,
    pub ignored: Vec<Ignored>,
}

/// 折叠一个会话的全部事件。
///
/// `ops` 允许乱序（同步拉到什么顺序都可能），函数内部先按排序键稳定排序。
/// 空输入返回 `block: None` 且 `ignored` 为空 —— 那是「该会话还没有事件」，不是错误。
pub fn fold_session(ops: &[TimerOp]) -> FoldResult {
    let mut ignored: Vec<Ignored> = Vec::new();
    if ops.is_empty() {
        return FoldResult {
            block: None,
            ignored,
        };
    }

    let mut ordered: Vec<&TimerOp> = ops.iter().collect();
    ordered.sort_by(compare_events);

    /* ① 先把 `start` 摘出来：它必须最先应用，否则后面的时间戳无处安放。
       同一会话若有多条 start（重复开始），取排序键最小的那条，其余算重复。 */
    let Some(start_index) = ordered
        .iter()
        .position(|op| op.kind == TimerOpKind::Start)
    else {
        /* 分片不完整：只拉到了 stop/pause。忽略而不是造一条零长块 —— 造出来的块
           会进时间轴，看起来像「用户在一个瞬间完成了一次计时」。 */
        let ignored = ordered
            .iter()
            .map(|op| Ignored {
                uid: op.uid.clone(),
                reason: IgnoreReason::NoStart,
            })
            .collect();
        return FoldResult {
            block: None,
            ignored,
        };
    };
    let start = ordered.remove(start_index);
    let mut block = FoldedBlock {
        session_uid: start.session_uid.clone(),
        item_uid: start.item_uid.clone(),
        device_id: start.device_id.clone(),
        started_at_ms: start.at_ms,
        ended_at_ms: None,
        accumulated_ms: 0,
        running_since_ms: Some(start.at_ms),
        dropped: false,
    };

    /* ② 单调钳制：每条事件的生效时刻不得早于「上一条已应用事件」。
       没有它，时钟回拨会造出负区间 —— 更糟的是 `stop` 的 `at_ms` 落在 `start` 之前时，
       排序后它先于 `start` 出现、被判成「没有 start 的事件」而忽略，会话永远结束不了。
       钳制把这类事件折叠到同一刻：时长取 0，会话照常收口。 */
    let mut last_applied = block.started_at_ms;

    for op in ordered {
        if op.kind == TimerOpKind::Start {
            ignored.push(Ignored {
                uid: op.uid.clone(),
                reason: IgnoreReason::DuplicateStart,
            });
            continue;
        }
        if block.ended_at_ms.is_some() {
            /* 已结束：不再接受任何事件，尤其是 resume（复活 = 制造无主时间）。 */
            ignored.push(Ignored {
                uid: op.uid.clone(),
                reason: IgnoreReason::AfterStop,
            });
            continue;
        }

        let at_ms = op.at_ms.max(last_applied);
        last_applied = at_ms;

        match op.kind {
            /* 重复的 start 已在循环开头 continue，走不到这里；留一个空分支而不是
               `unreachable!()`：release 是 panic=abort，可达路径上的 panic 会整进程退出。 */
            TimerOpKind::Start => {}
            TimerOpKind::Pause => {
                /* 累加「正在跑的这一段」并停表。已经是暂停态时重复 pause 是无操作，
                   不要把它算成一次结算（否则同一段会被累加两次）。 */
                if let Some(since) = block.running_since_ms.take() {
                    block.accumulated_ms += (at_ms - since).max(0);
                }
            }
            TimerOpKind::Resume => {
                if block.running_since_ms.is_none() {
                    block.running_since_ms = Some(at_ms);
                }
            }
            TimerOpKind::Stop => {
                if let Some(since) = block.running_since_ms.take() {
                    block.accumulated_ms += (at_ms - since).max(0);
                }
                block.ended_at_ms = Some(at_ms);
            }
            TimerOpKind::Adjust => match parse_adjust_started_at(op.payload.as_deref()) {
                Some(started_at) if started_at <= block.ended_at_ms.unwrap_or(i64::MAX) => {
                    block.started_at_ms = started_at;
                    last_applied = last_applied.max(started_at);
                }
                _ => ignored.push(Ignored {
                    uid: op.uid.clone(),
                    reason: IgnoreReason::MalformedAdjust,
                }),
            },
            TimerOpKind::Drop => block.dropped = true,
        }
    }

    FoldResult {
        block: Some(block),
        ignored,
    }
}

/// 事件的确定性全序：`(at_ms, device_id, op_id)`。
///
/// 三段缺一不可：只按 `op_id` 排跨设备不可比（两台机器的自增序列互不相干）；
/// 只按 `at_ms` 排则同毫秒并列时顺序取决于输入顺序，两端会 fold 出不同结果 ——
/// 而这种不一致只在两端都同步过完整历史后才显形。
fn compare_events(left: &&TimerOp, right: &&TimerOp) -> std::cmp::Ordering {
    left.at_ms
        .cmp(&right.at_ms)
        .then_with(|| left.device_id.cmp(&right.device_id))
        .then_with(|| left.op_id.cmp(&right.op_id))
}

/// `{"started_at": 1700000000000}` → `1700000000000`。
///
/// 解析失败一律返回 `None` 而不是兜底成 0：把起点折成 1970 会造出一条横跨半个世纪的块，
/// 而那条块会污染所在那一整天的读模型 —— 宁可忽略这条 adjust 并上报。
fn parse_adjust_started_at(payload: Option<&str>) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_str(payload?).ok()?;
    value.get("started_at")?.as_i64()
}

#[cfg(test)]
mod tests;
