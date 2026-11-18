import type { AppCategory, ExtendedAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { AppLinks } from "../../../shared/classification/appLinks.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";

export interface ClassificationDraftState {
  appLinks?: AppLinks;
  overrides: Record<string, AppOverride>;
  webDomainOverrides: Record<string, WebDomainOverride>;
  categoryColorOverrides: Record<string, string>;
  categoryLabelOverrides: Record<string, string>;
  persistedCategoryIds: ExtendedAppCategory[];
  deletedCategories: AppCategory[];
}

export interface ClassificationDraftChangePlan {
  appLinkChanges?: Array<{ member: string; parent: string | null; previous: string | null }>;
  overrideUpserts: Array<{ exeName: string; override: AppOverride | null }>;
  webDomainOverrideUpserts: Array<{ normalizedDomain: string; override: WebDomainOverride | null; previous?: WebDomainOverride | null }>;
  categoryColorUpdates: Array<{ category: AppCategory; colorValue: string | null }>;
  categoryLabelUpdates: Array<{ category: AppCategory; label: string | null }>;
  persistedCategoryIdsToAdd: ExtendedAppCategory[];
  persistedCategoryIdsToRemove: ExtendedAppCategory[];
  deletedCategoryUpdates: Array<{ category: AppCategory; deleted: boolean }>;
  sanitizedDeletedCategories: AppCategory[];
}
