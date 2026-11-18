export interface CategoryPropagationRequest {
  operationId: string;
  mapping: Record<string, string | null>;
}

export interface CategoryPropagationConflict {
  table: 'app_category' | 'block_segment_override';
  sourceId: number;
  occupantId: number;
  appKey: string | null;
  categoryKey: string | null;
  blockUid: string | null;
  segStart: number | null;
  targetValue: string | null;
}

export interface CategoryPropagationPreview {
  fingerprint: string;
  affectedItems: number;
  affectedActivitySettings: number;
  affectedBindings: number;
  affectedOverrides: number;
  conflicts: CategoryPropagationConflict[];
}
