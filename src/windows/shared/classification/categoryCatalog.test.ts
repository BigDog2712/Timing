/**
 * 分类目录纯函数层的判据（[0.14]）。
 *
 * builder 六路入参**显式传入**，不偷读全局 —— 判据纯函数化，变异自证（漏任一路 /
 * 改排序 / 改标签优先级）都直接红在断言上。四路并集各有专属用例：漏掉任何一路，
 * "应用能选到、事项选不到"的那类失效就复活。
 */
import { describe, expect, it } from "vitest";

import {
  BUILTIN_CATEGORY_KEYS,
  BUILTIN_CATEGORY_LABELS_ZH,
  buildCategoryCatalog,
  withCurrentValueOption,
  type CategoryCatalogRows,
} from "./categoryCatalog.ts";

const row = (key: string, value = "") => ({ key, value });

const emptyCatalog = (): CategoryCatalogRows => ({
  definitions: [],
  deleted: [],
  labelOverrides: [],
  colorOverrides: [],
  appOverrides: [],
  webOverrides: [],
});

/** 中性注入：内置键给 zh 名，自定义键给解码兜底 —— 与两窗各自的注入形态同构。 */
const argsOf = (catalog: CategoryCatalogRows) => ({
  catalog,
  builtinLabel: (key: string) => BUILTIN_CATEGORY_LABELS_ZH[key] ?? null,
  customLabel: (key: string) => {
    const raw = key.slice("custom:".length);
    try {
      return decodeURIComponent(raw) || "自定义";
    } catch {
      return "自定义";
    }
  },
});

const values = (options: ReturnType<typeof buildCategoryCatalog>) => options.map((o) => o.value);

describe("buildCategoryCatalog：四路并集各贡献一路", () => {
  it("内置键恒在（固定序，无 other）", () => {
    const options = buildCategoryCatalog(argsOf(emptyCatalog()));
    expect(values(options)).toEqual([...BUILTIN_CATEGORY_KEYS]);
    expect(values(options)).not.toContain("other");
    expect(values(options)).not.toContain("system");
  });

  it("定义行贡献自定义分类", () => {
    const catalog = emptyCatalog();
    catalog.definitions = [row("__custom_category::custom:%E5%86%99%E4%BD%9C")];
    expect(values(buildCategoryCatalog(argsOf(catalog)))).toContain("custom:%E5%86%99%E4%BD%9C");
  });

  it("app override 的主分类 category 贡献一路", () => {
    const catalog = emptyCatalog();
    catalog.appOverrides = [row("__app_override::code.exe", JSON.stringify({ category: "game" }))];
    expect(values(buildCategoryCatalog(argsOf(catalog)))).toContain("game");
  });

  it("web override 的主分类 category 贡献一路", () => {
    const catalog = emptyCatalog();
    catalog.webOverrides = [row("__web_domain_override::docs.qq.com", JSON.stringify({ category: "office" }))];
    expect(values(buildCategoryCatalog(argsOf(catalog)))).toContain("office");
  });

  it("颜色覆盖键贡献一路", () => {
    const catalog = emptyCatalog();
    catalog.colorOverrides = [row("__category_color_override::design", "#123456")];
    expect(values(buildCategoryCatalog(argsOf(catalog)))).toContain("design");
  });

  it("override 里不存在的分类也会被 app override 带进来（自定义键）", () => {
    const catalog = emptyCatalog();
    catalog.appOverrides = [row("__app_override::a.exe", JSON.stringify({ category: "custom:%E6%8A%BD%E7%83%9F" }))];
    const options = buildCategoryCatalog(argsOf(catalog));
    expect(values(options)).toContain("custom:%E6%8A%BD%E7%83%9F");
    expect(options.find((o) => o.value === "custom:%E6%8A%BD%E7%83%9F")?.label).toBe("抽烟");
  });
});

describe("buildCategoryCatalog：过滤与排序", () => {
  it("deleted 过滤：内置与自定义一并剔除", () => {
    const catalog = emptyCatalog();
    catalog.deleted = [row("__deleted_category::ai"), row("__deleted_category::custom:%E5%86%99%E4%BD%9C")];
    catalog.definitions = [row("__custom_category::custom:%E5%86%99%E4%BD%9C")];
    const options = buildCategoryCatalog(argsOf(catalog));
    expect(values(options)).not.toContain("ai");
    expect(values(options)).not.toContain("custom:%E5%86%99%E4%BD%9C");
    expect(values(options)).toContain("development");
  });

  it("内置键按固定序，不随取数顺序漂移", () => {
    const catalog = emptyCatalog();
    /* 定义行把同名内置键重复塞进来也只留一份，顺序仍是固定序 */
    catalog.definitions = [
      row("__custom_category::utility"),
      row("__custom_category::ai"),
    ];
    expect(values(buildCategoryCatalog(argsOf(catalog)))).toEqual([...BUILTIN_CATEGORY_KEYS]);
  });

  it("自定义键按显示名 zh-CN 排序（乱序输入也得有序）", () => {
    const catalog = emptyCatalog();
    catalog.definitions = [
      row("__custom_category::custom:%E9%98%85%E8%AF%BB"), // 阅读
      row("__custom_category::custom:%E5%86%99%E4%BD%9C"), // 写作
      row("__custom_category::custom:%E6%8A%BD%E7%83%9F"), // 抽烟
    ];
    const labels = buildCategoryCatalog(argsOf(catalog))
      .filter((o) => o.value.startsWith("custom:"))
      .map((o) => o.label);
    expect(labels).toEqual(["抽烟", "写作", "阅读"]);
  });

  it("labelOverride 覆盖内置名；都没有时退到原始键", () => {
    const catalog = emptyCatalog();
    catalog.labelOverrides = [row("__category_label_override::development", " 搬砖 ")];
    const options = buildCategoryCatalog(argsOf(catalog));
    expect(options.find((o) => o.value === "development")?.label).toBe("搬砖");
    expect(options.find((o) => o.value === "ai")?.label).toBe("AI");

    const bare = emptyCatalog();
    bare.colorOverrides = [row("__category_color_override::custom:%E6%97%A0%E5%90%8D")];
    const fallback = buildCategoryCatalog({
      ...argsOf(bare),
      customLabel: () => null,
    });
    expect(fallback.find((o) => o.value === "custom:%E6%97%A0%E5%90%8D")?.label).toBe(
      "custom:%E6%97%A0%E5%90%8D",
    );
  });

  it("脏行防御：JSON 坏值 / 非对象 / category 为 other 或 system 都不进候选", () => {
    const catalog = emptyCatalog();
    catalog.appOverrides = [
      row("__app_override::bad.exe", "{not json"),
      row("__app_override::arr.exe", JSON.stringify(["game"])),
      row("__app_override::other.exe", JSON.stringify({ category: "other" })),
      row("__app_override::sys.exe", JSON.stringify({ category: "system" })),
      row("__app_override::ok.exe", JSON.stringify({ category: " music " })),
    ];
    const values2 = values(buildCategoryCatalog(argsOf(catalog)));
    expect(values2).toContain("music");
    expect(values2).not.toContain("other");
    expect(values2).not.toContain("system");
  });
});

describe("withCurrentValueOption：selectedOption 兜底三分支", () => {
  const base = [
    { value: "ai", label: "AI" },
    { value: "game", label: "游戏" },
  ];

  it("空值 / null → 原样（新数组，内容不变）", () => {
    expect(withCurrentValueOption(base, "")).toEqual(base);
    expect(withCurrentValueOption(base, null)).toEqual(base);
    expect(withCurrentValueOption(base, undefined)).toEqual(base);
  });

  it("当前值在候选 → 原样", () => {
    expect(withCurrentValueOption(base, "game")).toEqual(base);
  });

  it("当前值不在候选 → 追加 { value, label: 原键名 }，且排在既有项之后", () => {
    const next = withCurrentValueOption(base, "custom:lost");
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ value: "custom:lost", label: "custom:lost" });
    expect(next[0]).toEqual(base[0]);
  });
});
