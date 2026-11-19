import { describe, expect, it, vi } from "vitest";

import type { MediaPlaybackSample } from "../../../platform/persistence/mediaPlaybackRepository.ts";
import {
  enrichTimelineDetailsWithMedia,
  mergeMediaDetailRows,
  resolveDetailWindow,
} from "./historyMediaDetails.ts";
import type { TimelineDetailTitle } from "./historyTitleCleanup.ts";

function row(title: string, startTime: number, endTime: number | null = null): TimelineDetailTitle {
  return { title, startTime, endTime };
}

function media(
  title: string,
  startTime: number,
  endTime: number | null,
  artist: string | null = null,
): MediaPlaybackSample {
  return { sourceAppId: "chrome.exe", title, artist, playbackType: "video", startTime, endTime };
}

describe("mergeMediaDetailRows", () => {
  it("drops media rows already covered by a window title", () => {
    // Chrome puts the page title in its window title, so the video would otherwise
    // appear twice — once raw and once from the media session.
    const merged = mergeMediaDetailRows(
      [row("如何安装 Rust - Google Chrome", 1_000, 2_000)],
      [media("如何安装 Rust", 1_000, 2_000, "某频道")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("如何安装 Rust - Google Chrome");
  });

  it("keeps media-only titles and carries the artist as secondary text", () => {
    const merged = mergeMediaDetailRows(
      [row("写代码 - Visual Studio Code", 1_000, 2_000)],
      [media("夜曲", 3_000, 9_000, "周杰伦")],
    );

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      title: "夜曲",
      secondaryText: "周杰伦",
      startTime: 3_000,
      endTime: 9_000,
    });
  });

  it("orders the merged list by start time", () => {
    const merged = mergeMediaDetailRows(
      [row("文档 - Word", 5_000, 8_000)],
      [media("第一首", 1_000, 2_000), media("第三首", 9_000, 12_000)],
    );

    expect(merged.map((entry) => entry.title)).toEqual(["第一首", "文档 - Word", "第三首"]);
  });

  it("ignores media rows without a title", () => {
    const merged = mergeMediaDetailRows([row("文档 - Word", 5_000, 8_000)], [media("   ", 1_000, 2_000)]);

    expect(merged).toHaveLength(1);
  });

  it("returns the original array when nothing was added", () => {
    const titles = [row("文档 - Word", 5_000, 8_000)];
    expect(mergeMediaDetailRows(titles, [])).toBe(titles);
  });
});

describe("resolveDetailWindow", () => {
  it("spans the whole list and treats an open row as running until now", () => {
    expect(resolveDetailWindow([row("a", 1_000, 2_000), row("b", 3_000, null)], 10_000)).toEqual({
      startMs: 1_000,
      endMs: 10_000,
    });
  });

  it("returns null for an empty list so callers skip the query", () => {
    expect(resolveDetailWindow([], 10_000)).toBeNull();
  });
});

describe("enrichTimelineDetailsWithMedia", () => {
  it("applies merged rows without touching the initial render", async () => {
    const apply = vi.fn();
    const load = vi.fn().mockResolvedValue([media("夜曲", 3_000, 9_000, "周杰伦")]);

    await enrichTimelineDetailsWithMedia([row("文档 - Word", 1_000, 2_000)], 10_000, apply, load);

    expect(load).toHaveBeenCalledWith(1_000, 2_000);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toHaveLength(2);
  });

  it("does not notify when the media adds nothing", async () => {
    const apply = vi.fn();
    const load = vi.fn().mockResolvedValue([]);

    await enrichTimelineDetailsWithMedia([row("文档 - Word", 1_000, 2_000)], 10_000, apply, load);

    expect(apply).not.toHaveBeenCalled();
  });

  it("skips the query when there is no window to query", async () => {
    const load = vi.fn();

    await enrichTimelineDetailsWithMedia([], 10_000, vi.fn(), load);

    expect(load).not.toHaveBeenCalled();
  });
});
