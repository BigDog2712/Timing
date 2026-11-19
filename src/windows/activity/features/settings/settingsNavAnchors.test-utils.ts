/**
 * 设置页分组导航用例的**锚点几何**（共享真源）
 * -----------------------------------------------------------------------------
 * 为什么单独一个文件：`SettingsGroupNav*.test.tsx` 四个文件各自抄了一份
 * `ANCHOR_TOPS`（11 项、值完全相同）+ 一份 `CSS_ACTIVE_OFFSET`。抄四份的代价不是
 * 重复本身，而是**页面 IA 一调整，四处的锚点顺序全部静默失配**——`make()` 还按旧顺序
 * 搭 DOM、`getComputedStyle` 的 mock 还钉在旧的第一个锚点上，于是用例要么红一片、
 * 要么更糟：`readActiveOffset()` 只读第一个锚点，mock 钉错位置不会报错，只会让
 * 「判定线真的取自 CSS」那条用例变成**假绿**。
 *
 * ## 派生什么、不派生什么（这条边界很重要）
 *
 * - **派生**：锚点**顺序**（跟 `SETTINGS_ANCHOR_IDS` 走）、mock 的目标锚点（永远取第一个）。
 *   它们不是被测逻辑，IA 怎么调都不该让算法用例跟着改。
 * - **不派生**：**纵向阶梯本身**（`TOP_LADDER`，手写的独立常量）。它是"页面几何"的
 *   替身，里面的**非均匀间隔**（320 → 700 这一大跳）正是"组边界"的真实形状 ——
 *   均匀化成 0/80/160… 会让"跨组"和"组内"在几何上等价，把被测的那部分压平。
 * - 期望结论（"滚到某位置该亮哪一组"）也不许派生：那会变成用同一套算法算期望值，
 *   实现改错照样全绿。结论值留在各用例里手写。
 *
 * ## 为什么校验长度
 *
 * 锚点增删时阶梯必须同批调（否则 i 越界得 `undefined`，`top = NaN`，所有几何判定
 * 静默失效）。所以这里在模块加载时就 throw —— 宁可整个测试文件起不来，也不要
 * 一堆用例在 NaN 上跑出"看起来正常"的绿。
 */
import { SETTINGS_ANCHOR_IDS } from './settingsGroups';

/**
 * 锚点纵坐标阶梯（手写，非均匀）。
 *
 * 对应关系：第 i 个锚点（按 `SETTINGS_ANCHOR_IDS` 顺序）落在 `TOP_LADDER[i]`。
 * - `0 … 320` 段：四个锚点各隔 80，模拟"同一组内连续几张卡"；
 * - **`320 → 700` 这一大跳**：模拟组边界（中间还夹着别的高度），
 *   到底是"跨组"还是"组内"靠它才判得出来；
 * - `700` 之后又是 120/80/100/80/60/60：末段更密，给"到底规则"和 pin 容差留信号。
 */
const TOP_LADDER: readonly number[] = [0, 80, 160, 240, 320, 700, 820, 900, 1000, 1080, 1140, 1200];

if (TOP_LADDER.length !== SETTINGS_ANCHOR_IDS.length) {
  throw new Error(
    `[settingsNavAnchors] 锚点 ${SETTINGS_ANCHOR_IDS.length} 个，但纵向阶梯只有 ${TOP_LADDER.length} 项。` +
      '增删锚点时必须同批调整 TOP_LADDER —— 否则越界项 top 会是 NaN，几何判定全部静默失效。',
  );
}

/** 锚点 id → 文档绝对纵坐标（按 `SETTINGS_ANCHOR_IDS` 的顺序贴阶梯）。 */
export const ANCHOR_TOPS: Readonly<Record<string, number>> = Object.fromEntries(
  SETTINGS_ANCHOR_IDS.map((id, index) => [id, TOP_LADDER[index]]),
);

/** 夹具要按这个顺序搭 DOM（= 页面顺序 = 导航顺序）。 */
export const FIXTURE_ANCHOR_IDS: readonly string[] = SETTINGS_ANCHOR_IDS;

/** 第一个锚点：`readActiveOffset()` 只读它的 `scroll-margin-top`，mock 必须钉在它上面。 */
export const FIRST_ANCHOR_ID: string = SETTINGS_ANCHOR_IDS[0];

/** `settings-handles.css` 里锚点真实的 `scroll-margin-top`（判定线的偏移）。 */
export const CSS_ACTIVE_OFFSET = 18;
