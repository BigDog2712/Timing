import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { ClassificationDraftState } from "../services/classificationDraftState.ts";

export type AppMappingOverrideParams = {
  category?: UserAssignableAppCategory;
  categories?: UserAssignableAppCategory[];
  displayName?: string;
  color?: string;
  track?: boolean;
  captureTitle?: boolean;
  updatedAt?: number;
};

export type WebDomainOverrideParams = {
  category?: UserAssignableAppCategory;
  displayName?: string;
  color?: string;
  enabled?: boolean;
  captureTitle?: boolean;
  updatedAt?: number;
};

export type ClassificationBootstrapSnapshot = {
  loadedAppLinks?: ClassificationDraftState["appLinks"];
  loadedOverrides: ClassificationDraftState["overrides"];
  loadedWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  loadedCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  loadedCategoryLabelOverrides: ClassificationDraftState["categoryLabelOverrides"];
  loadedPersistedCategoryIds: ClassificationDraftState["persistedCategoryIds"];
  loadedDeletedCategories: ClassificationDraftState["deletedCategories"];
};
