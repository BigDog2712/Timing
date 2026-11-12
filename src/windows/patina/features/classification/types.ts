import type { AppCategory } from "../../shared/classification/categoryTokens.ts";
import { AppClassification } from "../../shared/classification/appClassification.ts";

export type CandidateFilter = "all" | "other" | "classified" | "excluded";
export type { ObservedAppCandidate } from "./services/classificationStore";

interface QuickAppClassificationTarget {
  kind: "app";
  exeName: string;
  displayName: string;
  category: AppCategory;
}

interface QuickWebClassificationTarget {
  kind: "web";
  normalizedDomain: string;
  displayName: string;
  category: AppCategory;
}

export type QuickClassificationTarget =
  | QuickAppClassificationTarget
  | QuickWebClassificationTarget;

export interface QuickClassificationAnchor {
  clientX: number;
  clientY: number;
}

export interface QuickClassificationOpenRequest {
  target: QuickClassificationTarget;
  anchor: QuickClassificationAnchor;
  returnFocusTo: HTMLElement | null;
}

/** 「绑定事项」那一栏里**按语言变**的所有串（由调用方注入，见 `itemBinding.labels`） */
export interface QuickClassificationItemBindingLabels {
  /** 根菜单里的入口名（「绑定事项」） */
  entry: string;
  /** 事项清单首项（「不绑定」= 清除） */
  none: string;
  /** 事项子菜单的 `aria-label` */
  menuLabel: string;
  /** 清单读取失败时的降级文案（**只**降级这一栏） */
  loadFailed: string;
  /** 清单为空（一条事项都还没有） */
  empty: string;
  /** 保存失败（写 KV 抛错） */
  saveFailed: string;
}

/** 可选事项（`listTimingItems()` 的全量未归档事项） */
export interface QuickClassificationItemOption {
  id: number;
  name: string;
  color?: string;
}

/**
 * 弹层里的第二栏：把「这个应用平时在做哪件事」记下来（0.12.1）。
 *
 * 这是**可选**属性 —— 不传时弹层逐字等于现状（数据页 / 历史页两处调用方零改动）。
 * 语义上它只有两件事：写一个 `itemId`（或 `null` 清除），以及读一份候选清单；
 * 本轮**不**做自动归因、**不**做「用该事项开始计时」。
 */
export interface QuickClassificationItemBinding {
  /** 当前绑定（`null` = 未绑定） */
  itemId: number | null;
  items: readonly QuickClassificationItemOption[];
  /** 清单读取失败：菜单项仍可点，点开显示「暂时读不到事项」，不影响分类/改名 */
  loadFailed: boolean;
  labels: QuickClassificationItemBindingLabels;
  /** 选中即保存；抛错由弹层转给 `onError` */
  onSave: (itemId: number | null) => Promise<void>;
}

export function createQuickAppClassificationTarget({
  exeName,
  displayName,
  category,
}: Omit<QuickAppClassificationTarget, "kind">): QuickAppClassificationTarget {
  const normalizedExeName = exeName.trim();
  if (!normalizedExeName) {
    throw new Error("Quick app classification requires a non-empty executable name");
  }
  return {
    kind: "app",
    exeName: AppClassification.resolveStatisticalApp(normalizedExeName),
    displayName: displayName.trim() || normalizedExeName,
    category,
  };
}

export function createQuickWebClassificationTarget({
  normalizedDomain,
  displayName,
  category,
}: Omit<QuickWebClassificationTarget, "kind">): QuickWebClassificationTarget {
  const normalizedKey = normalizedDomain.trim().replace(/\.$/, "").toLocaleLowerCase();
  if (!normalizedKey) {
    throw new Error("Quick web classification requires a non-empty normalized domain");
  }
  return {
    kind: "web",
    normalizedDomain: normalizedKey,
    displayName: displayName.trim() || normalizedKey,
    category,
  };
}

export function getQuickClassificationTargetKey(target: QuickClassificationTarget): string {
  return target.kind === "app"
    ? `app:${target.exeName}`
    : `web:${target.normalizedDomain}`;
}

export function resolveQuickClassificationElementAnchor(
  element: HTMLElement,
): QuickClassificationAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
  };
}
