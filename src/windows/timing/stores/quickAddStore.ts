/**
 * 药丸「新建事项」的草稿：名称之外还要带**标签**与**绑定应用**（0.13.x 主人口径）。
 *
 * 为什么要有这一层：名称输入框在条上（`InlineNameEntry`），标签/应用选择在下方
 * 常用事项框的框底（`QuickAddExtras`）——两个组件不互为父子，而提交发生在
 * `usePillInlineEdit`。把三者要共享的三个字段放一处，跨组件读写才不会漏。
 *
 * 名称在条上输入时**实时镜像**到这里（`InlineNameEntry.onChangeText`），
 * 否则点框底的「开始」时 store 里还是空名。
 */
import { create } from 'zustand';

export interface QuickAddDraft {
  name: string;
  tags: string[];
  /** 归一化后的应用键（`normalizeAppKey` 的产物）；`null` = 不绑定 */
  appKey: string | null;
  /** 展示用应用名（去引号后的 exe 名，可能带 `.exe`）；只随 `appKey` 一起写 */
  appLabel: string | null;
}

interface QuickAddStore extends QuickAddDraft {
  setName: (name: string) => void;
  setTags: (tags: string[]) => void;
  setApp: (appKey: string | null, appLabel: string | null) => void;
  reset: () => void;
}

const EMPTY: QuickAddDraft = { name: '', tags: [], appKey: null, appLabel: null };

export const useQuickAddStore = create<QuickAddStore>((set) => ({
  ...EMPTY,
  setName: (name) => set({ name }),
  setTags: (tags) => set({ tags }),
  /* 键与展示名必须成对写：只换键不换名会让框底高亮到错的 chip */
  setApp: (appKey, appLabel) => set({ appKey, appLabel }),
  reset: () => set(EMPTY),
}));