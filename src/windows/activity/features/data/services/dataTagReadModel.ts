import { resolveCanonicalExecutable } from "../../../shared/classification/processNormalization.ts";
import { resolveCategorySet } from "../../../shared/classification/appOverrideCodec.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { DataAppOption } from "./dataReadModel.ts";
import { normalizeTagPath } from "../../../../shared/tags/normalize.ts";
import type {
  DataTagAssociationItem,
  DataTagOption,
  DataTagReadModel,
} from "./dataTagReadModelTypes.ts";

export type { DataTagReadModel } from "./dataTagReadModelTypes.ts";

export interface DataTagItemInput {
  id: number;
  name: string;
}

export interface DataTagItemTagsInput {
  itemId: number;
  tags: readonly string[];
}

export interface BuildDataTagReadModelInput {
  appOptions: readonly DataAppOption[];
  items: readonly DataTagItemInput[];
  itemTags: readonly DataTagItemTagsInput[];
  appOverrides: Readonly<Record<string, AppOverride>>;
  resolveCategoryLabel: (category: string) => string;
}

interface MutableTag {
  key: string;
  displayName: string;
  totalDuration: number;
  applications: Map<string, { key: string; name: string; duration: number }>;
  items: Map<number, DataTagAssociationItem>;
}

function canonicalTagKey(path: string): string {
  return path.toLocaleLowerCase("en-US").replace(/\u03c2/gu, "\u03c3");
}

function addTag(map: Map<string, MutableTag>, rawPath: string): MutableTag | null {
  try {
    const path = normalizeTagPath(rawPath);
    if (!path) return null;
    const key = canonicalTagKey(path);
    let tag = map.get(key);
    if (!tag) {
      tag = { key, displayName: path, totalDuration: 0, applications: new Map(), items: new Map() };
      map.set(key, tag);
    }
    return tag;
  } catch {
    return null;
  }
}

function appTags(
  app: DataAppOption,
  overrides: Readonly<Record<string, AppOverride>>,
): string[] {
  const candidates = [app.exeName, ...app.sourceAppKeys];
  const override = candidates
    .map((candidate) => overrides[resolveCanonicalExecutable(candidate)] ?? overrides[candidate])
    .find(Boolean);
  /* Use the persisted key as the association identity. Labels are presentation-only;
     translating them here would make "development" and "开发" become different tags. */
  return resolveCategorySet(override);
}

export function buildDataTagReadModel(input: BuildDataTagReadModelInput): DataTagReadModel {
  const tags = new Map<string, MutableTag>();
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const totalDuration = input.appOptions.reduce((sum, app) => sum + app.totalDuration, 0);

  for (const app of input.appOptions) {
    for (const rawPath of appTags(app, input.appOverrides)) {
      const tag = addTag(tags, rawPath);
      if (!tag) continue;
      tag.displayName = input.resolveCategoryLabel(rawPath) || tag.displayName;
      tag.totalDuration += app.totalDuration;
      const existing = tag.applications.get(app.appKey);
      if (existing) existing.duration += app.totalDuration;
      else tag.applications.set(app.appKey, { key: app.appKey, name: app.appName, duration: app.totalDuration });
    }
  }

  for (const row of input.itemTags) {
    const item = itemsById.get(row.itemId);
    if (!item) continue;
    for (const rawPath of row.tags) {
      const tag = addTag(tags, rawPath);
      if (tag) tag.items.set(item.id, { id: item.id, name: item.name });
    }
  }

  const tagOptions = Array.from(tags.values()).map((tag): DataTagOption => ({
    key: tag.key,
    displayName: tag.displayName,
    color: "",
    totalDuration: tag.totalDuration,
    percentage: totalDuration > 0 ? (tag.totalDuration / totalDuration) * 100 : 0,
    appCount: tag.applications.size,
    itemCount: tag.items.size,
    applications: Array.from(tag.applications.values())
      .sort((left, right) => right.duration - left.duration || left.name.localeCompare(right.name))
      .map(({ key, name }) => ({ key, name })),
    items: Array.from(tag.items.values()).sort((left, right) => left.name.localeCompare(right.name)),
  }));

  tagOptions.sort((left, right) => right.totalDuration - left.totalDuration || left.displayName.localeCompare(right.displayName));
  return { tagOptions, appOptions: input.appOptions.map((app) => ({ ...app })) };
}

export function filterDataTagOptionsForQuery(
  options: readonly DataTagOption[],
  query: string,
): DataTagOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...options];
  return options.filter((option) => [
    option.displayName,
    ...option.applications.map((app) => app.name),
    ...option.items.map((item) => item.name),
  ].some((value) => value.toLocaleLowerCase().includes(normalized)));
}
