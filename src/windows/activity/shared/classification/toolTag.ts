/**
 * 「工具」标签判定（[0.12.6 · P0-9] 工具类应用不计入总量与分类分布）。
 * -----------------------------------------------------------------------------
 * 一句话：**这个应用是不是被用户（或 AI）标成了工具类**。
 *
 * ## 为什么是「一级标签」判定，而不是认一整份白名单
 *
 * 一级标签白名单的唯一真源在后端（`services/ai/prompt.rs` 的 `TAG_TOP_LEVELS`）。
 * 前端再抄一份全文，加第七类时必然漂移（两份里改一处、另一处静默失效）。所以前端
 * 这里**只认一个词**：一级是不是 `工具`。将来后端加 `工具/下载`、`工具/系统` 这类
 * 二级细分，本函数按前缀命中，过滤点一个字都不用改。
 *
 * ## 为什么用前缀而不是「按 / 切开取第一段」
 *
 * 两种写法等价（`工具/下载` 切第一段也是 `工具`），但前缀比较不需要分配数组：
 * 统计侧每个应用每帧都会被问一次（`dashboardReadModel` 在 `useMemo` 里跑）。真正
 * 需要切分的判据只有一条 —— 「`工作/工具` 不算工具类」，那是**等于**而不是**前缀**，
 * 前缀 `工具/` 天然把前者排除在外。
 *
 * ## 大小写与空白
 *
 * 标签落库前已过 `normalizeAppTags`（`normalizeTagPath`：去 `#`、合并多余斜杠）；
 * 这里仍然 `trim` 一次，因为 `AppClassification.getAppTags()` 在老数据上会回落成
 * **分类 token**（`utility` 这类英文 token），这条路进来的串没经过标签归一。
 * 中文没有大小写，`toLowerCase` 也就不必做 —— 真出现 `工具` 的英文同义词，那是
 * 「标签起得不对」，不是判定要兜的事。
 */

/** 一级标签里代表「工具」的那一个（与 Rust `TAG_TOP_LEVELS` 的第六项逐字一致） */
export const TOOL_TOP_LEVEL_TAG = "工具";

/** 二级细分的前缀（`工具/下载`）：只有**斜杠**才算细分，`工具链` 不是工具类 */
const TOOL_SUB_TAG_PREFIX = `${TOOL_TOP_LEVEL_TAG}/`;

/**
 * 任一标签路径等于 `工具`、或以 `工具/` 开头 → `true`。
 *
 * 空数组 / 全是空串 → `false`（未分类的应用照常计入统计，这是绝大多数应用的常态）。
 *
 * @param tags 应用（或事项）当前的标签路径，允许带首尾空白
 * @returns 是否属于工具类
 */
export function isToolTags(tags: readonly string[]): boolean {
  for (const tag of tags) {
    const path = tag.trim();
    if (path === TOOL_TOP_LEVEL_TAG) return true;
    if (path.startsWith(TOOL_SUB_TAG_PREFIX)) return true;
  }
  return false;
}
