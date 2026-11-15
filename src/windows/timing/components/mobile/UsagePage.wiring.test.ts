/**
 * Timing — 统计页的源码级判据（[0.13.1] 起，[0.13.2] 扩到多文件）
 * -----------------------------------------------------------------------------
 * 第一组的存在理由是一个**已经发出去的静默缺陷**：0.13.0 的 `UsagePage` 写了 22 个
 * `m-usage*` 类名，全仓 CSS 一条规则都没有，页面是裸 HTML 而测试全绿
 * （组件测试不读样式表）。所以「用到的每个类名必须有规则」是这一页的常设判据。
 * 这一轮页面拆成 10 个文件、样式拆成 2 个，判据必须跟着跨文件扫 ——
 * 只扫 `UsagePage.tsx` + `usage.css` 会让新组件的样式失联而不报错。
 *
 * 其余几组钉接线：未读到的那天不许画成零柱、合计与条长同一份数、单日失败不翻红、
 * 排行能进详情、详情能返回、洞察句只在一处渲染。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 去注释之后再比：解释性注释里会正当地出现类名，不去掉就是假红。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PAGE = code('./UsagePage.tsx');
const DAY = code('./UsageDayView.tsx');
const WEEK = code('./UsageWeekView.tsx');
const TREND = code('./UsageTrend.tsx');
const OVERVIEW = code('./UsageOverview.tsx');
const RANKING = code('./UsageRanking.tsx');
const DETAIL = code('./UsageAppDetail.tsx');
const GATE = code('./UsageGate.tsx');
const SWITCH = code('./UsageRangeSwitch.tsx');
const INSIGHTS = code('./UsageInsightList.tsx');
const ICON = code('./UsageAppIcon.tsx');
const CSS = code('../../styles/mobile/usage.css');
const CSS2 = code('../../styles/mobile/usage-overview.css');
const CSS3 = code('../../styles/mobile/usage-cards.css');
const ENTRY = code('../../entry/main.tsx');
const RECORDS = code('./RecordsPage.tsx');
const SHELL = code('./MobileShell.tsx');
const UI_STORE = code('../../stores/mobileUiStore.ts');

const COMPONENTS = [
  PAGE,
  DAY,
  WEEK,
  TREND,
  OVERVIEW,
  RANKING,
  DETAIL,
  GATE,
  SWITCH,
  INSIGHTS,
  ICON,
];
const STYLES = `${CSS}\n${CSS2}\n${CSS3}`;

/** 从 TSX 里捞出所有 `m-usage*` 类名（含 BEM 修饰），顺序无关。 */
function usedClasses(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\bm-usage[\w-]*/g)) found.add(match[0]);
  return [...found];
}

describe('样式必须真的落地', () => {
  /**
   * 判据写成「用到就必须有规则」，而不是「有几条规则」：以后谁加一个 `m-usage__xxx`
   * 却忘了写样式，这里立刻红。`(?![\w-])` 让 `m-usage__bar` 不能被 `m-usage__bar-fill` 顶替。
   */
  it('st01_every_used_class_has_a_rule_in_some_stylesheet', () => {
    const classes = [...new Set(COMPONENTS.flatMap((source) => usedClasses(source)))];
    expect(classes.length, '没有从组件里捞到任何 m-usage 类名，判据本身失效了').toBeGreaterThan(20);
    for (const name of classes) {
      const selector = new RegExp(`\\.${name}(?![\\w-])`);
      expect(selector.test(STYLES), `${name} 在组件里用了，但两份样式表里都没有规则（裸 HTML）`).toBe(
        true,
      );
    }
  });

  /** 样式表必须被入口引入：写在 src 里没人 import，等于没写。 */
  it('st02_entry_imports_every_stylesheet', () => {
    expect(ENTRY, 'main.tsx 没有引入 usage.css').toContain("'../styles/mobile/usage.css'");
    expect(ENTRY, 'main.tsx 没有引入 usage-overview.css').toContain(
      "'../styles/mobile/usage-overview.css'",
    );
    expect(ENTRY, 'main.tsx 没有引入 usage-cards.css').toContain(
      "'../styles/mobile/usage-cards.css'",
    );
  });

  /** 移动端纪律：无 `:hover`（触摸设备没有悬停态）。 */
  it('st03_no_hover_rules', () => {
    expect(CSS).not.toContain(':hover');
    expect(CSS2).not.toContain(':hover');
    expect(CSS3).not.toContain(':hover');
  });
});

describe('读不到 ≠ 零（趋势柱）', () => {
  it('st04_pending_days_start_as_null_not_zero', () => {
    expect(PAGE, '趋势初值不是 null：未读到的天会被画成零柱').toContain('totalSec: null');
    expect(TREND, '趋势柱没有区分挂起态').toContain('data-pending={pending || undefined}');
    expect(CSS, '挂起态与空数据没有各自的样式').toMatch(/\[data-pending\]/);
    expect(CSS).toMatch(/\[data-empty\]/);
  });

  /** 详情柱与主趋势柱同一口径：`appSeries` 没读到的天必须是 null。 */
  it('st04b_detail_series_reuses_the_same_null_semantics', () => {
    expect(PAGE).toContain('appSeries(days, keys, detailPkg)');
    expect(PAGE, '详情柱把没读到的天填成 0 了').toContain('totalSec: series[i] ?? null');
  });
});

describe('读数同源（合计与条长）', () => {
  /**
   * 同一张卡里出现两个来源，就会同屏「这天合计 1h」+ 空列表（0.12.2 计时分布卡正是这么错的）。
   * 这一轮把「合计」统一交给 `rangeOf()`（由行求和），两个视图都只读它给的那个对象。
   */
  it('st05_total_and_bars_come_from_one_range_object', () => {
    expect(PAGE).toContain('rangeOf([current])');
    expect(PAGE).toContain('rangeOf(loadedDays)');
    expect(DAY).toContain('topRows(day.rows, RANK_LIMIT)');
    expect(DAY).toContain('totalSec={day.totalSec}');
    expect(WEEK).toContain('topRows(week.rows, RANK_LIMIT)');
    expect(WEEK).toContain('totalSec={week.totalSec}');
  });

  /** 某一天读失败只标那一天：不许把整页翻成错误态。 */
  it('st06_one_bad_day_does_not_blank_the_page', () => {
    expect(PAGE).toContain('setFailed((prev) => ({ ...prev, [key]: failureText(error) }))');
  });

  /** 排行条长按「本列表第一条」归一，不拿后端返回顺序的第一条当契约。 */
  it('st07_bar_width_is_normalised_by_a_local_peak', () => {
    expect(RANKING).toContain('const peak = top.reduce(');
  });
});

describe('单应用详情与洞察', () => {
  it('st08_ranking_opens_detail_and_detail_can_go_back', () => {
    expect(PAGE).toContain('onSelectApp={setDetailPkg}');
    expect(PAGE).toContain('onBack={() => setDetailPkg(null)}');
    expect(DETAIL).toContain('返回排行');
  });

  /** 洞察句只在 `UsageInsightList` 里渲染；页面与视图都不许自己拼 <li>（语气与样式会分叉）。 */
  it('st09_insights_are_rendered_in_one_place_only', () => {
    expect(INSIGHTS).toContain('className="m-usage-insight"');
    expect(PAGE).not.toContain('m-usage-insight');
    expect(DAY).not.toContain('m-usage-insight');
    expect(WEEK).not.toContain('m-usage-insight');
  });
});

/**
 * 失败必须说人话之外的**真话**。
 *
 * 这一页曾经把 `errorText()` 的结果当失败文案，而它把所有 `IO_ERROR` 一律说成
 * 「系统调用失败，请重试」：原生桥没注册、桥内抛异常、命令被 ACL 拒绝，三种原因在屏幕上
 * 长得一模一样 —— 用户没法复述，开发也没法定位（真机上就那么瞎了一轮）。
 * 所以这里钉住：失败走 `failureText()`（原文 + 错误码），不许回退到润色版。
 */
describe('失败文案不许被润色掉', () => {
  it('st10_failures_surface_the_raw_message_and_code', () => {
    expect(PAGE, '页面又用回 errorText 了').toContain('function failureText');
    expect(PAGE).toContain('rawIpcText(err)');
    expect(PAGE, '错误码没有进文案').toContain('`${raw}（${code}）`');
    /* 三处失败口都必须走 failureText：首屏失败、翻日失败、单日标记失败 */
    expect(PAGE.match(/failureText\(error\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(GATE, '门禁屏把原文丢了').toContain('{message || ');
    expect(GATE).toContain('m-usage__raw');
    expect(CSS3, '原文样式没落地').toContain('.m-usage__raw');
  });
});

/**
 * 统计已并入记录页（[0.13.3]）。
 *
 * 底栏原本 6 格（计时 / 事项 / 记录 / 统计 / 便利贴 / 设置），在 375px 上挤成图标条；
 * 而「我记了多久」与「手机被谁拿走了」本来就是一件事的两面。所以删掉独立页签、
 * 把统计挂到记录页的总计卡下面。
 *
 * 三条一起钉，是因为这个改动**任何一条漏掉都能正常构建**：
 * 只删页签不删渲染 → 记录页什么都看不到；只删渲染不删类型 → 编不过（算是唯一会被抓到的）；
 * 删了入口但没接进记录页 → 功能整块消失，测试全绿。
 */
describe('统计并入记录页（不再有独立页签）', () => {
  it('st11_usage_tab_is_gone_and_records_page_hosts_it', () => {
    expect(SHELL, '底栏还留着 usage 页签').not.toContain("id: 'usage'");
    expect(SHELL, '外壳还在渲染 UsagePage').not.toContain('<UsagePage');
    expect(UI_STORE, 'MobileTab 里还有 usage').not.toContain("'usage'");
    expect(RECORDS, '记录页没有挂统计').toContain('<UsagePage />');
    /* 只能在记录页里出现一次：多挂一处就是两份取数、两份「今日合计」 */
    expect(RECORDS.match(/<UsagePage/g)?.length ?? 0).toBe(1);
  });
});
