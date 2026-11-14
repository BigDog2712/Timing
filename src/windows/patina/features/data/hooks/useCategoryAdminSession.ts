import { useCallback, useEffect, useRef, useState } from "react";

import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import {
  ClassificationService,
  type ClassificationBootstrapData,
} from "../../classification/services/classificationService.ts";
import { APP_EDIT_COPY } from "../appEditCopy.ts";
import { buildAppEditCategoryOptions, collectAppEditCategoryUsage } from "../services/categoryCatalog.ts";
import {
  useAppEditCategoryAdmin,
  type AppEditCategoryOption,
} from "./useAppEditCategoryAdmin.ts";

/**
 * 独立打开的「分类管理」会话：自己读一份 bootstrap，自己驱动增删改查（[本轮]）。
 *
 * ## 为什么不用 `useAppEditDialog`
 *
 * 那个 hook 的职责是"读**某一个应用**的 override、改草稿、保存一整条 override"——它的
 * 入参必须是一个应用（`target`），返回的 `canSave` / `draft` 也全是应用语义。数据页的分类
 * tab 上并没有"某个应用"，硬塞一个假 target 会顺手把那条应用的设置读出来（读失败还会
 * 弹「读取这个应用的设置失败」），且保存键会去写一份空 override。
 *
 * 所以这里只要"分类定义这一层"：候选、用量、已删清单 —— 与 `useAppEditDialog` 共用同一个
 * 派生件（`services/categoryCatalog.ts`）与同一套写路径
 * （`useAppEditCategoryAdmin`），**没有第二份实现**。
 *
 * ## `onChanged` 为什么必要
 *
 * 分类增删改之后，页面上的趋势图仍按旧分类渲染（颜色 / 排行 / 有没有这一类）。所以每次写成功
 * 都要给页面一个"该重新取数了"的信号；`refreshBootstrap` 只作废了分类缓存的候选清单，
 * 管不到页面的读模型。
 */
export interface CategoryAdminSessionState {
  loading: boolean;
  error: string | null;
  /** 正在写库（按钮禁用 / 改名弹窗转圈） */
  managing: boolean;
  options: AppEditCategoryOption[];
  usage: Record<string, number>;
  createCategory: (label: string, color: string | null) => Promise<void>;
  renameCategory: (category: AppCategory, label: string) => Promise<void>;
  recolorCategory: (category: AppCategory, color: string | null) => Promise<void>;
  deleteCategory: (category: AppCategory) => Promise<void>;
  dialogsElement: ReturnType<typeof useAppEditCategoryAdmin>["dialogsElement"];
}

export function useCategoryAdminSession({
  onChanged,
}: {
  /** 任何一次写成功之后的回调（页面据此重新取数）；不传则只刷新本会话的候选清单 */
  onChanged?: () => void;
} = {}): CategoryAdminSessionState {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const copy = APP_EDIT_COPY[locale];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [options, setOptions] = useState<AppEditCategoryOption[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  /* 回调可能在下次渲染时变（页面没 memo）：异步写完之后必须调**最新**的那一个 */
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const applyBootstrap = useCallback((bootstrap: ClassificationBootstrapData) => {
    setOptions(buildAppEditCategoryOptions(bootstrap, UI_TEXT, locale));
    setUsage(collectAppEditCategoryUsage(bootstrap));
  }, [UI_TEXT, locale]);

  const refreshBootstrap = useCallback(async () => {
    /* 必须作废缓存：`classificationBootstrapCache` 会把"没有新分类"的那一份还回来，
       于是新建完的分类在自己的列表里看不见 */
    ClassificationService.invalidateBootstrapCache();
    applyBootstrap(await ClassificationService.loadClassificationBootstrap());
  }, [applyBootstrap]);

  useEffect(() => {
    /* ## 这里**故意没有** `loadedRef` 守卫（别加回来）
     *
     * 曾经的写法是「`if (loadedRef.current) return; loadedRef.current = true;` + 下面这个
     * `active` 作废」，两者放在一起会**在 dev 下永久停在"加载中"**：
     *
     *   · `shell/main.tsx` 挂着 `<StrictMode>`，dev 里 effect 会被 setup → cleanup → setup
     *     跑两遍（本仓测试默认不用 StrictMode、生产构建也不双调用，所以测试与 CI 都抓不到）；
     *   · setup1 把 `loadedRef` 置 true 并**发起唯一一次**异步加载，`active1 = true`；
     *   · cleanup1 把 `active1` 置 false；
     *   · setup2 被 `loadedRef` 挡掉 —— 既不再发起加载，也**不再持有 cleanup**；
     *   · 那次异步 resolve 时 `active1` 已是 false，`setLoading(false)` 被跳过。
     *   于是 `loading` 永远是 true，弹窗永远是"加载中"。
     *
     * 去掉守卫是安全的：`ClassificationService.loadClassificationBootstrap` 自带 in-flight
     * 去重（`classificationBootstrapInFlight`）与缓存（`getClassificationBootstrapCache`），
     * 双调用不会打两次 IPC，第二次拿到的就是同一个 promise；卸载后 `setState` 是 no-op，
     * 所以 `active` 仍然留着防"组件已经没了还 setState"。
     *
     * 守门的用例：`components/DataCategoryManageStrictMode.test.tsx`（把本 hook 的消费方
     * 包在**根级** `<StrictMode>` 里，断言加载会结束、分类行会出现）。 */
    let active = true;
    void (async () => {
      try {
        const bootstrap = await ClassificationService.loadClassificationBootstrap();
        if (!active) return;
        applyBootstrap(bootstrap);
      } catch {
        if (!active) return;
        setError(copy.loadFailed);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyBootstrap, copy.loadFailed]);

  const admin = useAppEditCategoryAdmin({
    categoryOptions: options,
    categoryUsage: usage,
    refreshBootstrap,
    /* 独立会话没有"草稿"要顺手勾上 / 摘掉：新建完它就是列表里的一行 */
    onCreated: () => undefined,
    onDeleted: () => undefined,
    onError: setError,
    onManagingChange: setManaging,
  });

  /* 先拆成局部常量再包：依赖数组要写**函数本身**，写 `admin.xxx` 会让 eslint 认为
     依赖了整个 `admin` 对象（它每帧都是新对象，等于每帧重建四个回调） */
  const {
    createCategory: adminCreate,
    renameCategory: adminRename,
    recolorCategory: adminRecolor,
    deleteCategory: adminDelete,
    dialogsElement,
  } = admin;

  /* 四个写操作各包一层：写完（含被拒 / 失败）无条件通知页面重取数。
     为什么不判"这次到底写了没有"：判据得从 `useAppEditCategoryAdmin` 里透出来（它现在
     返回 `Promise<void>`，重名 / 空名都是提前 return），为一个"多取一次数"的优化去改那条
     被两处共用的签名不划算。反过来漏发是用户看得见的错（写了库但列表还按旧分类渲染），
     多发一次只是多一条只读查询。 */
  const createCategory = useCallback(async (label: string, color: string | null) => {
    await adminCreate(label, color);
    changedRef.current?.();
  }, [adminCreate]);

  const renameCategory = useCallback(async (category: AppCategory, label: string) => {
    await adminRename(category, label);
    changedRef.current?.();
  }, [adminRename]);

  const recolorCategory = useCallback(async (category: AppCategory, color: string | null) => {
    await adminRecolor(category, color);
    changedRef.current?.();
  }, [adminRecolor]);

  const deleteCategory = useCallback(async (category: AppCategory) => {
    await adminDelete(category);
    changedRef.current?.();
  }, [adminDelete]);

  return {
    loading,
    error,
    managing,
    options,
    usage,
    createCategory,
    renameCategory,
    recolorCategory,
    deleteCategory,
    dialogsElement,
  };
}
