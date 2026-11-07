//! Markdown 代码围栏状态机（CommonMark 4.5 的 fenced code block）。
//!
//! ## 为什么需要它
//!
//! 日记是**共享文件**：别的软件（还有主人自己）会往同一份文件里写内容，其中很容易
//! 出现代码围栏。围栏里的行按 Markdown 规范**不是结构行**——一行 `# 备注` 在 ``` 里
//! 只是内容，一行 `#### 事项计时` 在围栏里也只是**示例文本**。
//!
//! v0.11.18 及以前，`md_file` 只看行首 `#`：于是围栏里的 `# 备注` 会截断区块（少读
//! 一段 → 走导入 → 删除块把记录软删），围栏里的 `#### 事项计时` 会成为区块起点
//! （从那儿替换到下一个标题 → **改写别人写的内容**，不可逆）。
//!
//! ## 这个模块只做一件事
//!
//! 一次性给出「每一行在不在围栏内」的位图 `Fences`。**全流程只算这一次**，`find_heading`
//! / `section_end` / 两个计数函数全部吃同一份位图——各写一份状态机必然会在一处漂移，
//! 漂移后的症状是「标题找得到、区块结束位置算错」这种最难查的形状。
//!
//! ## 规则出处（逐条对应 CommonMark 4.5）
//!
//! - 开围栏：行首缩进 ≤3 空格 + 连续 ≥3 个 `` ` `` 或 `~`；
//! - 反引号围栏的 info 串里不许再出现反引号（否则 ```` ```a`b ```` 会被误判成开围栏）；
//! - 关闭必须**同字符**、长度 **≥ 开围栏长度**、且该行除围栏外只有空白；
//! - 缩进 ≥4 空格的行是缩进代码块，**不是围栏行**（开与关都只认 ≤3）；
//! - 到 EOF 仍未关闭 → 一直延伸到文档末尾（`unclosed_at` 记下起始行）。
//!
//! 「不 toggle」是硬要求：遇到任意三个反引号就翻转状态，会把外层 4 个反引号的围栏从
//! 中间切断，后半段全被当正文。

/// 围栏行允许的最大缩进（4 个及以上按缩进代码块处理）。
const MAX_FENCE_INDENT: usize = 3;

/// 围栏的最短长度（三个反引号 / 三个波浪号）。
const MIN_FENCE_LEN: usize = 3;

/// 每一行「在不在围栏内」的位图，外加未闭合围栏的起始行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fences {
    inside: Vec<bool>,
    unclosed_at: Option<usize>,
}

impl Fences {
    /// 这一行是不是围栏内（含围栏行本身）。
    ///
    /// 围栏行自己也记 `true`：它本来也不可能是标题，语义统一成「这一行不是结构行」。
    /// 越界一律 `false`——调用方用 `lines.len()` 当上界，越界只可能出现在空文件上。
    pub fn is_inside(&self, idx: usize) -> bool {
        self.inside.get(idx).copied().unwrap_or(false)
    }

    /// 到 EOF 都没闭合的那个围栏的开围栏行下标。
    pub fn unclosed_at(&self) -> Option<usize> {
        self.unclosed_at
    }
}

/// 一个围栏标记：字符种类 + 连续长度。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Marker {
    ch: char,
    len: usize,
}

/// 行首空格数（只数空格：Tab 按 CommonMark 是 4 列，落在这里等同于缩进代码块）。
fn indent_of(line: &str) -> usize {
    line.chars().take_while(|ch| *ch == ' ').count()
}

/// 这一行是不是开围栏；是则返回它的标记。
fn opener(line: &str) -> Option<Marker> {
    let indent = indent_of(line);
    if indent > MAX_FENCE_INDENT {
        return None;
    }
    /* 缩进全是空格（1 字节），所以按字符数切字节是安全的。 */
    let rest = &line[indent..];
    let ch = rest.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let len = rest.chars().take_while(|cur| *cur == ch).count();
    if len < MIN_FENCE_LEN {
        return None;
    }
    let info = &rest[len..];
    /* 反引号围栏的 info 串里出现反引号 → 这一行不是开围栏（波浪号围栏没有这条限制）。 */
    if ch == '`' && info.contains('`') {
        return None;
    }
    Some(Marker { ch, len })
}

/// 这一行能不能关闭 `marker` 指定的围栏。
fn closes(line: &str, marker: Marker) -> bool {
    let indent = indent_of(line);
    if indent > MAX_FENCE_INDENT {
        return false;
    }
    let rest = &line[indent..];
    let len = rest.chars().take_while(|cur| *cur == marker.ch).count();
    /* 同类更短的不关闭（``` 里的 `` ` `` / `` `` ``），同类更长的算关闭。 */
    if len < marker.len {
        return false;
    }
    /* 行内除围栏外只允许空白，否则 `` ```yaml `` 也能关掉 `` ``` `` 围栏。 */
    rest[len..].trim().is_empty()
}

/// 一遍扫描出整篇文档的围栏位图（O(n)）。
pub fn scan(lines: &[&str]) -> Fences {
    let mut inside = vec![false; lines.len()];
    /* 状态里带开围栏行下标：未闭合时要把它报出去，只有 `Marker` 是不够的。 */
    let mut state: Option<(Marker, usize)> = None;
    for (idx, line) in lines.iter().enumerate() {
        match state {
            None => {
                if let Some(marker) = opener(line) {
                    inside[idx] = true;
                    state = Some((marker, idx));
                }
            }
            Some((marker, _)) => {
                /* 围栏内的每一行都记 true —— 未闭合时这段一直延续到 EOF。 */
                inside[idx] = true;
                if closes(line, marker) {
                    state = None;
                }
            }
        }
    }
    Fences {
        inside,
        unclosed_at: state.map(|(_, at)| at),
    }
}
