/**
 * Timing — 设置 · 数据管理 · 草稿编排（V0.11.13 → V0.11.26）
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
 *
 * [V0.11.26] 云端那半从「一份带 mode 的 cloud」拆成**两条通路各自的草稿** `folder` /
 * `webdav`（PRD R4 / R5）：
 * - 两份都**永远非空**（没配过时是 `emptyLocal()` / `emptyWebdav()`），组件不必判 null；
 * - 各改各的：`updateFolder` 只碰 folder、`updateWebdav` 只碰 webdav（O13 互不触碰）；
 * - `modeConverted` 机制**整体退役**：手机端不再渲染块④（`MdSyncTab` 里 `!IS_MOBILE`），
 *   也就不存在「把用户的本地目录掰成 WebDAV 再告诉他」这件事（O19）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { errorText, mdSyncApi } from '../../services/api';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { IPC_EVENTS } from '../../types/domain';
import type {
  MdSyncBinding,
  MdSyncCloudChannel,
  MdSyncKind,
  MdSyncReport,
} from '../../types/domain';
import {
  MD_SYNC_POLL_SECS,
  channelToSave,
  emptyLocal,
  emptyWebdav,
} from './mdSyncConfig';
import { NO_SHARED, applyShared, mirrorOf, sharedAfterEdit } from './mdSyncShared';
import type { MdSyncShared } from './mdSyncShared';

/**
 * 哪一块被改过。①（`format`）和③（`sync`）**共用同一个 `bindings` 数组**，所以脏标记
 * 必须按「谁动的」记，不能按数据形状记——这是拆块之后最容易写错的地方：
 * 两处都调 `updateBinding`，只差第三个入参。
 *
 * [V0.11.26] `+local`：块④ 与块⑤ 各有自己的通路草稿，脏标记也必须分开——否则改了本地
 * 落点会让「云端同步」那个标题旁也亮起「未保存」。
 */
export type MdSyncDirtyPart = 'format' | 'sync' | 'local' | 'cloud';
export type MdSyncDirtyParts = Record<MdSyncDirtyPart, boolean>;

/** 干净态：`{}` 不写成共享常量也行，但共享一份能保证 `discard()` 与初始值逐字段一致 */
const CLEAN_PARTS: MdSyncDirtyParts = { format: false, sync: false, local: false, cloud: false };

export interface MdSyncDraft {
  enabled: boolean;
  setEnabled(next: boolean): void;
  /**
   * [V0.11.19] 落库原值透传（PRD §15.2）：界面已无入口，保存 / 测试连接都取这一份，
   * 不许从任何界面状态推算。视图未回来时是后端默认值占位，`save()` 会先拦下。
   */
  pollSecs: number;
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
  /** 块④ 本地同步的草稿。**永远非空**（没配过时是 `emptyLocal()`）。 */
  folder: MdSyncCloudChannel;
  /** 块⑤ 云端同步的草稿。**永远非空**（没配过时是 `emptyWebdav()`）。 */
  webdav: MdSyncCloudChannel;
  /** 块④ 修改（**只碰 folder**，块⑤ 一个字节不动） */
  updateFolder(next: MdSyncCloudChannel): void;
  /** 块⑤ 修改（**只碰 webdav**） */
  updateWebdav(next: MdSyncCloudChannel): void;
  /** 块④ 标题右侧那个开关（落库绑 `cloudFolder.enabled`） */
  setFolderEnabled(next: boolean): void;
  /** 块⑤ 标题右侧那个开关（落库绑 `cloudWebdav.enabled`） */
  setWebdavEnabled(next: boolean): void;
  /** `null` = 用户没碰过密码框（保存时按「不动已存密文」透传） */
  secret: string | null;
  setSecret(value: string | null): void;
  dirty: boolean;
  /** 按块拆的脏标记（块标题旁的「未保存」用它） */
  dirtyParts: MdSyncDirtyParts;
  /** `view.config.cloudFolder != null`：`channelToSave` 的「从没配过」判据（防空壳） */
  folderConfigured: boolean;
  /** `view.config.cloudWebdav != null`：同上，块⑤ 那份 */
  webdavConfigured: boolean;
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
  const [bindings, setBindings] = useState<MdSyncBinding[]>([]);
  const [shared, setSharedState] = useState<MdSyncShared>(NO_SHARED);
  const [folder, setFolder] = useState<MdSyncCloudChannel>(emptyLocal);
  const [webdav, setWebdav] = useState<MdSyncCloudChannel>(emptyWebdav);
  const [secret, setSecretState] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dirtyParts, setDirtyParts] = useState<MdSyncDirtyParts>(CLEAN_PARTS);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  /* 拿到视图就回填草稿；`dirty` 时不动（用户改一半不能被后台同步结果冲掉）。
     密码不回填：视图只有 `hasSecret`，明文永远不出后端，`secret` 只归用户自己写。
     [V0.11.26] 两条通路各自回填、各自兜空：`?? emptyLocal()` / `?? emptyWebdav()`
     保证草稿永远非空（组件不判 null），而「从未配置」这条事实由 `xxxConfigured` 说。
     [V0.11.16] 回填时**不碰 `shared`**：意图只在用户输入时产生，回填代表「按已存的显示」。 */
  useEffect(() => {
    if (!view || dirty) return;
    setEnabledState(view.config.enabled);
    setBindings(view.config.bindings.map((binding) => ({ ...binding })));
    setFolder(view.config.cloudFolder ?? emptyLocal());
    setWebdav(view.config.cloudWebdav ?? emptyWebdav());
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

  /* 两条通路各改各的：`updateFolder` 绝不复制 `webdav` 的引用、反之亦然（O13）。 */
  const updateFolder = (next: MdSyncCloudChannel) => { setFolder(next); touch('local'); };
  const updateWebdav = (next: MdSyncCloudChannel) => { setWebdav(next); touch('cloud'); };
  /* 开关也走各自的 `touch`：拨块④ 的开关不该让块⑤ 标题旁亮「未保存」。 */
  const setFolderEnabled = (next: boolean) => updateFolder({ ...folder, enabled: next });
  const setWebdavEnabled = (next: boolean) => updateWebdav({ ...webdav, enabled: next });
  const setSecret = (value: string | null) => { setSecretState(value); touch('cloud'); };

  /** 发给后端的那一份：所有写库 / 测试连接的**唯一**出口 */
  const resolvedBindings = useMemo(() => applyShared(bindings, shared), [bindings, shared]);

  /* 两条通路各自的「曾经配过」：`channelToSave` 只归一**从未配置**且关着的那一条，
     配过的人一律原样保留（CH4「关掉不删配置」的继承者）。它**不是**「会不会跑」的判据
     （那个是 `isLocalReady / isWebdavReady`，还要看字段填没填全）。 */
  const folderConfigured = view?.config.cloudFolder != null;
  const webdavConfigured = view?.config.cloudWebdav != null;

  /* 保存与「测试连接」**同一份来源**：老用户 180 就是 180，没读回视图时只是占位。 */
  const pollSecs = view?.config.pollSecs ?? MD_SYNC_POLL_SECS;

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
    /* [V0.11.19 / PRD §15.2] 视图还没回来就不许保存：否则会把上面那个 900 占位
       写进库，老用户手填的 `pollSecs` 当场被改掉，而界面上已经没有入口能改回来。 */
    if (!view) return false;
    try {
      /* 密码三分的**唯一**出口：`null`（没碰过）→ `undefined`（不动）。写成 `''` 是一条
         「清空密码」的指令，会把用户已存的密文删掉。
         [V0.11.26] 两条通路各走 `channelToSave` 归一：**从未配置**且关着 → 落 `null`，
         两块都如此时 JSON 与新装同形（O13 的后半句）。载荷里不出现 legacy `cloud` 键
         （`undefined` 不会被 `JSON.stringify` 带出去）。 */
      await storeSave(
        {
          enabled,
          pollSecs,
          bindings: resolvedBindings,
          /* [V0.11.26] `cloud` 恒 `null`：新保存形里这个 legacy 键**不出现**（O11）。
             显式写 `null` 是为了满足类型（手机端红线文件要求这个字段必填），
             Rust 侧 `Option` 收到 `null` 就是 `None`，落库时同样不出现。 */
          cloud: null,
          cloudFolder: channelToSave(folder, folderConfigured),
          cloudWebdav: channelToSave(webdav, webdavConfigured),
        },
        secret ?? undefined,
      );
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
    enabled, setEnabled, pollSecs, bindings,
    shared, setSharedFile, setSharedRoot, resolvedBindings, updateBinding,
    folder, webdav, updateFolder, updateWebdav, setFolderEnabled, setWebdavEnabled,
    secret, setSecret, dirty, dirtyParts,
    folderConfigured, webdavConfigured,
    saving, loading, loaded, error, notice,
    clearNotice: () => setNotice(null), discard, save, run, open,
  };
}
