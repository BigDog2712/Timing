/**
 * Timing — 设置 · 数据管理 · 草稿编排（V0.11.13 → V0.11.16）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` 拆出（那里 298 行、贴到 300 行门禁）：切的口子是「状态与副作用」对
 * 「版面」。数字口径见 `mdSyncConfig.ts`。
 * 只允许**一份实例**：`MdSyncTab` 调本 Hook 并把结果传给各块。卡片各自再调一次会得到
 * 两套互不相干的 state——用户在卡里填的地址按「保存」时读不到。
 *
 * [V0.11.16] 新增 `shared`：块①的「日记文件名」框与块③的「日记落点」框**不是**三档的
 * 镜像，是「一条待执行的统一意图」（见 `mdSyncShared.ts`）。判据只有一条：
 * **用户亲手改过那个框才扇出三档**。任一档被逐档面板手改时，对应字段的意图立刻作废，
 * 否则保存时的扇出会把刚改的那一档盖回去。
 */
import { useEffect, useMemo, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { IS_MOBILE } from '../../lib/platform';
import { errorText, mdSyncApi } from '../../services/api';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { IPC_EVENTS } from '../../types/domain';
import type { MdSyncBinding, MdSyncCloud, MdSyncKind, MdSyncReport } from '../../types/domain';
import { POLL_DEFAULT_MINUTES, clampMinutes, emptyCloud, pollSecsOf, toMinutes } from './mdSyncConfig';
import { NO_SHARED, applyShared, mirrorOf, sharedAfterEdit } from './mdSyncShared';
import type { MdSyncShared } from './mdSyncShared';

/**
 * 哪一块被改过。①（`format`）和③（`sync`）**共用同一个 `bindings` 数组**，所以脏标记
 * 必须按「谁动的」记，不能按数据形状记——这是拆块之后最容易写错的地方：
 * 两处都调 `updateBinding`，只差第三个入参。
 */
export type MdSyncDirtyPart = 'format' | 'sync' | 'cloud';
export type MdSyncDirtyParts = Record<MdSyncDirtyPart, boolean>;

/** 干净态：`{}` 不写成共享常量也行，但共享一份能保证 `discard()` 与初始值逐字段一致 */
const CLEAN_PARTS: MdSyncDirtyParts = { format: false, sync: false, cloud: false };

export interface MdSyncDraft {
  enabled: boolean;
  setEnabled(next: boolean): void;
  pollMin: string;
  /** 打字只改文本；归一（夹边界 / 非数字回默认）放在 `commitPoll` */
  setPollMin(value: string): void;
  commitPoll(raw: string): void;
  bindings: MdSyncBinding[];
  /** 单框的统一意图；`{file:null, root:null}` = 用户什么都没动过 */
  shared: MdSyncShared;
  /** 块①「日记文件名」框写这里（内部按「改回原值视为没改」归一） */
  setSharedFile(value: string): void;
  /** 块③「日记落点」框写这里 */
  setSharedRoot(value: string): void;
  /** 发给后端的数组 = `applyShared(bindings, shared)`。**保存与「测试连接」共用这一份** */
  resolvedBindings: MdSyncBinding[];
  /** `part` = 这次改动属于哪一块（① 改 file/heading，③ 改 root/enabled） */
  updateBinding(index: number, next: MdSyncBinding, part: 'format' | 'sync'): void;
  cloud: MdSyncCloud;
  updateCloud(next: MdSyncCloud): void;
  /**
   * `true` = 存的那份是「本地目录」，手机端不支持，已按 WebDAV 显示**并将按 WebDAV 保存**。
   * 只用于让卡片显示一行说明：改哪里有解释，就不算「静默改用户配置」。
   */
  modeConverted: boolean;
  /** `null` = 用户没碰过密码框（保存时按「不动已存密文」透传） */
  secret: string | null;
  setSecret(value: string | null): void;
  dirty: boolean;
  /** 按块拆的脏标记（块标题旁的「未保存」用它） */
  dirtyParts: MdSyncDirtyParts;
  /** `view.config.cloud !== null`：④ 的默认展开判据（没配过的人不必先看六个空输入框） */
  cloudConfigured: boolean;
  saving: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  notice: string | null;
  clearNotice(): void;
  /** 放弃修改：按 `view` 回填 + 清干净标记（页面内，不刷新、不落库） */
  discard(): void;
  /** `true` = 保存成功（失败文案在 `error`，调用方不必自己拼） */
  save(): Promise<boolean>;
  run(): Promise<void>;
  open(kind: MdSyncKind): Promise<void>;
}

export function useMdSyncDraft(): MdSyncDraft {
  /* 整份订阅：本 store 只在「读 / 存 / 跑一轮」时变，重渲染代价远小于维护八个 selector */
  const { view, loaded, loading, saving, error, load, save: storeSave, run: storeRun } = useMdSyncStore();

  const [enabled, setEnabledState] = useState(true);
  const [pollMin, setPollMinState] = useState(String(POLL_DEFAULT_MINUTES));
  const [bindings, setBindings] = useState<MdSyncBinding[]>([]);
  const [shared, setSharedState] = useState<MdSyncShared>(NO_SHARED);
  const [cloud, setCloud] = useState<MdSyncCloud>(emptyCloud);
  const [modeConverted, setModeConverted] = useState(false);
  const [secret, setSecretState] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dirtyParts, setDirtyParts] = useState<MdSyncDirtyParts>(CLEAN_PARTS);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  /* 拿到视图就回填草稿；`dirty` 时不动（用户改一半不能被后台同步结果冲掉）。
     密码不回填：视图只有 `hasSecret`，明文永远不出后端，`secret` 只归用户自己写。
     [V0.11.14] 修 O12：手机端不支持「本地目录」，于是**草稿里的 mode 直接换成 webdav**。
     旧的写法只在渲染时假装成 WebDAV、保存仍回 `localfolder`，落库和界面各说一套；现在
     显示与落库是同一个值，代价是这一行说明（`modeConverted`）——改配置必须让用户看见。
     [V0.11.16] 回填时**不碰 `shared`**：意图只在用户输入时产生，回填代表「按已存的显示」。 */
  useEffect(() => {
    if (!view || dirty) return;
    setEnabledState(view.config.enabled);
    setPollMinState(String(toMinutes(view.config.pollSecs)));
    setBindings(view.config.bindings.map((binding) => ({ ...binding })));
    const stored = view.config.cloud ?? emptyCloud();
    const converted = IS_MOBILE && stored.mode === 'localfolder';
    const next: MdSyncCloud = converted ? { ...stored, mode: 'webdav' } : stored;
    setCloud(next);
    setModeConverted(converted);
  }, [view, dirty]);

  useTauriEvent<MdSyncReport>(IPC_EVENTS.mdSyncChanged, (report) => {
    if (!dirty) void load();
    if (report.imported > 0) setNotice(`已从 Markdown 同步 ${report.imported} 条更新`);
  });

  /* 任何改动都置 dirty 并清掉上一次的绿色提示（旧提示不该替新输入背书）。
     `part` 只影响「哪一块标题旁显示未保存」，不影响 `dirty` 本身——底部条只看 `dirty`。 */
  const touch = (part: MdSyncDirtyPart) => {
    setDirty(true);
    setDirtyParts((current) => (current[part] ? current : { ...current, [part]: true }));
    setNotice(null);
  };
  const setEnabled = (next: boolean) => { setEnabledState(next); touch('sync'); };
  const commitPoll = (raw: string) => { setPollMinState(String(clampMinutes(raw))); touch('sync'); };

  /* 单框打字：意图用**基准档的值**判断「有没有改过」，所以「打成原值 / 打完再删回原样」
     都会回到 `null`（PRD R-3 的误伤判据，见 `mdSyncShared.test.ts`）。 */
  const setSharedFile = (value: string) => {
    setSharedState((current) => ({ ...current, file: sharedAfterEdit(mirrorOf(bindings, 'file'), value) }));
    touch('format');
  };
  const setSharedRoot = (value: string) => {
    setSharedState((current) => ({ ...current, root: sharedAfterEdit(mirrorOf(bindings, 'root'), value) }));
    touch('sync');
  };

  /* 逐档面板手改 → 该字段的**统一意图先固化到其余各档**，再让本档写新值。
   *
   * [QA F2 回修] v0.11.16 首版是「手改即把意图清成 null」：单框填了 `D:\md`、展开逐档把
   * 便利贴改成 `D:\manual`、保存 → 落库 `['C:\Vault','D:\manual','%APP_DIR%\md']`，
   * 用户亲手打的 `D:\md` 凭空消失（单框还会当场跳回原值）。设计 §3.2「边界 3」的散文
   * 本来就写着「timers 仍为 D:\md」，代码现在才和它一致。
   *
   * 两条边界不许动：
   * 1. **只处理被改的那个字段**：改了 `root` 不该顺手把 `file` 的意图也固化掉（它仍是
   *    「待执行」，保存时才统一）；
   * 2. **没有意图时不扇出**：`shared[field] === null` 时其余各档原样保留——这是 PRD N2
   *    那条「一次什么都没改的保存不许统一三档」的另一半。 */
  const updateBinding = (index: number, next: MdSyncBinding, part: 'format' | 'sync') => {
    const prev = bindings[index];
    const editedFile = prev ? next.file !== prev.file : false;
    const editedRoot = prev ? next.root !== prev.root : false;
    setBindings((current) => current.map((item, i) => {
      /* 被编辑的字段：本档写新值，其余档先吃下已生效的统一意图（没有就保持原值） */
      const spread = (field: 'file' | 'root', edited: boolean): string => {
        if (!edited) return item[field];
        return i === index ? next[field] : shared[field] ?? item[field];
      };
      const file = spread('file', editedFile);
      const root = spread('root', editedRoot);
      return i === index ? { ...next, file, root } : { ...item, file, root };
    }));
    /* 意图已经落到三档上，这个字段的 shared 可以退休了（留着会让保存时的扇出再覆盖一次） */
    setSharedState((current) => ({
      file: editedFile ? null : current.file,
      root: editedRoot ? null : current.root,
    }));
    touch(part);
  };
  const updateCloud = (next: MdSyncCloud) => { setCloud(next); touch('cloud'); };
  const setSecret = (value: string | null) => { setSecretState(value); touch('cloud'); };

  /** 发给后端的那一份：所有写库 / 测试连接的**唯一**出口 */
  const resolvedBindings = useMemo(() => applyShared(bindings, shared), [bindings, shared]);

  /* 放弃修改：不自己拼回填逻辑，只把 `dirty` 放回 false——上面的回填 effect 依赖
     `[view, dirty]`，会立刻按 `view` 重填草稿。这样「放弃修改」与「切到别的页签再回来」
     走的是**同一条**回填路径，不会出现两套口径。 */
  const discard = () => {
    setDirty(false);
    setDirtyParts(CLEAN_PARTS);
    setSharedState(NO_SHARED);
    setSecretState(null); /* 明文不进后端就作废；下次保存回到「不动已存密文」 */
    setNotice(null);
  };

  const save = async (): Promise<boolean> => {
    try {
      /* 密码三分的**唯一**出口：`null`（没碰过）→ `undefined`（不动）。写成 `''` 是一条
         「清空密码」的指令，会把用户已存的密文删掉。 */
      await storeSave({ enabled, pollSecs: pollSecsOf(pollMin), bindings: resolvedBindings, cloud }, secret ?? undefined);
      setPollMinState(String(clampMinutes(pollMin)));
      setDirty(false);
      setDirtyParts(CLEAN_PARTS);
      /* 落库后三档已被统一，`mirrorOf` 自然等于刚写的值 → 单框不跳 */
      setSharedState(NO_SHARED);
      setSecretState(null); /* 密码已进后端（或已清空），本地不留明文；下次保存回到「不动」 */
      setNotice('已保存并同步');
      return true;
    } catch {
      return false; /* store.error 已有可读文案，这里不重复提示 */
    }
  };

  const run = async (): Promise<void> => {
    try {
      const report = await storeRun();
      const failed = report.errors.length;
      setNotice(failed > 0
        ? `同步完成，但有 ${failed} 个落点失败`
        : `同步完成：写入 ${report.exported} 个落点，导入 ${report.imported} 条`);
    } catch {
      /* store.error */
    }
  };

  const open = async (kind: MdSyncKind): Promise<void> => {
    try { await mdSyncApi.open(kind); } catch (err) { setNotice(errorText(err)); }
  };

  return {
    enabled, setEnabled, pollMin, setPollMin: setPollMinState, commitPoll, bindings,
    shared, setSharedFile, setSharedRoot, resolvedBindings, updateBinding,
    cloud, updateCloud, modeConverted, secret, setSecret, dirty, dirtyParts,
    /* 老配置（V0.11.12 及以前）没有 `cloud` 这个键 → `null` → ④ 默认收起 */
    cloudConfigured: view?.config.cloud != null,
    saving, loading, loaded, error, notice,
    clearNotice: () => setNotice(null), discard, save, run, open,
  };
}
