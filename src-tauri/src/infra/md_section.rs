//! 区块判定：哪些行算标题、区块到哪儿结束、三档诊断（纯函数，无 IO）。
//!
//! 判定不碰文件，混在 `md_file` 里既撞 300 行门禁，又让「哪些行算标题」有两个出处；
//! 搬出来之后 `md_file` 只剩读写，**判定只有这一份**。
//!
//! ## 一次遍历是硬口径（`hit` 与 `exact_count` 看同一批行）
//!
//! 分两个函数各扫一遍，改完定位再改计数时第二遍必然漏掉围栏判断。所以 `scan_headings`
//! 一趟给出定位与两个计数，`diagnose` 只吃这份结果，三个对外函数只是它的薄包装。
//!
//! ## 三条口径（别「顺手统一」掉）
//!
//! 1. `Duplicate` **不阻断写入**：它不改变任何字节的归属——第 1 个标题照旧被替换成
//!    SQL 渲染、第 2 个逐字节不动。红字只说「你改的那一节永远不会被导入」。
//! 2. `Mismatched` 只在**完全找不到配置标题**时才判：用户在日记顶部写目录会抄一遍
//!    标题文本，见同名就报红会把同步永久堵死。
//! 3. 计数也只看围栏之外：围栏里抄一行标题是正常写法，按它报「2 个标题」用户改不掉。
//!
//! 不做汇总文件；区块外一个字节不动；不改用户写的标题；`write_section` 的调用点只有
//! `services/md_sync/mod.rs` 一处（PRD §3.3 的负向需求）。

use super::md_fence::Fences;

/// 标题 `#` 之前允许的最大缩进（CommonMark ATX 规则，4 个及以上按缩进代码块处理）。
const MAX_HEADING_INDENT: usize = 3;

/// 一趟扫描的结果：定位 + 两个计数 + 日志要用的行号（同一批行，只遍历一次）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HeadingScan {
    /// 第一个**围栏外**逐字相等标题 `(行下标, 等级)`。**洞 2 的落点。**
    pub hit: Option<(usize, usize)>,
    /// 围栏外逐字相同的标题条数（`Duplicate` 的判据）。
    pub exact_count: usize,
    /// 围栏外「文本相同、等级或缩进不同」的标题条数（`Mismatched` 的判据）。
    pub same_text_count: usize,
    /// 第 2 个逐字标题的行下标（`Duplicate` 日志用；行号不进用户文案）。
    pub extra_exact_line: Option<usize>,
    /// 第一个同文本异写法的 `(行下标, 等级)`（`Mismatched` 日志用）。
    pub first_same_text: Option<(usize, usize)>,
}

/// 读一个目标区块的结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SectionState {
    MissingFile,
    /// 文件存在，但没有目标标题行。
    MissingHeading { mtime_ms: i64 },
    /// 存在阻断级诊断（标题等级不一致 / 区块内代码围栏未收尾）：本轮不写、不导入。
    Blocked { mtime_ms: i64 },
    /// 标题下的内容（已去首尾空行）；形状与 v0.11.18 **逐字相同**，三处 pattern 不用改。
    Present { body: String, mtime_ms: i64 },
}

/// 一次读取的结果：状态 + 诊断（诊断可能为空；`Duplicate` 是非阻断的）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionRead {
    pub state: SectionState,
    pub issues: Vec<SectionIssue>,
}

/// 三档诊断。行号只进日志（用户文案里不许出现三位数字，见 06-边界）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SectionIssue {
    /// 围栏外出现了多于一个逐字相同的标题。
    Duplicate { count: usize, line: usize },
    /// 找不到配置里那个标题，但文件里有「文本相同、等级或缩进不同」的标题行。
    Mismatched { level: usize, line: usize },
    /// 我方区块内有一个到 EOF 都没收尾的代码围栏。
    UnclosedFence { line: usize },
}

impl SectionIssue {
    /// 是否阻断本轮读写。`Duplicate` 是唯一不阻断的一档：理由见模块注释第 1 条。
    pub fn blocks(&self) -> bool {
        !matches!(self, Self::Duplicate { .. })
    }

    /// 诊断所在行（0 基；日志里 +1 转成人类口径）。
    pub fn line(&self) -> usize {
        match self {
            Self::Duplicate { line, .. }
            | Self::Mismatched { line, .. }
            | Self::UnclosedFence { line } => *line,
        }
    }

    /// 用户可见文案（逐字，标点不许改）。`heading_text` 是配置标题去掉 `#` 与空白。
    pub fn text(&self, heading_text: &str) -> String {
        match self {
            Self::Duplicate { count, .. } => {
                format!("文件里有 {count} 个「{heading_text}」标题，请只留一个。")
            }
            Self::Mismatched { .. } => format!(
                "文件里的「{heading_text}」标题等级与设置不一致，请改文件或改设置。"
            ),
            Self::UnclosedFence { .. } => format!(
                "文件里的代码块没有收尾（缺少结尾的三个反引号），本轮没有读写「{heading_text}」这一节。"
            ),
        }
    }

    /// 写一行日志（行号只进日志，文案里不许有）。
    pub fn log(&self, kind_label: &str) {
        let kind = match self {
            Self::Duplicate { .. } => "duplicate",
            Self::Mismatched { .. } => "mismatched",
            Self::UnclosedFence { .. } => "unclosed-fence",
        };
        crate::log_warn!("md section: {kind_label} {kind} line={}", self.line() + 1);
    }
}

impl SectionRead {
    /// 报诊断日志，并把「这一轮还能不能写」的结论交回调用方。
    ///
    /// `Err` = 阻断级：本轮不写、不导入；`Ok` 里是非阻断提示（`Duplicate`），调用方显示
    /// 它但行为一个字不变。判定放在这里：`blocks()` 已是产品口径，再让调用方各自
    /// `find(|i| i.blocks())` 一遍就有了第二个出处。
    pub fn guard(&self, kind_label: &str, heading_text: &str) -> Result<Vec<String>, String> {
        self.issues.iter().for_each(|issue| issue.log(kind_label));
        if let Some(block) = self.issues.iter().find(|issue| issue.blocks()) {
            return Err(block.text(heading_text));
        }
        Ok(self
            .issues
            .iter()
            .map(|issue| issue.text(heading_text))
            .collect())
    }
}

/// 这一行的 ATX 标题等级；不是标题则 `None`。
///
/// 与 v0.11.18 唯一的差别：`#` 之前**最多 3 个空格**（4 个及以上按 CommonMark 是缩进
/// 代码块）。再把它当标题，就会出现「段首多按一个 Tab，区块被截断、记录被软删」。
pub fn heading_at(line: &str) -> Option<usize> {
    let indent = line.chars().take_while(|ch| *ch == ' ').count();
    if indent > MAX_HEADING_INDENT {
        return None;
    }
    /* 缩进全是空格（1 字节），按字符数切字节安全；`#` 也都是 1 字节。 */
    let rest = &line[indent..];
    let level = rest.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let after = &rest[level..];
    if after.is_empty() || after.starts_with(' ') || after.starts_with('\t') {
        Some(level)
    } else {
        None
    }
}

/// 标题文本：去掉 `#` 与首尾空白（文案里的 `{t}`）。
pub fn heading_text(heading: &str) -> String {
    heading.trim().trim_start_matches('#').trim().to_string()
}

/// 松口径的标题判定：任意缩进 + 任意等级，仍要求 `#` 后是空白。
fn loose_heading(line: &str) -> Option<usize> {
    let trimmed = line.trim_start_matches(' ');
    let level = trimmed.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let after = &trimmed[level..];
    if after.is_empty() || after.starts_with(' ') || after.starts_with('\t') {
        Some(level)
    } else {
        None
    }
}

/// 一行标题的文本（用于松口径比较）。
fn text_of(line: &str) -> String {
    line.trim_start_matches(' ')
        .trim_start_matches('#')
        .trim()
        .to_string()
}

/// 一趟扫描：给出定位、两个计数、诊断要用的行号。**围栏判断只在这一处**。
pub fn scan_headings(lines: &[&str], fences: &Fences, heading: &str) -> HeadingScan {
    let target = heading.trim();
    let text = heading_text(heading);
    let mut out = HeadingScan::default();
    for (idx, line) in lines.iter().enumerate() {
        /* 围栏里的行是内容，不是 Markdown 结构行：定位、两个计数一起跳过。 */
        if fences.is_inside(idx) {
            continue;
        }
        let level = heading_at(line);
        if line.trim() == target && level.is_some() {
            out.exact_count += 1;
            if out.hit.is_none() {
                out.hit = level.map(|value| (idx, value));
            } else if out.extra_exact_line.is_none() {
                out.extra_exact_line = Some(idx);
            }
            /* 逐字命中不可能同时是「异写法」，不必再走下面那条分支。 */
            continue;
        }
        if !text.is_empty() && text_of(line) == text {
            if let Some(value) = loose_heading(line) {
                out.same_text_count += 1;
                if out.first_same_text.is_none() {
                    out.first_same_text = Some((idx, value));
                }
            }
        }
    }
    out
}

/// 第一个逐字相等的标题行（薄包装，不另写循环）。
pub fn find_heading(lines: &[&str], fences: &Fences, heading: &str) -> Option<(usize, usize)> {
    scan_headings(lines, fences, heading).hit
}

/// 围栏外逐字相同的标题条数（薄包装，不另写循环）。
/* 生产路径只调 `scan_headings` 一趟。这两个薄包装是设计 §8.2 的判定出口，供 QA 的
   「只去掉 exact_count 的围栏过滤」变异自检与用例直接调，lib 的非测试构建里没人调。 */
#[allow(dead_code)]
pub fn count_exact(lines: &[&str], fences: &Fences, heading: &str) -> usize {
    scan_headings(lines, fences, heading).exact_count
}

/// 围栏外「文本相同、等级或缩进不同」的标题条数（薄包装，不另写循环）。
#[allow(dead_code)]
pub fn count_same_text(lines: &[&str], fences: &Fences, heading: &str) -> usize {
    scan_headings(lines, fences, heading).same_text_count
}

/// 区块结束行：下一个 level ≤ 当前 level 的围栏外标题；没有则到文件末尾（洞 1 的落点）。
/// 它找的是「下一个同级标题」，与找配置标题不是同一件事，故独立一趟。
pub fn section_end(lines: &[&str], fences: &Fences, head_idx: usize, level: usize) -> usize {
    lines
        .iter()
        .enumerate()
        .skip(head_idx.saturating_add(1))
        .find(|(idx, line)| {
            !fences.is_inside(*idx) && heading_at(line).is_some_and(|next| next <= level)
        })
        .map(|(idx, _)| idx)
        .unwrap_or(lines.len())
}

/// 三档诊断：只吃 `scan_headings` 的结果，不重扫行（重扫就有第二个出处）。
///
/// `end` 由调用方传进来（它已经算过一遍），本函数不重算。
pub fn diagnose(fences: &Fences, heading: &str, scan: &HeadingScan, end: usize) -> Vec<SectionIssue> {
    let mut issues = Vec::new();

    if scan.exact_count > 1 {
        /* 报第 2 个：第 1 个照旧被替换，多出来的那个才是用户要处理的对象。 */
        issues.push(SectionIssue::Duplicate {
            count: scan.exact_count,
            line: scan.extra_exact_line.unwrap_or(0),
        });
    }

    /* 只在完全找不到配置标题时才判；配置标题本身没有文本时不判（否则空配置会误报）。 */
    if scan.hit.is_none() && !heading_text(heading).is_empty() {
        if let Some((line, level)) = scan.first_same_text {
            issues.push(SectionIssue::Mismatched { level, line });
        }
    }

    /* 区块内未闭合 → 本轮不写不导入；未闭合在我方标题之前或区块之外都与本节无关
    （前者已被「围栏内不算标题」自动盖住，后者是别人的段落写坏了，不能停掉今天的同步）。 */
    if let (Some((head_idx, _)), Some(at)) = (scan.hit, fences.unclosed_at()) {
        if head_idx < at && at < end {
            issues.push(SectionIssue::UnclosedFence { line: at });
        }
    }

    issues
}
