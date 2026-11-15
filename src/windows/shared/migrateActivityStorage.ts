/**
 * Timing — 分析窗存储键迁移（T04-4，去 Patina 化）
 * -----------------------------------------------------------------------------
 * 本模块只做一件事：把 `patina:*` 老键的值**整串复制**到 `activity:*` 新键。
 *
 * 八条实现契约（施工单 §4，每条都对应一种"静默丢数据"的死法）：
 *   1. 同步 + 单向依赖：不得 await、不得 import 任何 store / 平台层 / React；
 *      **不得 import `activityStorageKeys`**（判据 5 / V-12 判的就是这条字面量——
 *      注册表以参数传入，零循环是**结构**，不是纪律。允许 keys ⇄ migrate 循环，
 *      就把正确性押在"只在函数体内引用对方"的口头纪律上，而 ESM 的 TDZ /
 *      半初始化模块随 import 顺序变化）。
 *   2. 只复制，不删：本文件**不得出现 `removeItem`**（判据 4 / V-4）。
 *      路径 B 的删除在 `activityDisplaySettingsStore.ts`（"await 成功后才删"），
 *      天然分开。
 *   3. 整串复制，不解析、不规范化：解析 = 让迁移对 schema 负责，而 schema 会变；
 *      且并发时会互相覆盖。`dashboard-layout:v2 → v3` 的归一化归 `normalizeLayout`，
 *      不归这里（契约 6）。
 *   4. 逐槽 try/catch 绝不 throw；报告 `{ copied, skipped, failed, scanned }`。
 *      整体失败由调用方（`ensureMigrated` 的外层 try + finally）兜住：标记 done、
 *      等效 0/0/0，不抛、不重试。
 *   5. 内部只用裸 `storage.getItem / setItem`——由"不得 import 注册表"**结构性**
 *      保证它不可能回调读写出口，因此不可能递归回 `ensureMigrated`。
 *   6. 不做 schema 转换（v2 冻结，见 `layoutStore.ts`）。
 *   7. 只遍历带 `target` 的槽（契约 8）：无 `target` = 只读老键，迁移碰都不碰，
 *      **含不得为其创建新键**——给 `dashboard-layout:v2` 造一个
 *      `activity:dashboard-layout:v2` 就是在盘上种一份没人能读的垃圾。
 *   8. INV-1 顺序：**先写新、永不删老** ⇒ 任一时刻 `新值 ∨ 老值` 必有一侧存在。
 *      禁止"先删后写"——它造出两侧皆空的窗口；这条由 M-10b 的蕴含式约束
 *      （"第 k 个键已写新值 ⇒ 第 k 个键旧值必须仍在"）锁住，M-10a 只锁最终态，
 *      而"先删后写"的最终态看起来完全正确，所以 M-10a 单独存在时会漏。
 *
 * 有损点（§5.2，注释 + CHANGELOG 双写）：老键**永不删** ⇒ 它们停在**升级那一刻**。
 * 升级之后用户的每次修改只写新键，老键不再更新——于是**回滚到旧版本**（只认
 * `patina:`）时，用户看到的是"升级那一刻的设置"，不是"最后一次设置"。
 * 这是本迁移唯一的已知有损点，已写进 CHANGELOG；不要试图用"迁移后继续双写老键"
 * 消除它——双写等于复活 §4.6 判死的老键回落（M-15：用户"越清除越回不去"）。
 */

/** 一个存储槽：逻辑名 + 老键 + 可选新键 + 生命周期。 */
export type ActivitySlot = {
  /** 逻辑名（全仓唯一，读写出口按它查）。 */
  name: string;
  /** 老键（永远存在；判据 1/2 用它；**永不删**，除路径 B 的例外）。 */
  legacy: string;
  /** 新键；缺省 = 只读老键，迁移跳过且不为其建新键（契约 8）。 */
  target?: string;
  /** preference = 用户偏好（永不主动删）；transient = 可丢弃（跨存储搬走后可删）。 */
  lifetime: 'preference' | 'transient';
  /** true = `legacy`/`target` 是**前缀**（动态模板），迁移按枚举回退处理（§3.2）。 */
  dynamic?: boolean;
};

export interface ActivityMigrationReport {
  /** 成功复制到新键的槽数。 */
  copied: number;
  /** 跳过数（新键已存在 / 老键不存在）。 */
  skipped: number;
  /** 失败数（该槽存储访问抛异常；不抛出，只计数）。 */
  failed: number;
  /** 本次扫描的槽数（带 `target` 的槽；含动态模板）。 */
  scanned: number;
}

/**
 * 迁移一批槽。**同步、幂等、只复制**：
 *   · 新键已存在 ⇒ skip（M-2：升级后不倒退用户设置）；
 *   · 老键不存在 ⇒ skip（首次安装没有老键，不给新键写垃圾）；
 *   · 逐槽 try/catch：单槽失败只计 `failed`，不中断其余槽（M-4）。
 * 动态模板（`dynamic: true`）走前缀枚举回退，单独 try/catch（S2）。
 */
export function migrateActivityStorage(
  slots: readonly ActivitySlot[],
  storage: Storage,
): ActivityMigrationReport {
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  const copySlots = slots.filter((slot) => slot.target !== undefined && slot.dynamic !== true);
  const dynamicTemplates = slots.filter((slot) => slot.dynamic === true && slot.target !== undefined);

  for (const slot of copySlots) {
    const target = slot.target as string;
    try {
      /* 新键已存在 ⇒ skip。判定先于读老键：迁移永不覆盖已落盘的新值。 */
      if (storage.getItem(target) !== null) {
        skipped += 1;
        continue;
      }
      const legacyValue = storage.getItem(slot.legacy);
      if (legacyValue === null) {
        skipped += 1;
        continue;
      }
      /* INV-1：只写新，不删老。这里**不许**出现 removeItem——
         "先删后写"会在两步之间造出两侧皆空的窗口（M-10b 锁的就是这一行之前老值仍在）。 */
      storage.setItem(target, legacyValue);
      copied += 1;
    } catch {
      failed += 1;
    }
  }

  /* 动态模板：枚举 localStorage 里的 `legacy*` 键，逐个补到 `target*`。
     已知 4 个格式由上面的静态槽覆盖（target 已存在 ⇒ skip）；这里兜的是
     注册表建成之后才出现的第 5 个格式——它没有静态槽，靠前缀回退活下来。
     枚举单独 try/catch（S2）：storage.length / key(i) 也可能抛。 */
  for (const template of dynamicTemplates) {
    const legacyPrefix = template.legacy;
    const targetPrefix = template.target as string;
    try {
      const length = storage.length;
      const legacyKeys: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const key = storage.key(index);
        if (key !== null && key.startsWith(legacyPrefix)) legacyKeys.push(key);
      }
      for (const legacyKey of legacyKeys) {
        const targetKey = targetPrefix + legacyKey.slice(legacyPrefix.length);
        try {
          if (storage.getItem(targetKey) !== null) {
            skipped += 1;
            continue;
          }
          const value = storage.getItem(legacyKey);
          if (value === null) {
            skipped += 1;
            continue;
          }
          storage.setItem(targetKey, value);
          copied += 1;
        } catch {
          failed += 1;
        }
      }
    } catch {
      /* 枚举失败（length/key 抛）只算这一条模板失败，不影响静态槽的已计数。 */
      failed += 1;
    }
  }

  return {
    copied,
    skipped,
    failed,
    scanned: copySlots.length + dynamicTemplates.length,
  };
}
