import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { Check } from "lucide-react";

import {
  isExtendedCategory,
  type AppCategory,
  type ExtendedAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { QuickClassificationCategoryOption } from "../services/quickClassification.ts";

/**
 * 快捷分类弹层的「改分类」子菜单（[本轮] 从 `QuickClassificationSurface` 整块搬出来）。
 *
 * ## 搬家的理由
 *
 * `QuickClassificationSurface.tsx` 贴着单文件 300 行硬限（冻结基线 385、现在 364，
 * **只许减不许加**）。这一块（选项列表 + 定位 + 焦点）正好自成一体，搬出来之后
 * 新增的「＋ 新建分类 / 删除」才有地方放。
 *
 * ## 搬家的纪律：行为一字不改
 *
 * 选项列表的类名（`quick-classification-category-item`）、`role="menuitemradio"`、
 * 勾选图标、禁用口径（`saving`）、定位算法（`MENU_MARGIN` / `SUBMENU_GAP` / 右边缘翻边）
 * 与"打开时把焦点落到当前分类"**逐字保留**。唯一改动是定位与焦点从 `Surface` 的
 * `useLayoutEffect` 里搬到了本组件内部（它的输入 `rootMenuRef` 由调用方传进来）。
 *
 * ## 新增的两件事只**加**在选择列表之后
 *
 * 删除键与「＋ 新建分类」都排在**所有 `menuitemradio` 之后**：`focusMenuItem` 是**按序号**
 * 在容器里找 `[role^='menuitem']`，把新键插在中间会让"打开时焦点落在当前分类"错位
 * （落到下一行，看起来像勾错了）。所以选项列表的序号前缀不变，新键追加在尾部。
 *
 * 删除键**只给自定义分类**（`custom:` 前缀）。内置 11 个分类不画这颗键 ——
 * 它们可以被"隐藏"（`deletedCategories`），但定义不能删：`other` 是所有回落的目标。
 */

const MENU_MARGIN = 12;
const SUBMENU_GAP = 2;

/**
 * 把焦点按序号落到容器里的第 n 个可聚焦菜单项（环形）。
 *
 * 两个菜单（根菜单 / 分类子菜单）必须同一套键盘序，所以从这里导出：
 * `QuickClassificationSurface` 的根菜单也用这一个实现，别各写一份。
 */
export function focusMenuItem(container: HTMLElement | null, index: number) {
  const items = container?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])");
  if (!items?.length) return;
  items[(index + items.length) % items.length]?.focus();
}

interface Props {
  /** 分类子菜单自身的容器（`Surface` 的 `categoryMenuRef`，方向键与 Escape 要用它） */
  menuRef: RefObject<HTMLDivElement | null>;
  /** 根菜单容器：子菜单相对它定位（右边缘放不下就翻到左边） */
  rootMenuRef: RefObject<HTMLDivElement | null>;
  options: readonly QuickClassificationCategoryOption[];
  currentCategory: AppCategory;
  /** 正在保存 / 正在增删分类：全部按键禁用（菜单不卸载，焦点不丢） */
  disabled: boolean;
  onPick: (option: QuickClassificationCategoryOption) => void;
  onCreate: () => void;
  onDelete: (category: ExtendedAppCategory) => void;
}

export default function QuickClassificationCategoryMenu({
  menuRef,
  rootMenuRef,
  options,
  currentCategory,
  disabled,
  onPick,
  onCreate,
  onDelete,
}: Props) {
  const UI_TEXT = useLocaleText();
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const rootMenu = rootMenuRef.current;
    const categoryMenu = menuRef.current;
    if (!rootMenu || !categoryMenu) return;
    const rootBounds = rootMenu.getBoundingClientRect();
    const categoryBounds = categoryMenu.getBoundingClientRect();
    const opensLeft = rootBounds.right + SUBMENU_GAP + categoryBounds.width + MENU_MARGIN > window.innerWidth;
    setPosition({
      left: opensLeft
        ? Math.max(MENU_MARGIN, rootBounds.left - SUBMENU_GAP - categoryBounds.width)
        : Math.min(window.innerWidth - categoryBounds.width - MENU_MARGIN, rootBounds.right + SUBMENU_GAP),
      top: Math.max(
        MENU_MARGIN,
        Math.min(rootBounds.top, window.innerHeight - categoryBounds.height - MENU_MARGIN),
      ),
    });
    /* `options` 进依赖：增删分类之后候选变了、菜单高度也变了，需要重新摆一次 */
  }, [menuRef, options, rootMenuRef]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const selectedIndex = options.findIndex((option) => option.value === currentCategory);
      focusMenuItem(menuRef.current, selectedIndex >= 0 ? selectedIndex : 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentCategory, menuRef, options]);

  const customOptions = options.filter((option) => isExtendedCategory(option.value));

  return (
    <div
      ref={menuRef}
      className="quick-classification-menu quick-classification-category-menu qp-scroll-region"
      role="menu"
      aria-label={UI_TEXT.mapping.quickCategoryMenuLabel}
      style={{ left: position.left, top: position.top }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="quick-classification-menu-item quick-classification-category-item"
          role="menuitemradio"
          aria-checked={option.value === currentCategory}
          disabled={disabled}
          onClick={() => onPick(option)}
        >
          <span className="quick-classification-menu-check" aria-hidden="true">
            {option.value === currentCategory ? <Check size={14} /> : null}
          </span>
          <span>{option.label}</span>
        </button>
      ))}

      {/* 删除区只在**有自定义分类**时出现：一个只有内置分类的用户不该看到一块空标题。
          必须是 `role="group"` 而不是散在菜单里 —— 读屏要能说清这是"删除分类"这一组。 */}
      {customOptions.length > 0 ? (
        <div
          className="quick-classification-category-manage"
          role="group"
          aria-label={UI_TEXT.mapping.deleteCategoryTitle}
        >
          {customOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="quick-classification-menu-item quick-classification-category-delete"
              role="menuitem"
              /* 测试与将来的键盘扩展都按这个锚点找（不要按文案找：四语言各一份） */
              data-qp-delete-category={option.value}
              disabled={disabled}
              onClick={() => onDelete(option.value as ExtendedAppCategory)}
            >
              {UI_TEXT.mapping.deleteCategory(option.label)}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="quick-classification-menu-item quick-classification-category-create"
        role="menuitem"
        data-qp-create-category=""
        disabled={disabled}
        onClick={onCreate}
      >
        ＋ {UI_TEXT.mapping.createCategoryAction}
      </button>
    </div>
  );
}
