import { useCallback, useEffect, useRef, useState } from "react";

import { isAnonymousActivity } from "../../../shared/classification/anonymousActivity.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { DataDestinationTrendOption } from "../services/dataDestinationState.ts";

/**
 * 应用趋势列表行的「单击选中 / 双击编辑」共存（[本轮]）。
 *
 * ## 为什么要"推迟选中"而不是"先选中再还原"
 *
 * 浏览器对一次双击派发的事件序列是 `click(detail=1) → click(detail=2) → dblclick`。
 * 直接照旧在 `onClick` 里切选中，双击必然先把选中态翻两次 —— 用户只是想改分类，
 * 顺手把左侧已选应用全换掉了。两种修法（还原快照 / 推迟选中）里选后者：
 *   · 还原快照需要把"还原任意多选集"塞回父组件（`Data.tsx` 的选中状态在那边），
 *     等于为此扩一条只有这一个消费者用的接口；
 *   · 推迟选中只在本组件内部改时序：第一下 click 起一个**短窗**定时器，
 *     双击到达就取消它 —— 选中一次都没发生，天然不需要还原。
 * 代价是单击选中晚 `DOUBLE_CLICK_WINDOW_MS` 生效。因此它**只在应用趋势里启用**
 * （只有这一页的双击有第二语义）；分类 / 网页两种模式的单击仍是立即生效，行为零变化。
 *
 * ## 为什么窗口是 260ms，以及超过窗口的慢速双击怎么办（[修复 D-2]）
 *
 * 260ms 覆盖不了"慢速双击"：Windows 默认双击阈值是 500ms，用户在 300ms 间隔里点两下
 * 同一行，浏览器**仍然**派发 `dblclick`，而 260ms 的定时器早就跑完了 —— 于是"只想改分类"
 * 的动作顺手把选中翻了一次。窗口一旦短于浏览器判定双击的间隔，这个漏洞就无法靠"取消
 * 定时器"补（定时器已经触发过），只能事后**补偿**。
 *
 * 所以本文件只记一笔账：`burstRef` 记下这一串点击**开始之前**的选中集快照。`dblclick`
 * 到达时拿当前集合与快照做**集合比较**（顺序无关），不等就发**一条**命令把整份快照写回去。
 *
 * 判据为什么是"集合差"而不是"被点那行翻了几次"（[修复 D-2 第三次返工]）：单击是 `replace`
 * 语义 —— 选着 a/b/c 时单击 c，c 的成员资格**一点没变**（翻动 0 次 = 偶数），但集合从三项
 * 塌成一项，这正是最该补的那一次。按 key 记奇偶的判据在这里必然漏判，所以用集合差。
 * 幂等性不受影响：ctrl 点两下自己翻回来，净效果等于快照 → 集合相等 → 一个字都不写。
 *
 * 补偿走**直写接口** `onRestoreSelection(keys)`（`Data.tsx` 提供，经面板透传）：
 * 一条命令把整份快照写回去，不经过 `replace` / `toggle` 这两个"用户操作"动词 ——
 *   · `toggleDataDestinationSelection` 有 last-item 守卫（只剩一项时拒绝取消），
 *     而"单击替换"之后被双击那行往往正是唯一选中项，用 toggle 补会被挡掉，
 *     变成"什么都不发生 + 弹一条'至少保留一个'的警告"；
 *   · `replace` 只能表达"设成某一个"，多选（≥2）还原不了，而这正是主路径：
 *     用户多选几个应用看趋势、再双击其中一个编辑。
 * 未接线时（hook 单测独立跑）退回 `replace` 兜底：它对**空 key** 返回空集
 * （`dataDestinationState.ts`），所以"双击前什么都没选"能精确还原。
 *
 * ## 双击的两条分支不能混
 *
 * 行首图标的单击/双击是**既有**的"打开应用详情"入口（`data-destination-detail-trigger`），
 * 本轮不许动它。所以双击先判命中不命中那个锚点：命中走详情，没命中才开编辑弹窗。
 *
 * ## 分类模式**不套**这套补偿 —— 别顺手补上（[本轮] 把这条理由从测试注释搬进源码）
 *
 * 分类 tab（`manageableCategories`）的单击**本来就是立即 `replace`**（走 `canEdit` 为假那条
 * 分支：直接 `selectRef.current(...)`），既没有 260ms 窗口，也没有 `pendingRef` 挂起项，
 * 更没有 `burstRef` 快照。所以分类模式里：
 *
 *     双击 = 两次单击的净效果 = 选中换成这一行的那一类
 *
 * 这是**一次真实单击**的实际行为，不是误伤：分类选中只决定"画哪几条曲线"，没有守卫、
 * 没有提示、也不写库。所以双击分支里**不该**调 `restoreAfterSlowDoubleClick` ——
 * 这条路径压根没建过快照，硬补只会把"双击之后选中莫名跳回某个旧集合"引入进来
 * （`burstRef` 里留着的可能是上一次应用模式、甚至另一行的快照）。看代码的人容易以为
 * "这里漏了补偿"顺手补一行，补上的正是 bug。
 *
 * ## 只有"能编辑的行"才推迟
 *
 * `editable` 为假（分类/网页模式、匿名活动、没有 exeName）时，单击立即生效 ——
 * 不给这些行引入几十毫秒的无谓延迟。
 */
const DOUBLE_CLICK_WINDOW_MS = 260;

interface Params {
  /** 当前是否处于"双击可以编辑"的模式（= 应用趋势） */
  editable: boolean;
  /**
   * [本轮] 当前是否处于**分类** tab（双击一行 → 打开「分类管理」，见文件头最后一段）。
   *
   * 为什么不和 `editable` 合并成一个 `mode` 三态：`editable` 已经被四个测试与面板各自
   * 传着（真 / 假两种语义都是"能不能改这一行"），换签名会把"网页 tab 上双击什么都不做"
   * 这条既有行为一起改写。两个布尔在调用点上是同一行相邻参数，传错会立刻被渲染测试抓到。
   */
  manageableCategories?: boolean;
  supportsDestinationDetails: boolean;
  /**
   * 左侧已选的 key（面板的 `selectedOptions` 口径）。
   * 用途一：判断这一下点击是否真的改变了该行的选中状态（翻动计数）。
   * 用途二：双击补偿时要还原"这一串点击开始之前"的选中集，需要整份快照。
   */
  selectedKeys: readonly string[];
  onOptionSelect: (key: string, multi: boolean) => void;
  /**
   * 直写选中集（由 `Data.tsx` 提供，经面板透传）。缺省时退回到"一条 `replace` 命令"
   * 的兜底 —— 那条只能还原"空集 / 单个 key"，多选还原不了，所以生产路径必须接上它。
   */
  onRestoreSelection?: (keys: readonly string[]) => void;
  onOptionOpenDetails: (option: DataDestinationTrendOption) => void;
  /**
   * [0.12.4] 双击的"编辑"要落到哪里。传了它就不再往内建弹窗里塞 target ——
   * 应用趋势现在双击改**标签**（走 `Data.tsx` 的标签弹层），分类那套弹窗已从本页下线。
   * 不传时保留旧行为（`editing`），只为既有判据与"没有标签入口"的宿主兜底。
   */
  onEditOption?: (option: DataDestinationTrendOption) => void;
}

/**
 * 双击时要"编辑"的目标（[0.12.4] 起只在没有 `onEditOption` 的宿主上用到）。
 *
 * 以前这个形状定义在 `DataAppEditDialog` 里；那个弹窗（分类 + 应用设置）已经从应用趋势
 * 下线 —— 双击现在开标签弹窗（`Data.tsx` 的 `tagTarget`）。类型留在这里，是因为本 hook
 * 的 `editing` 仍是"没接 `onEditOption` 时"的兜底，判据也还在跑这条分支。
 */
export interface AppTrendEditTarget {
  exeName: string;
  displayName: string;
  category: AppCategory;
  iconUrl?: string;
}

export interface AppTrendRowEditState {
  /** 打开中的编辑弹窗目标（`null` = 关着） */
  editing: AppTrendEditTarget | null;
  closeEditor: () => void;
  /** 打开中的「分类管理」弹窗（分类 tab 的「管理分类」与双击分类行共用这一个开关） */
  categoryManageOpen: boolean;
  openCategoryManage: () => void;
  closeCategoryManage: () => void;
  /** 挂在每一行 `<button>` 上的三个处理器 */
  handlers: (option: DataDestinationTrendOption) => {
    onClick: (event: { detail: number; ctrlKey: boolean }) => void;
    onDoubleClick: (event: { target: EventTarget | null }) => void;
  };
}

export function useAppTrendRowEdit({
  editable,
  manageableCategories = false,
  supportsDestinationDetails,
  selectedKeys,
  onOptionSelect,
  onRestoreSelection,
  onOptionOpenDetails,
  onEditOption,
}: Params): AppTrendRowEditState {
  const [editing, setEditing] = useState<AppTrendEditTarget | null>(null);
  const [categoryManageOpen, setCategoryManageOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ key: string; multi: boolean } | null>(null);
  /* 回调与选中集都可能在下次渲染时变（父组件没 memo）：异步回调里必须读**最新**的 */
  const selectRef = useRef(onOptionSelect);
  selectRef.current = onOptionSelect;
  const openDetailsRef = useRef(onOptionOpenDetails);
  openDetailsRef.current = onOptionOpenDetails;
  const selectedKeysRef = useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;
  const restoreRef = useRef(onRestoreSelection);
  restoreRef.current = onRestoreSelection;
  /** 本次"点击 → 双击"序列**开始之前**的选中集（`dblclick` 补偿时还原到它） */
  const burstRef = useRef<{ key: string; before: readonly string[] } | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  /** 真正执行一次挂起的选中（选中集由父组件持有，这里只管把命令发出去） */
  const applySelect = useCallback((key: string, multi: boolean) => {
    selectRef.current(key, multi);
  }, []);

  /** 立刻兑现挂起的单击（"跨行连点"时上一行不能被静默吞掉 —— D-1） */
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    if (pending) applySelect(pending.key, pending.multi);
  }, [applySelect]);

  /**
   * 慢速双击的补偿：把选中集还原成这一串点击**开始之前**的快照。
   * 首选**直写接口**（`onRestoreSelection`，一条命令写整份集合，无守卫、无 toast、天然幂等）；
   * 没接线时才退回 `replace` 兜底（只能还原空集 / 单个 key，多选还原不了）。
   */
  const restoreAfterSlowDoubleClick = useCallback((key: string) => {
    const burst = burstRef.current;
    /* 快照不属于这一行（这串点击是从别的行起头的）→ 不动：那一下选中是用户的意图 */
    if (!burst || burst.key !== key) return;
    /* 已经是双击前的样子（集合比较，顺序无关）就不必再写一次状态 */
    const current = selectedKeysRef.current;
    if (current.length === burst.before.length && burst.before.every((item) => current.includes(item))) {
      return;
    }
    if (restoreRef.current) {
      restoreRef.current([...burst.before]);
      return;
    }
    /* 兜底：`replace` 对空 key 返回空集，所以"双击前什么都没选"能精确还原 */
    selectRef.current(burst.before.includes(key) ? key : burst.before[0] ?? "", false);
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  const canEdit = useCallback((option: DataDestinationTrendOption) => (
    editable && Boolean(option.exeName) && !isAnonymousActivity(option.key)
  ), [editable]);

  const handlers = useCallback((option: DataDestinationTrendOption) => ({
    onClick: (event: { detail: number; ctrlKey: boolean }) => {
      /* 双击的第二下（`detail === 2`）绝不能再切一次选中 */
      if (event.detail > 1) {
        cancelPending();
        return;
      }
      if (!canEdit(option)) {
        selectRef.current(option.key, event.ctrlKey);
        return;
      }
      /* 新的一串点击开始：先把"之前的选中集"记下来（补偿要还原到它） */
      if (pendingRef.current === null) burstRef.current = { key: option.key, before: [...selectedKeysRef.current] };
      /* 只有**同一行**才取消：跨行连点是"想多选"，把上一行的挂起项 flush 出去
         （真的选中它），否则第一下点击被静默吞掉（D-1）。 */
      if (pendingRef.current && pendingRef.current.key !== option.key) flushPending();
      else cancelPending();
      pendingRef.current = { key: option.key, multi: event.ctrlKey };
      timerRef.current = window.setTimeout(() => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        timerRef.current = null;
        if (pending) applySelect(pending.key, pending.multi);
      }, DOUBLE_CLICK_WINDOW_MS);
    },
    onDoubleClick: (event: { target: EventTarget | null }) => {
      const target = event.target as HTMLElement | null;
      const onDetailTrigger = supportsDestinationDetails
        && !isAnonymousActivity(option.key)
        && Boolean(target?.closest?.("[data-destination-detail-trigger]"));
      /* 双击确认 → 取消挂起的选中；若这一行已经被"超窗"的那一次点击翻过，补回来 */
      cancelPending();
      if (canEdit(option)) restoreAfterSlowDoubleClick(option.key);
      if (onDetailTrigger) {
        /* 既有链路原样保留：行首图标的双击 = 打开应用详情 */
        openDetailsRef.current(option);
        return;
      }
      /* [本轮] 分类 tab：双击任意一行 → 打开「分类管理」（内置与自定义一行都不少）。
         这里**不做**选中集补偿 —— 理由与"为什么补上去反而是 bug"写在文件头
         「分类模式不套这套补偿」那一段（单击即生效 → 双击 = 两次单击的净效果）。 */
      if (manageableCategories) {
        setCategoryManageOpen(true);
        return;
      }
      if (!canEdit(option) || !option.exeName) return;
      /* [0.12.4] 宿主提供了编辑落点（= 标签弹层）就交给它，别再开内建弹窗 */
      if (onEditOption) {
        onEditOption(option);
        return;
      }
      setEditing({
        exeName: option.exeName,
        displayName: option.displayName,
        category: (option.classificationCategory ?? "other") as AppCategory,
        iconUrl: option.iconUrl ?? undefined,
      });
    },
  }), [
    applySelect, canEdit, cancelPending, flushPending, manageableCategories,
    onEditOption, restoreAfterSlowDoubleClick, supportsDestinationDetails,
  ]);

  const closeEditor = useCallback(() => setEditing(null), []);
  const openCategoryManage = useCallback(() => setCategoryManageOpen(true), []);
  const closeCategoryManage = useCallback(() => setCategoryManageOpen(false), []);

  return {
    editing,
    closeEditor,
    categoryManageOpen,
    openCategoryManage,
    closeCategoryManage,
    handlers,
  };
}
