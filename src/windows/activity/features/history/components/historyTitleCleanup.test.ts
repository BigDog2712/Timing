import { describe, expect, it } from "vitest";

import { cleanTimelineDetailTitle, cleanTimelineDetailTitles } from "./historyTitleCleanup.ts";

describe("cleanTimelineDetailTitle", () => {
  it("strips the app suffix Windows appends to window titles", () => {
    expect(
      cleanTimelineDetailTitle({ title: "视频标题 - Google Chrome", startTime: 0, endTime: null }, "Chrome"),
    ).toMatchObject({ title: "视频标题 - Google Chrome" });

    expect(
      cleanTimelineDetailTitle({ title: "视频标题 - Chrome", startTime: 0, endTime: null }, "Chrome"),
    ).toMatchObject({ title: "视频标题" });
  });

  it("keeps titles that only look like a suffix when the app name differs", () => {
    expect(
      cleanTimelineDetailTitle({ title: "报告 - Edge", startTime: 0, endTime: null }, "Chrome"),
    ).toMatchObject({ title: "报告 - Edge" });
  });

  it("leaves untitled rows and blank app names untouched", () => {
    const untitled = { title: "", startTime: 0, endTime: null, isUntitled: true };
    expect(cleanTimelineDetailTitle(untitled, "Chrome")).toBe(untitled);
    expect(cleanTimelineDetailTitle({ title: "报告 - Edge", startTime: 0, endTime: null }, " ")).toMatchObject({
      title: "报告 - Edge",
    });
  });
});

describe("cleanTimelineDetailTitles", () => {
  it("drops whitespace-only rows and keeps untitled placeholders", () => {
    const cleaned = cleanTimelineDetailTitles(
      [
        { title: "   ", startTime: 0, endTime: null },
        { title: "报告 - Chrome", startTime: 1, endTime: null },
        { title: "", startTime: 2, endTime: null, isUntitled: true },
      ],
      "Chrome",
    );

    expect(cleaned.map((row) => row.title)).toEqual(["报告", ""]);
  });
});
