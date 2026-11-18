import { invokeWithCommandError } from "./commandError.ts";

export interface CategoryPropagationRequest {
  operationId: string;
  mapping: Record<string, string | null>;
}

export interface CategoryPropagationConflict {
  table: string;
  sourceId: number;
  occupantId: number;
  appKey?: string | null;
  categoryKey?: string | null;
  blockUid?: string | null;
  segStart?: number | null;
  targetValue?: string | null;
}

export interface CategoryPropagationPreview {
  fingerprint: string;
  affectedItems: number;
  affectedActivitySettings: number;
  affectedBindings: number;
  affectedOverrides: number;
  conflicts: CategoryPropagationConflict[];
}

export class CategoryPropagationConflictError extends Error {
  constructor(readonly conflicts: readonly CategoryPropagationConflict[]) {
    super("category propagation conflicts");
    this.name = "CategoryPropagationConflictError";
  }
}

export function previewCategoryPropagation(
  request: CategoryPropagationRequest,
): Promise<CategoryPropagationPreview> {
  return invokeWithCommandError<CategoryPropagationPreview>("preview_category_propagation", { request });
}

export function applyCategoryPropagation(
  request: CategoryPropagationRequest,
  expectedFingerprint: string,
): Promise<void> {
  return invokeWithCommandError<void>("apply_category_propagation", {
    request,
    expectedFingerprint,
  });
}

export async function propagateCategoryMapping(
  mapping: Record<string, string | null>,
): Promise<CategoryPropagationPreview> {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  const operationId = randomUUID
    ? randomUUID()
    : `category-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const request = { operationId, mapping };
  const preview = await previewCategoryPropagation(request);
  if (preview.conflicts.length > 0) {
    throw new CategoryPropagationConflictError(preview.conflicts);
  }
  await applyCategoryPropagation(request, preview.fingerprint);
  return preview;
}
