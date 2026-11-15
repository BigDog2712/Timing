/**
 * Timing — 统计页「桥与展示元数据」的源码级判据
 * -----------------------------------------------------------------------------
 * 从 `UsagePage.wiring.test.ts` 拆出来的：那边已经 321 行，撞 `check:size` 的 300 行上限，
 * 而这两组判据盯的东西本来就不在页面上 —— 一组盯桥（Kotlin），一组盯「名字与图标从哪来」。
 * 边界很清楚：**页面与样式的判据留在那边，跨桥契约的判据在这里**。
 *
 * 三组，全部对应真机上已经发生过的缺陷：
 *   ① `granted` 被写死成 true ⇒「没开权限」被说成「今天没用手机」，引导按钮永远不出现；
 *   ② `JSArray(JSONArray)` 选错重载 ⇒ `Not a primitive array`，统计页整块读不到；
 *   ③ 名字从包名尾段凑 ⇒ 微信显示成 `Mm`、哔哩哔哩显示成 `Bili`，且没有图标。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 去注释之后再比：解释性注释里会正当地出现类名与签名，不去掉就是假红。 */
function code(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const KOTLIN = code(
  '../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/TimingNativePlugin.kt',
);
/** 应用真名与图标的解析在另一个 Kotlin 文件里（`PackageManager` 那一摊）。 */
const APP_META = code(
  '../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/native/AppMetadata.kt',
);
const FORMAT = code('./usageFormat.ts');
const RANKING = code('./UsageRanking.tsx');
const DETAIL = code('./UsageAppDetail.tsx');
const ICON = code('./UsageAppIcon.tsx');

/**
 * 桥不许替系统下「已授权」的结论。
 *
 * 真机上踩到的静默缺陷：`usageDay` 原来硬编码 `payload.put("granted", true)`，
 * 于是「没开使用情况访问」被说成「开了但今天没用手机」—— 宿主那条
 * `if (!reply.granted) → USAGE_PERMISSION_DENIED` 永远不触发，界面上永远等不到
 * 「去系统设置打开」的按钮，只剩一片 0 分钟（而且零报错、测试全绿）。
 * 权限状态只有一个真源：`UsageStats.hasPermission`。
 */
describe('授权状态如实上报', () => {
  it('st12_kotlin_must_not_hardcode_granted', () => {
    expect(KOTLIN, 'Kotlin 又把 granted 写死了').not.toContain('payload.put("granted", true)');
    expect(KOTLIN).toContain('payload.put("granted", UsageStats.hasPermission(activity))');
  });
});

/**
 * 跨桥传列表只许 `JSArray`，且**必须经 `jsArrayOf` 转一层**。
 *
 * 真机上踩到的静默缺陷（0.12.2，用户截图原话「读不到应用数据」）：
 * `payload.put("rows", JSArray(UsageStats.queryDay(…)))` —— `queryDay` 回的是
 * `org.json.JSONArray`，它既不是 `Collection` 也不是原生数组，于是 `JSArray` 的
 * `(Collection)` / `(Object[])` 两个重载都不适用，被当成 `(Object)` 收下，转手调
 * `org.json.JSONArray(Object)`，那个构造函数只认原生数组，见非数组就抛
 * `Not a primitive array: class org.json.JSONArray`。
 *
 * 后果比一个异常更难看：**每次调用都抛**（`queryDay` 无权限时回空 `JSONArray`，照样抛），
 * 于是 `app_usage` 永远 0 行、统计页永远整块失败，与授权状态无关。而静态检查看不出来 ——
 * Kotlin 编得过、`JSArray` 的构造签名也确实存在，只是选错了重载。
 *
 * 所以判据要盯**实参的类型来源**，不能只盯「有没有用 JSArray」。
 */
describe('跨桥传列表的装箱方式', () => {
  /** 插件里所有 `JSArray(<实参>)` 的实参；空参（`JSArray()`）跳过。 */
  const args = [...KOTLIN.matchAll(/JSArray\(([^)]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((arg) => arg.length > 0);

  it('st13_no_jsarray_wraps_a_jsonarray', () => {
    expect(args.length, '一个 JSArray(…) 都没扫到 —— 判据自己失效了').toBeGreaterThan(0);
    const bad = args.filter((arg) => /JSONArray|queryDay|optJSONArray/.test(arg));
    expect(
      bad,
      `JSArray 收到了 org.json.JSONArray（会抛 Not a primitive array）：${bad.join(' / ')}`,
    ).toEqual([]);
  });

  it('st14_usage_rows_go_through_the_converter', () => {
    expect(KOTLIN, 'jsArrayOf 不在了：跨桥转换少了一层').toContain('private fun jsArrayOf');
    /* 转换器本身必须真把元素逐项搬进 List —— 只是「包一层再交给 JSArray(Object)」等于换汤 */
    expect(KOTLIN, 'jsArrayOf 没有逐项搬进 ArrayList').toContain('ArrayList<Any>(items.length())');
    /* rows 必须经 jsArrayOf 装箱；而 rows 的来源必须仍是系统口子 queryDay
       （中间多了一层局部变量，是因为 0.13.3 加了「参数不合法时回空数组」的分支） */
    expect(KOTLIN, '统计的 rows 没有经 jsArrayOf').toContain('jsArrayOf(rows)');
    expect(KOTLIN, '统计的 rows 不再来自系统的 queryDay').toContain(
      'UsageStats.queryDay(activity, from, to)',
    );
  });
});

/**
 * 名字必须是系统给的真名，图标必须是真图标。
 *
 * 真机截图：列表里写着 `Mm` / `Bili` / `Home` / `Nova` —— 都是从包名尾段首字母大写凑出来的，
 * 而正确名字是「微信」「哔哩哔哩」「系统桌面」，并且每个应用都带图标。
 *
 * 这一组钉三件事：
 *   ① 名字来自 `PackageManager.getApplicationLabel`，**不许**从包名派生；
 *   ② 图标来自 `getApplicationIcon` 且**压过尺寸**（64px / WebP）—— 不压的话
 *      7 天 × N 个应用的 base64 会把桥和内存撑起来；
 *   ③ 前端显示名只有 `displayName()` 一条规则，排行与详情不许各自 `shortName(...)`。
 */
describe('应用真名与图标', () => {
  it('st15_label_comes_from_package_manager', () => {
    expect(APP_META, 'AppMetadata 没有去系统取应用名').toContain('getApplicationLabel');
    expect(APP_META, 'AppMetadata 没有取应用图标').toContain('getApplicationIcon');
    /* 反向：**不许**出现「按包名截尾段」的写法 —— 那就是 Mm / Bili 的来源 */
    expect(APP_META, 'AppMetadata 又拿包名凑名字了').not.toMatch(/\.split\(['"]\.['"]\)/);
  });

  it('st15b_icon_is_downscaled_and_encoded_as_webp', () => {
    expect(APP_META, '图标没有压到 64px').toContain('ICON_PX = 64');
    expect(APP_META, '图标没有编码').toContain('Bitmap.CompressFormat');
    expect(APP_META, '图标没有以 data URI 回给前端').toContain('data:image/webp;base64,');
    /* 自适应图标要放大绘制区，否则四周留一圈透明、列表里比其他图标小一圈 */
    expect(APP_META, '自适应图标没有放大绘制区').toContain('AdaptiveIconDrawable');
  });

  it('st15c_bridge_ships_apps_and_receives_packages', () => {
    expect(KOTLIN, 'usageDay 没有回 apps').toContain('payload.put("apps", AppMetadata.describe(');
    expect(KOTLIN, 'usageDay 没收 packages（老日子的名字永远解析不出来）').toContain(
      'args.optJSONArray("packages")',
    );
  });

  it('st16_ui_has_exactly_one_name_rule', () => {
    expect(FORMAT, 'displayName 不见了').toContain('export function displayName');
    /* 回落必须回**包名短名**，不是把包名整串露出来 */
    expect(FORMAT, 'displayName 没有回落到 shortName').toContain('shortName(row.packageName)');
    expect(RANKING, '排行没有走 displayName').toContain('displayName(row)');
    expect(DETAIL, '详情标题没有走 displayName').toContain('displayName({ packageName, label })');
    /* 反向：两处都不许再直接 shortName(...)，否则「一页两种名字」又能长回来 */
    expect(RANKING, '排行里又出现 shortName(').not.toContain('shortName(');
    expect(DETAIL, '详情标题又出现 shortName(').not.toContain('shortName(');
  });

  it('st16b_every_row_can_show_an_icon', () => {
    expect(RANKING, '排行行里没有图标').toContain('<UsageAppIcon');
    expect(DETAIL, '详情标题没有图标').toContain('<UsageAppIcon');
    /* 图标兜底：没有图标时画首字瓦片，不许留破图 */
    expect(ICON, '图标没有兜底瓦片').toContain('m-usage__icon--letter');
    expect(ICON, '图标 alt 没有清空（读屏会把名字念两遍）').toContain('alt=""');
  });
});
