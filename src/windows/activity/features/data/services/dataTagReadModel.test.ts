import { describe, expect, it } from "vitest";

import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import { buildDataTagReadModel, filterDataTagOptionsForQuery } from "./dataTagReadModel.ts";
import type { DataAppOption } from "./dataReadModel.ts";

const appOptions: DataAppOption[] = [{
  appKey: "editor.exe",
  sourceAppKeys: ["editor.exe"],
  appName: "Editor",
  exeName: "editor.exe",
  totalDuration: 3_600_000,
  percentage: 100,
  averageDuration: 3_600_000,
  activeDayCount: 1,
}];

const appOverrides: Record<string, AppOverride> = {
  "editor.exe": { category: "development" },
};

describe("buildDataTagReadModel", () => {
  it("combines app categories and item associations into normalized tag options", () => {
    const model = buildDataTagReadModel({
      appOptions,
      items: [{ id: 4, name: "Project notes" }],
      itemTags: [{ itemId: 4, tags: [" #Learning / Notes ", "learning/notes"] }],
      appOverrides,
      resolveCategoryLabel: (category) => category === "development" ? "Development" : category,
    });

    expect(model.tagOptions).toEqual([
      expect.objectContaining({
        key: "development",
        displayName: "Development",
        totalDuration: 3_600_000,
        appCount: 1,
        itemCount: 0,
      }),
      expect.objectContaining({
        key: "learning/notes",
        displayName: "Learning/Notes",
        totalDuration: 0,
        appCount: 0,
        itemCount: 1,
        items: [{ id: 4, name: "Project notes" }],
      }),
    ]);
  });

  it("ignores associations for missing items and filters by associated names", () => {
    const model = buildDataTagReadModel({
      appOptions,
      items: [{ id: 4, name: "Project notes" }],
      itemTags: [
        { itemId: 4, tags: ["work"] },
        { itemId: 99, tags: ["orphan"] },
      ],
      appOverrides: {},
      resolveCategoryLabel: (category) => category,
    });

    expect(model.tagOptions.map((tag) => tag.displayName)).toEqual(["work"]);
    expect(filterDataTagOptionsForQuery(model.tagOptions, "project").map((tag) => tag.key))
      .toEqual(["work"]);
  });
});
