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
/** 事件配对（进入/离开 → 一段）在采集器里，不在插件里。 */
const SYSTEM = code(
  '../../../../../src-tauri/gen/android/app/src/main/java/com/timing/app/native/UsageStats.kt',
);
/**
 * 清单文件（XML）也去注释：`<!-- 说明 -->` 里会正当地写出权限全名，
 * 不剥掉的话「注释里写了」也会算通过 —— 那正是「钉名字 ≠ 钉接线」的反面教材。
 */
function manifest(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return readFileSync(url, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

const MANIFEST = manifest(
  '../../../../../src-tauri/gen/android/app/src/main/AndroidManifest.xml',
);
const GRADLE = manifest('../../../../../src-tauri/gen/android/app/build.gradle.kts');
const FORMAT = code('./usageFormat.ts');
const SPANS = code('./usageSpans.ts');
const SPAN_LIST = code('./UsageSpanList.tsx');
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
    /* 自适应图标按 108 视口整幅画再裁中间 72，**不许用负坐标放大**：
       那条路在部分 ROM 上画出来是全透明的，而全透明的图压出来也是合法 WebP，
       前端只会显示成一块灰底空白（0.12.6 真机现象）。 */
    expect(APP_META, '自适应图标没有按 108 视口处理').toContain('ADAPTIVE_PX = 108');
    expect(APP_META, '又用负坐标放大自适应图标了').not.toMatch(/setBounds\(\s*-/);
  });

  /**
   * 「画出来了」不等于「看得见」。三道闸缺一条，界面上就是一块灰底空白：
   *   ① 全透明的位图压出来是合法 WebP ⇒ 必须有 `isBlank` 挡；
   *   ② `compress` 回 true 不等于字节可用 ⇒ 必须 `decodeByteArray` 验一次；
   *   ③ `info` 里的图标引用可能是空 ⇒ 必须还能按包名再取一次。
   */
  it('st15d_blank_or_undecodable_icons_are_dropped', () => {
    expect(APP_META, '没有校验「整张图全透明」').toContain('isBlank(');
    expect(APP_META, '没有校验字节能不能解码').toContain('decodeByteArray');
    expect(APP_META, '字节数下限不见了（空白图只有几十字节）').toContain('MIN_ICON_BYTES');
    expect(APP_META, '没有按包名兜底再取一次图标').toContain('getApplicationIcon(pkg)');
  });

  it('st15c_bridge_ships_apps_and_receives_packages', () => {
    expect(KOTLIN, 'usageDay 没有回 apps').toContain('payload.put("apps", AppMetadata.describe(');
    expect(KOTLIN, 'usageDay 没收 packages（老日子的名字永远解析不出来）').toContain(
      'args.optJSONArray("packages")',
    );
  });

  /**
   * 名字与图标的**前置条件**在清单里，不在代码里。
   *
   * 真机截图（0.12.5 之后仍是 `Mm` / `Bili` / `Nova`）：自己和几个系统应用有真名真图标，
   * 第三方一个都没有。原因不是桥写错，是 Android 11（API 30）起的「包可见性」：
   * 没声明 `QUERY_ALL_PACKAGES` 时，`getApplicationInfo(第三方包)` 抛
   * `NameNotFoundException` ⇒ `AppMetadata.resolve` 返回 null ⇒ 这个包连一条 `apps`
   * 都不出现 ⇒ 前端回落包名尾段。**编译通过、运行不报错、测试全绿**，
   * 只有真机上看着像「桥没写对」。
   *
   * 判据必须查**去掉 XML 注释之后**的清单：注释里写着同一串权限名是常态。
   */
  it('st20_manifest_declares_query_all_packages', () => {
    expect(
      MANIFEST,
      '清单没声明 QUERY_ALL_PACKAGES：第三方应用拿不到名字与图标，只会回落包名',
    ).toContain('android:name="android.permission.QUERY_ALL_PACKAGES"');
    expect(MANIFEST, '缺 tools:ignore，Android Lint 会报 QueryAllPackagesPermission').toContain(
      'tools:ignore="QueryAllPackagesPermission"',
    );
    /* 这条权限之所以必需，是因为 targetSdk ≥ 30 才启用包可见性过滤。
       真有人把 targetSdk 降下去，本判据的前提就变了，得回来重看。 */
    const target = Number(/targetSdk\s*=\s*(\d+)/.exec(GRADLE)?.[1] ?? '0');
    expect(
      target,
      'targetSdk < 30：包可见性限制不生效，这条权限与这段判据都该重新评估',
    ).toBeGreaterThanOrEqual(30);
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
    /* `icon` 非空 ≠ 能显示：加载失败要退回瓦片，否则界面上就是一块灰底（0.12.7） */
    expect(ICON, '图片加载失败没有兜底（会留一块灰底空白）').toContain('onError');
    expect(ICON, '加载失败没有记下来').toContain('setBroken(true)');
  });
});

/**
 * 「9:00-9:30、10:00-10:10」—— 时段必须真的从系统走到界面。
 *
 * 只有 `sec` 一个数的时候，「断成三次、每次十分钟」和「连着三十分钟」在界面上
 * 长得一模一样。这一组钉整条链路的四个交接点，**任何一处断掉都能正常构建**：
 *   ① 采集器配对（`ACTIVITY_RESUMED` + `PAUSED` → 一条 `{packageName, from, to}`）；
 *   ② 桥单独回一条 `spans`（扁平，不塞进 rows —— 嵌套 `JSArray` 没有先例）；
 *   ③ Rust 落库（`app_usage_span`）并在读时合并；
 *   ④ 前端渲染前归一去重（`mergeSpans`），空态说清是「系统不保留了」还是「没用过」。
 */
describe('使用时段的采集与展示', () => {
  it('st17_kotlin_pairs_events_into_spans', () => {
    expect(SYSTEM, '采集器没有产出时段').toContain('item.put("from", span.from)');
    expect(SYSTEM, '时段没有带包名（回来之后无法归到应用）').toContain(
      'item.put("packageName", span.pkg)',
    );
    /* 不足 1 秒的碎段不记：显示成「09:00-09:00」既是噪声也会把库撑大 */
    expect(SYSTEM, '没有丢弃 <1s 的碎段').toContain('MIN_SPAN_MS');
    /* 返回值必须是 {rows, spans} 两段 —— 只回 rows 的话时段永远到不了宿主 */
    expect(SYSTEM, '采集器没有把 spans 一起回出去').toContain('out.put("spans", spansOf(spans))');
  });

  it('st18_bridge_ships_spans_as_a_flat_verified_list', () => {
    expect(KOTLIN, 'usageDay 没有回 spans').toContain('payload.put("spans", jsArrayOf(spans))');
    /* 反向：直接 JSArray(spans) 就是 0.12.2 那个 Not a primitive array */
    expect(KOTLIN, 'spans 没有经 jsArrayOf').not.toMatch(/JSArray\(\s*spans\s*\)/);
    expect(KOTLIN, 'spans 不是从采集器的回值里取的').toContain('day.optJSONArray("spans")');
  });

  it('st19_ui_merges_before_rendering_and_says_which_empty', () => {
    expect(SPANS, 'mergeSpans 不见了：重叠段会被算两遍').toContain('export function mergeSpans');
    expect(SPAN_LIST, '列表没有先合并再渲染').toContain('mergeSpans(spans)');
    /* 空态必须是一句说清原因的话，不是「暂无数据」 */
    expect(SPAN_LIST, '空态没有专门的文案入口').toContain('emptyHint');
    expect(DETAIL, '详情页没有说明「明细已不在系统里」').toContain('系统只保留约 7 天');
    /* 详情页必须把选中那天的段传下去，否则组件永远空着 */
    expect(DETAIL, '详情页没有渲染时段列表').toContain('<UsageSpanList');
  });
});
