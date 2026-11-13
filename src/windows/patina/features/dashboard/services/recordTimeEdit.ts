/**
 * 计时记录「起止时刻」的边界校验（0.13 · T03b，设计 §3.8）—— 全纯函数。
 *
 * ## 为什么必须是纯函数
 *
 * 这条能力是**本轮唯一改写历史数据语义的动作**，六条边界规则（B1–B6）里只要漏一条，
 * 症状都是**静默的**：账单错一天、或弹出一个英文错误码。把判定收进一个可单测的函数，
 * 判据（`recordTimeEdit.test.ts`）才能钉住"顺序本身"。
 *
 * ## 判定顺序（顺序即判据，不许打乱）
 *
 *   `notSaved`（B3，只许改 saved）→ `endMissing`（记录没有结束时刻 = 没法改）
 *   → `sameInstant`（时长为 0 的记录不算记录）→ `endBeforeStart`（B1，严格小于）
 *   → `crossDay`（B2，起止必须落在同一个本地日）→ `null`（合法）。
 *
 * ## B2 为什么在前端拦（而不是等 Rust 拒）
 *
 * `services/record.rs::update` **不按天拆分**：一条 23:50–次日 01:10 的行会被
 * `useTodayItems.ts` 的区间过滤把**整天**时长算给起始日，另一天为 0 —— 不抛异常、
 * 不进日志。所以跨零点必须在落库前拒绝，并给一句指引（`copyTimeline.crossDayHint`）。
 */

export interface RecordTimeBounds {
  startedAt: number;
  /** `null` = 进行中（B3：活动中的记录前端就要禁用，不能等宿主回 `ITEM_NOT_FOUND`） */
  endedAt: number | null;
  status: string;
}

export type RecordTimeIssue =
  | "notSaved"
  | "endMissing"
  | "sameInstant"
  | "endBeforeStart"
  | "crossDay";

/**
 * 校验一次「改起止」。`next` 是弹层里解析好的新起止（两个都必填）；
 * `dayStart` / `dayEnd` 是该记录所属本地日的 `[0 点, 次日 0 点)`。
 */
export function validateRecordTime(
  next: { startedAt: number; endedAt: number },
  record: RecordTimeBounds,
  dayStart: number,
  dayEnd: number,
): RecordTimeIssue | null {
  /* B3：进行中的记录在服务端就改不了（`services/record.rs:58-60` 回的是误导性的
     `ITEM_NOT_FOUND`），前端必须自己先禁。 */
  if (record.status !== "saved") return "notSaved";
  /* 记录本身没有结束时刻（防御分支：`saved` 但 `endedAt` 缺失的脏行） */
  if (record.endedAt === null) return "endMissing";
  /* 时长为 0 的记录不算记录；等于也是倒挂的退化形式，先于 endBeforeStart 给出更准的语义 */
  if (next.endedAt === next.startedAt) return "sameInstant";
  /* B1：`startedAt < endedAt`（严格小于），与 `services/record.rs:68-72` 同一条 */
  if (next.endedAt < next.startedAt) return "endBeforeStart";
  /* B2：起止必须落在同一个本地日（`startedAt < dayStart || endedAt > dayEnd`）。
     未来时间的校验不在这里——那不是本轮六条规则之一，别顺手扩大口径。 */
  if (next.startedAt < dayStart || next.endedAt > dayEnd) return "crossDay";
  return null;
}
