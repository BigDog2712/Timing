/**
 * Timing — 设置 · 同步 · 草稿编排（V0.11.13）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` 拆出（那里 298 行、贴到 300 行门禁）：切的口子是「状态与副作用」对
 * 「版面」。数字口径见 `mdSyncConfig.ts`。
 * 只允许**一份实例**：`MdSyncTab` 调本 Hook 并把结果传给两张卡。卡片各自再调一次会得到
 * 两套互不相干的 state——用户在卡里填的地址按「保存」时读不到。
 */
import { useEffect, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { IS_MOBILE } from '../../lib/platform';
import { errorText, mdSyncApi } from '../../services/api';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { IPC_EVENTS } from '../../types/domain';
import type { MdSyncBinding, MdSyncCloud, MdSyncKind, MdSyncReport } from '../../types/domain';
import { POLL_DEFAULT_MINUTES, clampMinutes, emptyCloud, pollSecsOf, toMinutes } from './mdSyncConfig';

export interface MdSyncDraft {
  enabled: boolean;
  setEnabled(next: boolean): void;
  pollMin: string;
  /** 打字只改文本；归一（夹边界 / 非数字回默认）放在 `commitPoll` */
  setPollMin(value: string): void;
  commitPoll(raw: string): void;
  bindings: MdSyncBinding[];
  updateBinding(index: number, next: MdSyncBinding): void;
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
  saving: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  notice: string | null;
  clearNotice(): void;
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
  const [cloud, setCloud] = useState<MdSyncCloud>(emptyCloud);
  const [modeConverted, setModeConverted] = useState(false);
  const [secret, setSecretState] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  /* 拿到视图就回填草稿；`dirty` 时不动（用户改一半不能被后台同步结果冲掉）。
     密码不回填：视图只有 `hasSecret`，明文永远不出后端，`secret` 只归用户自己写。
     [V0.11.14] 修 O12：手机端不支持「本地目录」，于是**草稿里的 mode 直接换成 webdav**。
     旧的写法只在渲染时假装成 WebDAV、保存仍回 `localfolder`，落库和界面各说一套；现在
     显示与落库是同一个值，代价是这一行说明（`modeConverted`）——改配置必须让用户看见。 */
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

  /* 任何改动都置 dirty 并清掉上一次的绿色提示（旧提示不该替新输入背书） */
  const touch = () => { setDirty(true); setNotice(null); };
  const setEnabled = (next: boolean) => { setEnabledState(next); touch(); };
  const commitPoll = (raw: string) => { setPollMinState(String(clampMinutes(raw))); touch(); };
  const updateBinding = (index: number, next: MdSyncBinding) => {
    setBindings((current) => current.map((item, i) => (i === index ? next : item)));
    touch();
  };
  const updateCloud = (next: MdSyncCloud) => { setCloud(next); touch(); };
  const setSecret = (value: string | null) => { setSecretState(value); touch(); };

  const save = async (): Promise<boolean> => {
    try {
      /* 密码三分的**唯一**出口：`null`（没碰过）→ `undefined`（不动）。写成 `''` 是一条
         「清空密码」的指令，会把用户已存的密文删掉。 */
      await storeSave({ enabled, pollSecs: pollSecsOf(pollMin), bindings, cloud }, secret ?? undefined);
      setPollMinState(String(clampMinutes(pollMin)));
      setDirty(false);
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
    enabled, setEnabled, pollMin, setPollMin: setPollMinState, commitPoll, bindings, updateBinding,
    cloud, updateCloud, modeConverted, secret, setSecret, dirty, saving, loading, loaded, error, notice,
    clearNotice: () => setNotice(null), save, run, open,
  };
}
