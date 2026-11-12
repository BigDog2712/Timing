(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 分类增删的**接线**（[本轮]，不是钉函数名）。
 *
 * 为什么这一个 hook 值得单独测：它是"点了按钮之后到底写了什么"的唯一证人。
 * 三个最容易"看起来做了、其实没做"的坑：
 *   ① 新建只写了定义没写标签 → 分类列表里出现 `custom:category_xxx` 这种名字；
 *   ② 重名不拦 → 两个分类同名，用户永远分不清自己刚建的是哪一个；
 *   ③ 删除只清了定义、没清成员 → 分类没了，可应用还指着它；
 *      反过来只清成员不清定义 → 刷新一次分类**原地复活**。
 */
const g = vi.hoisted(() => ({
  commit: vi.fn(async (_mutations: readonly { key: string; value: string | null }[]) => undefined),
  loadAppOverrides: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  loadWebDomainOverrides: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (_exe: string, _override: unknown) => undefined),
  saveWebDomainOverride: vi.fn(async (_domain: string, _override: unknown) => undefined),
  prompt: vi.fn(),
  confirm: vi.fn(),
  onOptionsChange: vi.fn(),
  onAssigned: vi.fn(),
  onError: vi.fn(),
}));

vi.mock("../../../platform/persistence/classificationSettingsGateway.ts", () => ({
  commitClassificationSettingMutations: g.commit,
}));

vi.mock("../services/classificationService", () => ({
  ClassificationService: {
    loadClassificationBootstrap: g.loadBootstrap,
    invalidateBootstrapCache: g.invalidateBootstrapCache,
    saveAppOverride: g.saveAppOverride,
    saveWebDomainOverride: g.saveWebDomainOverride,
  },
}));

/* 只换掉两个**读库**函数：同文件里的 `buildCreateCategoryDefinitionMutations` /
   `buildDeleteCategoryDefinitionMutations` 必须是**真货**，否则本测试就只是在验证 mock。 */
vi.mock("../services/classificationStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/classificationStore")>();
  return {
    ...actual,
    loadAppOverrides: g.loadAppOverrides,
    loadWebDomainOverrides: g.loadWebDomainOverrides,
  };
});

import { LocaleProvider } from "../../../shared/i18n/index.ts";
import { loadLocaleText } from "../../../shared/i18n/runtime.ts";
import {
  useQuickClassificationCategoryAdmin,
  type CategoryAdminState,
} from "./useQuickClassificationCategoryAdmin.ts";
import { createQuickAppClassificationTarget } from "../types.ts";
import { CATEGORY_ADMIN_COPY } from "../categoryAdminCopy.ts";

const BOOTSTRAP = {
  observedWebDomains: [],
  loadedOverrides: {},
  loadedWebDomainOverrides: {},
  loadedCategoryColorOverrides: {},
  loadedCategoryLabelOverrides: {},
  loadedPersistedCategoryIds: [],
  loadedDeletedCategories: [],
  loadedAppLinks: {},
};

const OPTIONS = [
  { value: "browser" as const, label: "浏览" },
  { value: "development" as const, label: "开发" },
  { value: "other" as const, label: "其他" },
  { value: "custom:category_old" as const, label: "旧分类" },
];

const TARGET = createQuickAppClassificationTarget({
  exeName: "chrome.exe",
  displayName: "Chrome",
  category: "browser",
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: CategoryAdminState | null = null;

function Probe({ currentCategory }: { currentCategory: string | null }) {
  latest = useQuickClassificationCategoryAdmin({
    target: TARGET,
    currentOverride: currentCategory
      ? { enabled: true, category: currentCategory as "browser", updatedAt: 1 }
      : null,
    options: OPTIONS,
    dialogs: { prompt: g.prompt, confirm: g.confirm },
    onOptionsChange: g.onOptionsChange,
    onAssigned: g.onAssigned,
    onError: g.onError,
  });
  return null;
}

async function mount(currentCategory: string | null = "browser"): Promise<void> {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(Probe, { currentCategory }),
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(async () => {
  await loadLocaleText("zh-CN");
  for (const fn of [
    g.commit, g.loadAppOverrides, g.loadWebDomainOverrides, g.loadBootstrap,
    g.invalidateBootstrapCache, g.saveAppOverride, g.saveWebDomainOverride,
    g.prompt, g.confirm, g.onOptionsChange, g.onAssigned, g.onError,
  ]) fn.mockClear();
  g.loadBootstrap.mockResolvedValue(BOOTSTRAP);
  g.loadAppOverrides.mockResolvedValue({});
  g.loadWebDomainOverrides.mockResolvedValue({});
  latest = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("新建分类", () => {
  it("ca01_writes_the_definition_and_the_label_then_puts_the_app_into_it", async () => {
    g.prompt.mockResolvedValue("阅读");
    await mount();

    await act(async () => { await latest?.createCategory(); });

    expect(g.commit).toHaveBeenCalledTimes(1);
    const committed = g.commit.mock.calls[0]?.[0] ?? [];
    expect(committed).toHaveLength(2);
    const definition = committed[0];
    const label = committed[1];
    expect(definition.key.startsWith("__custom_category::custom:")).toBe(true);
    expect(Number(definition.value)).toBeGreaterThan(0);
    expect(label.key).toBe(definition.key.replace("__custom_category::", "__category_label_override::"));
    expect(label.value).toBe("阅读");

    /* 建完立刻把当前应用分过去（否则用户还要再点一次分类） */
    const newCategory = definition.key.slice("__custom_category::".length);
    expect(g.saveAppOverride).toHaveBeenCalledTimes(1);
    expect(g.saveAppOverride.mock.calls[0]?.[0]).toBe("chrome.exe");
    expect(g.saveAppOverride.mock.calls[0]?.[1]).toMatchObject({ category: newCategory });
    expect(g.onAssigned).toHaveBeenCalledWith(expect.objectContaining({ category: newCategory }), newCategory);

    /* 候选必须重算（不作废 bootstrap 缓存的话，下次打开的菜单里看不到新分类） */
    expect(g.invalidateBootstrapCache).toHaveBeenCalledTimes(1);
    expect(g.onOptionsChange).toHaveBeenCalledTimes(1);
  });

  it("ca02_a_duplicate_name_is_not_committed_and_says_why", async () => {
    /* 归一后与已有候选同名（大小写与首尾空白都归一） */
    g.prompt.mockResolvedValue("  浏览 ");
    await mount();

    await act(async () => { await latest?.createCategory(); });

    expect(g.commit).not.toHaveBeenCalled();
    expect(g.saveAppOverride).not.toHaveBeenCalled();
    expect(g.onError).toHaveBeenCalledWith(CATEGORY_ADMIN_COPY["zh-CN"].duplicateName);
  });

  it("ca03_an_empty_answer_does_not_commit", async () => {
    g.prompt.mockResolvedValue("   ");
    await mount();

    await act(async () => { await latest?.createCategory(); });

    expect(g.commit).not.toHaveBeenCalled();
  });

  it("ca04_cancelling_the_prompt_does_not_commit", async () => {
    g.prompt.mockResolvedValue(null);
    await mount();

    await act(async () => { await latest?.createCategory(); });

    expect(g.commit).not.toHaveBeenCalled();
  });
});

describe("删除分类", () => {
  const CUSTOM = "custom:category_old" as const;

  it("ca05_the_batch_contains_the_member_fallback_and_the_four_cleanup_keys", async () => {
    g.confirm.mockResolvedValue(true);
    g.loadAppOverrides.mockResolvedValue({
      "code.exe": { enabled: true, category: CUSTOM, updatedAt: 1 },
      "steam.exe": { enabled: true, category: "game", updatedAt: 2 },
    });
    await mount("browser");

    await act(async () => { await latest?.deleteCategory(CUSTOM); });

    /* 二次确认：文案里必须说清"应用会回到其他" */
    expect(g.confirm).toHaveBeenCalledTimes(1);
    expect(g.confirm.mock.calls[0]?.[0]).toMatchObject({
      title: expect.any(String),
      danger: true,
    });
    expect(String(g.confirm.mock.calls[0]?.[0]?.description)).toContain(
      CATEGORY_ADMIN_COPY["zh-CN"].deleteFallback,
    );

    expect(g.commit).toHaveBeenCalledTimes(1);
    const keys = (g.commit.mock.calls[0]?.[0] ?? []).map((row) => row.key);
    expect(keys).toContain("__app_override::code.exe");
    expect(keys).not.toContain("__app_override::steam.exe");
    expect(keys).toContain(`__custom_category::${CUSTOM}`);
    expect(keys).toContain(`__deleted_category::${CUSTOM}`);
    expect(keys).toContain(`__category_label_override::${CUSTOM}`);
    expect(keys).toContain(`__category_default_color_assignment::${CUSTOM}`);
    expect(g.invalidateBootstrapCache).toHaveBeenCalledTimes(1);
  });

  it("ca06_deleting_the_current_category_falls_the_row_back_to_other", async () => {
    g.confirm.mockResolvedValue(true);
    await mount(CUSTOM);

    await act(async () => { await latest?.deleteCategory(CUSTOM); });

    /* 当前应用正属于被删分类 → 必须把 category 从 override 里去掉（= 回落到「其他」） */
    expect(g.saveAppOverride).toHaveBeenCalledTimes(1);
    expect(g.saveAppOverride.mock.calls[0]?.[1]).toBeNull();
    expect(g.onAssigned).toHaveBeenCalledWith(null, "other");
  });

  it("ca07_cancelling_the_confirmation_writes_nothing", async () => {
    g.confirm.mockResolvedValue(false);
    await mount();

    await act(async () => { await latest?.deleteCategory(CUSTOM); });

    expect(g.commit).not.toHaveBeenCalled();
    expect(g.saveAppOverride).not.toHaveBeenCalled();
  });
});
