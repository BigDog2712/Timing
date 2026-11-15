(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";

/**
 * 分类管理那四个测试文件共用的**纯**查询/夹具（不含 `vi.mock`）。
 *
 * 为什么不含 mock：`vi.mock` 是按文件提升的，放在这里 mock 只会挂在一个没人 import 的
 * 模块上（那种假绿最难查）。所以每个测试文件自己写那一段 `vi.hoisted` + `vi.mock`，
 * 这里只放"怎么查 DOM、怎么等一次微任务、bootstrap 长什么样"。
 */
/** 自定义分类的 id（`custom:` 前缀 = 可删；内置 11 类不可删） */
export const CUSTOM = "custom:1720000000000";

/** 一棵最小的 bootstrap：2 个内置分类 + 1 个自定义分类（各 1 个成员 = 用量 1） */
export function bootstrapFixture() {
  return {
    loadedAppLinks: {},
    observedWebDomains: [],
    loadedOverrides: {
      "code.exe": {
        category: "development",
        categories: ["development", CUSTOM],
        displayName: "Code",
        enabled: true,
        updatedAt: 1,
      },
      "figma.exe": { category: "design", displayName: "Figma", enabled: true, updatedAt: 1 },
    },
    loadedWebDomainOverrides: {},
    loadedCategoryColorOverrides: {},
    loadedCategoryLabelOverrides: { [CUSTOM]: "我的项目" },
    loadedPersistedCategoryIds: [CUSTOM],
    loadedDeletedCategories: [],
  };
}

/** 冲几轮微任务：一次点击里往往串着"读库 → 提交 → 重读"三段 promise */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** 挂一棵树（统一包 `LocaleProvider`：组件里全是 `useLocaleText()`） */
export function mount(root: Root, element: ReactElement): Promise<void> {
  act(() => root.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })));
  return flush();
}

export function createTestContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.id = "root-host";
  document.body.appendChild(container);
  return container;
}

/* `QuietDialog` 是 portal 到 body 的，所以查询一律从 `document.body` 上做 */
export const manageDialog = () => document.body.querySelector<HTMLElement>(".qp-category-manage-dialog");
export const entryButton = () => document.body.querySelector<HTMLButtonElement>(".data-category-manage-action");
export const categoryRow = (category: string) =>
  manageDialog()?.querySelector<HTMLElement>(`[data-category="${category}"]`) ?? null;
/** `QuietIconAction` 把可读名字放在 `aria-label` 上（不是 `title` 属性） */
export const renameButton = (category: string) =>
  categoryRow(category)?.querySelector<HTMLButtonElement>("button[aria-label^='重命名分类']") ?? null;
export const deleteButton = (category: string) =>
  categoryRow(category)?.querySelector<HTMLButtonElement>("button[aria-label^='删除分类']")
  ?? categoryRow(category)?.querySelector<HTMLButtonElement>(".qp-icon-action-danger")
  ?? null;

/** 确认框是最后一个 dialog（弹窗层里它总在最上面），确认键是 actions 里的最后一颗 */
export function confirmButton(): HTMLButtonElement | null {
  const dialogs = Array.from(document.body.querySelectorAll<HTMLElement>(".qp-dialog-surface"));
  const actions = Array.from(
    dialogs[dialogs.length - 1]?.querySelectorAll<HTMLButtonElement>(".qp-dialog-actions button") ?? [],
  );
  return actions[actions.length - 1] ?? null;
}

/** 把提交出去的 mutation 拍平成 `key → value`：[{key,value}] 数组 */
export function committedRows(commit: { mock: { calls: unknown[][] } }): { key: string; value: string | null }[] {
  return commit.mock.calls.flatMap((call) => (call[0] as { key: string; value: string | null }[]));
}

/** 同上，但拍成一行字符串，失败时的报错直接能看到"到底写了哪几条" */
export function typedValue(commit: { mock: { calls: unknown[][] } }): string {
  return committedRows(commit).map((row) => `${row.key}=${String(row.value)}`).join(" | ");
}

/** 受控 input：React 19 只认原生 setter + `input` 事件，直接改 `.value` 不会触发 onChange */
export function typeInto(input: HTMLInputElement | null | undefined, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
