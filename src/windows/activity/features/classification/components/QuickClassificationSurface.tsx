import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, } from "react";
import { createPortal } from "react-dom";
import type {
  QuickClassificationItemBinding,
  QuickClassificationOpenRequest,
  QuickClassificationTarget,
} from "../types.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs.tsx";
import QuickClassificationCategoryMenu, { focusMenuItem } from "./QuickClassificationCategoryMenu.tsx";
import QuickClassificationItemBindingMenu from "./QuickClassificationItemBindingMenu.tsx";
import QuickClassificationRenameDialog from "./QuickClassificationRenameDialog.tsx";
import { useQuickClassificationCategoryAdmin } from "../hooks/useQuickClassificationCategoryAdmin.ts";
import {
  ClassificationService,
  type ClassificationBootstrapData,
} from "../services/classificationService.ts";
import {
  buildQuickClassificationCategoryOptions,
  buildQuickClassificationOverride,
  isQuickClassificationUnclassified,
  resolveQuickClassificationOverride,
  saveQuickClassificationOverride,
  type QuickClassificationCategoryOption,
  type QuickClassificationOverride,
} from "../services/quickClassification.ts";

interface Props {
  request: QuickClassificationOpenRequest;
  onClose: (focusTarget?: HTMLElement) => void;
  onSaved: (
    target: QuickClassificationTarget,
    override: QuickClassificationOverride | null,
  ) => void;
  onError: (message: string) => void;
  /**
   * [0.12.1] 可选的第二栏「绑定事项」。**不传时本组件逐字等于现状**
   * （数据页 / 历史页两处调用方都不传）。传了也只是多一个菜单项：
   * 选中写一条 KV（或清除），不开始计时、不改追踪。
   */
  itemBinding?: QuickClassificationItemBinding;
}

const MENU_MARGIN = 12;

function resolveAdjacentPageFocusTarget(trigger: HTMLElement, backwards: boolean) {
  const focusable = Array.from(document.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(","))).filter((element) => (
    !element.closest(".quick-classification-menu")
    && !element.closest(".qp-dialog-backdrop")
    && element.getClientRects().length > 0
  ));
  const triggerIndex = focusable.indexOf(trigger);
  if (triggerIndex < 0) return trigger;
  return focusable[triggerIndex + (backwards ? -1 : 1)] ?? trigger;
}

export default function QuickClassificationSurface({
  request,
  onClose,
  onSaved,
  onError,
  itemBinding,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const { anchor, returnFocusTo, target } = request;
  const menuRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [position, setPosition] = useState({ left: anchor.clientX, top: anchor.clientY });
  const [categoryOptions, setCategoryOptions] = useState<QuickClassificationCategoryOption[]>([]);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(target.displayName);
  const [currentOverride, setCurrentOverride] = useState<QuickClassificationOverride | null>(null);
  const [deletedCategories, setDeletedCategories] = useState<ClassificationBootstrapData["loadedDeletedCategories"]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryLoadFailed, setCategoryLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /* [本轮] 分类是要能变的：删掉用户当前所属的自定义分类之后，勾选必须落到「其他」。
     原先这里是 `const currentCategory = target.category`（常量）—— 那只够读，不够改。 */
  const [currentCategory, setCurrentCategory] = useState<AppCategory>(target.category);
  /* 分类增删的提示框 / 确认框：复用仓里的 `useQuietDialogs`（映射页同一套） */
  const dialogs = useQuietDialogs();

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(MENU_MARGIN, Math.min(anchor.clientX, window.innerWidth - bounds.width - MENU_MARGIN)),
      top: Math.max(MENU_MARGIN, Math.min(anchor.clientY, window.innerHeight - bounds.height - MENU_MARGIN)),
    });
  }, [anchor.clientX, anchor.clientY]);

  useEffect(() => {
    let active = true;
    void ClassificationService.loadClassificationBootstrap().then((bootstrap) => {
      if (!active) return;
      const resolvedOverride = resolveQuickClassificationOverride(bootstrap, target);
      setCategoryOptions(buildQuickClassificationCategoryOptions(bootstrap, UI_TEXT, locale));
      setDeletedCategories(bootstrap.loadedDeletedCategories);
      setCurrentOverride(resolvedOverride);
      setRenameValue(resolvedOverride?.displayName?.trim() || target.displayName);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoading(false);
      setCategoryLoadFailed(true);
      onErrorRef.current(UI_TEXT.mapping.loadFailed);
    });
    return () => {
      active = false;
    };
  }, [UI_TEXT, locale, target]);

  useEffect(() => {
    if (renameOpen) return;
    const frame = window.requestAnimationFrame(() => focusMenuItem(menuRef.current, 0));
    const closeFromViewportChange = () => onClose();
    const closeFromExternalScroll = (event: Event) => {
      const scrollTarget = event.target;
      if (
        scrollTarget instanceof Node
        && (menuRef.current?.contains(scrollTarget) || categoryMenuRef.current?.contains(scrollTarget))
      ) {
        return;
      }
      onClose();
    };
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", closeFromOutside, true);
    window.addEventListener("resize", closeFromViewportChange);
    window.addEventListener("scroll", closeFromExternalScroll, true);
    window.addEventListener("blur", closeFromViewportChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeFromOutside, true);
      window.removeEventListener("resize", closeFromViewportChange);
      window.removeEventListener("scroll", closeFromExternalScroll, true);
      window.removeEventListener("blur", closeFromViewportChange);
    };
  }, [onClose, renameOpen]);
  /* [本轮] 子菜单的摆位/焦点已随它搬进 `QuickClassificationCategoryMenu`；根菜单仍在这里定位。 */

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      onClose(returnFocusTo
        ? resolveAdjacentPageFocusTarget(returnFocusTo, event.shiftKey)
        : undefined);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (categoryMenuOpen) {
        setCategoryMenuOpen(false);
        categoryTriggerRef.current?.focus();
      } else {
        onClose();
      }
      return;
    }
    if (event.key === "ArrowLeft" && categoryMenuOpen) {
      event.preventDefault();
      setCategoryMenuOpen(false);
      categoryTriggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const container = categoryMenuOpen && categoryMenuRef.current?.contains(document.activeElement)
        ? categoryMenuRef.current
        : menuRef.current;
      const items = Array.from(container?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])") ?? []);
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      focusMenuItem(container, currentIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const container = categoryMenuOpen && categoryMenuRef.current?.contains(document.activeElement)
        ? categoryMenuRef.current
        : menuRef.current;
      const itemCount = container?.querySelectorAll("[role^='menuitem']:not([disabled])").length ?? 0;
      focusMenuItem(container, event.key === "Home" ? 0 : itemCount - 1);
    }
  };

  const saveOverride = async (override: QuickClassificationOverride | null) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveQuickClassificationOverride(target, override);
      setCurrentOverride(override);
      onSaved(target, override);
      onClose();
    } catch {
      savingRef.current = false;
      setSaving(false);
      onErrorRef.current(UI_TEXT.mapping.quickSaveFailed);
    }
  };

  const saveCategory = (option: QuickClassificationCategoryOption) => {
    void saveOverride(buildQuickClassificationOverride(
      target,
      currentOverride,
      { category: option.value },
    ));
  };

  const submitRename = (displayName: string) => {
    if (savingRef.current) return;
    void saveOverride(buildQuickClassificationOverride(
      target,
      currentOverride,
      { displayName },
    ));
  };

  const currentDisplayName = currentOverride?.displayName?.trim() ?? "";
  const hasValidCategory = !isQuickClassificationUnclassified(
    currentCategory,
    deletedCategories,
  );

  /* [本轮] 分类增删的编排全在这个 hook 里（本文件只能减不能加）；这里只收回状态。 */
  const categoryAdmin = useQuickClassificationCategoryAdmin({
    target,
    currentOverride,
    options: categoryOptions,
    dialogs,
    onOptionsChange: setCategoryOptions,
    onAssigned: (override, category) => {
      setCurrentOverride(override);
      setCurrentCategory(category);
      onSaved(target, override);
    },
    onError: (message) => onErrorRef.current(message),
  });

  const menu = (
    <>
      {!renameOpen ? (
        <div
          ref={menuRef}
          className="quick-classification-menu qp-motion-overlay-enter"
          role="menu"
          aria-label={UI_TEXT.mapping.quickMenuLabel(target.displayName)}
          style={{ left: position.left, top: position.top }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            className="quick-classification-menu-item"
            role="menuitem"
            disabled={loading || categoryLoadFailed || saving}
            onClick={() => setRenameOpen(true)}
          >
            <span>{UI_TEXT.mapping.quickRename}</span>
          </button>
          <button
            ref={categoryTriggerRef}
            type="button"
            className="quick-classification-menu-item"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={categoryMenuOpen}
            disabled={categoryLoadFailed || saving}
            onClick={() => setCategoryMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight") return;
              event.preventDefault();
              setCategoryMenuOpen(true);
            }}
          >
            <span>
              {categoryLoadFailed
                ? UI_TEXT.mapping.loadFailed
                : hasValidCategory
                  ? UI_TEXT.mapping.quickChangeCategory
                  : UI_TEXT.mapping.quickSetCategory}
            </span>
          </button>
          {categoryMenuOpen && !loading ? (
            <QuickClassificationCategoryMenu
              menuRef={categoryMenuRef}
              rootMenuRef={menuRef}
              options={categoryOptions}
              currentCategory={currentCategory}
              disabled={saving || categoryAdmin.busy}
              onPick={saveCategory}
              onCreate={() => { void categoryAdmin.createCategory(); }}
              onDelete={(category) => { void categoryAdmin.deleteCategory(category); }}
            />
          ) : null}
          {/* [0.12.1] 可选的第三项：只在调用方传了 `itemBinding` 时出现。
              不传 → 这里渲染 null，根菜单与键盘序完全等于旧形态。 */}
          {itemBinding ? (
            <QuickClassificationItemBindingMenu
              binding={itemBinding}
              disabled={saving}
              onError={(message) => onErrorRef.current(message)}
            />
          ) : null}
        </div>
      ) : null}
      <QuickClassificationRenameDialog
        open={renameOpen}
        saving={saving}
        value={renameValue}
        currentDisplayName={currentDisplayName}
        fallbackName={target.displayName}
        onChange={setRenameValue}
        onSubmit={() => submitRename(renameValue)}
        onClose={() => onClose()}
      />
      {/* [本轮] 新建分类的输入框 / 删除分类的确认框（`useQuietDialogs` 自己 portal 到 body） */}
      {dialogs.dialogs}
    </>
  );

  return typeof document === "undefined" ? null : createPortal(menu, document.body);
}
