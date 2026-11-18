import type { AppLinks } from "../../../shared/classification/appLinks.ts";
import type { AppOverride } from "../services/classificationService.ts";
import type { ClassificationDraftState } from "../services/classificationDraftState.ts";
import type { ObservedWebDomainCandidate, WebDomainOverride } from "../../../shared/types/webActivity.ts";

export type SaveStatus = "idle" | "saving" | "saved";

export interface AppMappingNameEditState {
  draftState: ClassificationDraftState;
  nameDrafts: Record<string, string>;
  nameEditSnapshots: Record<string, AppOverride | null>;
  editingNameExe: string | null;
  skipNextNameBlurExe: string | null;
}

export interface WebDomainNameEditState {
  draftState: ClassificationDraftState;
  webNameDrafts: Record<string, string>;
  webNameEditSnapshots: Record<string, WebDomainOverride | null>;
  editingWebDomain: string | null;
  skipNextWebNameBlurDomain: string | null;
}

export interface AppMappingSaveFlowInput {
  savedState: ClassificationDraftState | null;
  draftState: ClassificationDraftState | null;
  webDomainCandidates: ObservedWebDomainCandidate[];
  hasUnsavedChanges: boolean;
  saving: boolean;
}

export interface AppMappingSaveFlowDeps {
  commitDraftChanges: (
    saved: ClassificationDraftState,
    draft: ClassificationDraftState,
  ) => Promise<void>;
}

export interface AppMappingBootstrapSnapshot {
  observedWebDomains: ObservedWebDomainCandidate[];
  loadedOverrides: ClassificationDraftState["overrides"];
  loadedAppLinks?: AppLinks;
  loadedWebDomainOverrides: ClassificationDraftState["webDomainOverrides"];
  loadedCategoryColorOverrides: ClassificationDraftState["categoryColorOverrides"];
  loadedCategoryLabelOverrides: ClassificationDraftState["categoryLabelOverrides"];
  loadedPersistedCategoryIds: ClassificationDraftState["persistedCategoryIds"];
  loadedDeletedCategories: ClassificationDraftState["deletedCategories"];
}

export interface AppMappingSaveFlowResult {
  accepted: boolean;
  skippedReason: "missing-state" | "no-changes" | "saving" | null;
  nextSavedState: ClassificationDraftState | null;
  nextDraftState: ClassificationDraftState | null;
  nextBootstrap: AppMappingBootstrapSnapshot | null;
  nextSaveStatus: SaveStatus;
  resetEditingState: boolean;
  error: unknown | null;
}
