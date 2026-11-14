import type { Locale } from "../../../shared/i18n/index.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { CandidateFilter, ObservedAppCandidate } from "../types.ts";

interface FilterAndSortCandidatesParams {
  candidates: ObservedAppCandidate[];
  filter: CandidateFilter;
  searchQuery?: string;
  resolveMappedCategory: (candidate: ObservedAppCandidate) => UserAssignableAppCategory;
  resolveTrackingEnabled?: (candidate: ObservedAppCandidate) => boolean;
  resolveEffectiveDisplayName: (candidate: ObservedAppCandidate) => string;
  resolveCategoryLabel?: (category: UserAssignableAppCategory) => string;
  locale: Locale;
}

export function filterAndSortCandidates({
  candidates,
  filter,
  searchQuery,
  resolveMappedCategory,
  resolveTrackingEnabled,
  resolveEffectiveDisplayName,
  resolveCategoryLabel,
  locale,
}: FilterAndSortCandidatesParams): ObservedAppCandidate[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const normalizedQuery = searchQuery?.trim().toLocaleLowerCase(locale) ?? "";
  return candidates
    .filter((candidate) => {
      const category = resolveMappedCategory(candidate);
      const trackingEnabled = resolveTrackingEnabled?.(candidate) ?? true;
      if (filter === "excluded") return !trackingEnabled;
      if (!trackingEnabled) return false;
      if (filter === "all") return true;
      return filter === "other" ? category === "other" : category !== "other";
    })
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      const category = resolveMappedCategory(candidate);
      return [
        resolveEffectiveDisplayName(candidate),
        candidate.appName,
        candidate.exeName,
        candidate.searchText ?? "",
        resolveCategoryLabel?.(category) ?? category,
        category,
      ].join(" ").toLocaleLowerCase(locale).includes(normalizedQuery);
    })
    /* 「未分类」沉底（[0.13] 主人口径）：已分类的排前面，未分类的压到最后一行组。
       两组**组内**仍按显示名排 —— 沉底只决定"哪一组在前"，不重排组内顺序。
       为什么不做成置顶：这份列表的主用途是"刚分完类的应用上浮、待处理的沉底"，
       置顶会把最不需要动作的那一撮（已经分好的）推到眼球上方。
       `filter === "other"` 时这一级恒等（只有一组），保留是为了少一条分支。 */
    .sort((left, right) => {
      const leftOther = resolveMappedCategory(left) === "other";
      const rightOther = resolveMappedCategory(right) === "other";
      if (leftOther !== rightOther) return leftOther ? 1 : -1;
      return collator.compare(resolveEffectiveDisplayName(left), resolveEffectiveDisplayName(right))
        || collator.compare(left.exeName, right.exeName);
    });
}

export function collectCandidateCategories<T>(
  candidates: readonly T[],
  resolveCategory: (candidate: T) => UserAssignableAppCategory,
): Set<UserAssignableAppCategory> {
  return new Set(candidates.map(resolveCategory).filter((category) => category !== "other"));
}
