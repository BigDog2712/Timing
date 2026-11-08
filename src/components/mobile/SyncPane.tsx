/**
 * Timing — 移动端「数据管理」页签（V0.12.0；[V0.11.21] 加云端通道）
 * -----------------------------------------------------------------------------
 * 与桌面「设置 → 数据管理」是**同一套配置、同一套合并规则**，差别只在落点怎么表达：
 *
 *   桌面：一个可写的绝对路径（用户在输入框里填 / 用文件夹选择器挑）
 *   手机：一个 SAF 目录授权（`content://` 树 URI，用户点一次「选择目录」）
 *
 * 所以这一页不显示「根目录」输入框——手机上那个框填什么都没意义，Rust 侧会把根目录
 * 换成沙箱镜像目录。用户只需要选一次目录、决定同步哪几类数据、点同步。
 *
 * 三个落点（事项计时 / 便利贴 / 待办）通常指向**同一个** `2026-11-06.md` 的不同标题区块；
 * 页面上仍分开列，是因为「只想同步计时不想同步待办」是真实需求。
 *
 * [V0.11.21] **云端通道回来了**。它走的是另一条路：不需要 SAF（落点是应用沙箱里的
 * `md-webdav` 目录），所以「只配云端、不选日记目录」是合法用法——那个按钮的可用性
 * 因此改成「SAF 已授权 **或** 云端可用」，与 `app::md_sync_mobile::sync_once` 的三段式
 * 对齐。云端那一块在 `SyncCloudPane.tsx`。
 */
import { useCallback, useEffect, useState } from 'react';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import type {
  MdSyncConfig,
  MdSyncReport,
  MdSyncTestResult,
  MdSyncViewCloud,
  SafStatus,
} from '../../types/domain';
import { errorText, IpcError } from '../../services/ipc';
import { mobileNative } from '../../services/mobileNative';
import { isCloudReady } from '../settings/mdSyncConfig';
import { SyncCloudPane } from './SyncCloudPane';

/**
 * 同步失败时的提示。
 *
 * `errorText()` 把 `IO_ERROR` 统一润色成「系统调用失败，请重试」——那句话在别处是对的，
 * 在这一页却是灾难：手机上的同步失败**全都**来自原生桥（SAF 授权、目录读写），后端给的
 * 原文（「原生桥 mirrorIn 失败：…」）恰好是唯一能定位问题的线索，被润色掉就只剩盲猜。
 */
function syncErrorText(err: unknown): string {
  if (err instanceof IpcError && err.code === 'IO_ERROR' && err.message) return err.message;
  return errorText(err);
}

function reportText(report: MdSyncReport): string {
  if (report.errors.length > 0) return report.errors.join('；');
  if (report.imported > 0) return `已从文件读回 ${report.imported} 条改动`;
  if (report.exported > 0) return '已写入文件';
  return '没有需要同步的改动';
}

export function SyncPane() {
  const [view, setView] = useState<MdSyncViewCloud | null>(null);
  const [saf, setSaf] = useState<SafStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    const [nextView, nextSaf] = await Promise.all([
      mobileNative.syncView(),
      mobileNative.safStatus(),
    ]);
    setView(nextView);
    setSaf(nextSaf);
  }, []);

  useEffect(() => {
    void reload().catch((err) => setNote(syncErrorText(err)));
  }, [reload]);

  /** `secret` 三分语义由后端解释，这里只负责「有没有动过密码框」，不自己拼空串。 */
  const save = async (next: MdSyncConfig, secret?: string | null) => {
    setBusy(true);
    setNote('');
    try {
      setView(await mobileNative.syncSave(next, secret));
      setNote('已保存');
    } catch (err) {
      setNote(syncErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** 测试连接：只读探测，不落库（后端 `probe.rs` 首行注释「不写任何状态」）。 */
  const test = async (next: MdSyncConfig, secret?: string | null): Promise<MdSyncTestResult> => {
    try {
      return await mobileNative.syncTest(next, secret);
    } catch (err) {
      return { ok: false, detail: syncErrorText(err) };
    }
  };

  /** 选目录；选完立刻同步一轮——用户点这个按钮的意图就是「现在开始用这个目录」。 */
  const pick = async () => {
    setBusy(true);
    setNote('');
    try {
      const next = await mobileNative.safPick();
      setSaf(next);
      if (!next.granted) {
        setNote('没有选目录，同步还不会开始');
        return;
      }
      setNote(reportText(await mobileNative.syncRun()));
      setView(await mobileNative.syncView());
    } catch (err) {
      setNote(syncErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setNote('');
    try {
      setNote(reportText(await mobileNative.syncRun()));
      setView(await mobileNative.syncView());
    } catch (err) {
      setNote(syncErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <p className="m-hint">正在读取同步设置…</p>;

  const config = view.config;
  const status = view.status;
  /* 云端可用 → 不需要 SAF：`sync_once` 的云端分支排在 SAF 检查之前，那一轮根本不碰原生桥。
     判据取 `isCloudReady`（与桌面、与后端 `is_usable` 三处同口径），不在这里再写第四份。 */
  const cloudReady = config.cloud !== null && isCloudReady(config.cloud);
  const statusText =
    status.lastError ??
    (status.lastSyncAt
      ? `上次同步：${new Date(status.lastSyncAt).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : '还没同步过');

  return (
    <>
      <div className="setting-group">
        <div className="setting-row">
          <span className="setting-row__label">Markdown 同步</span>
          <button
            type="button"
            className="m-btn m-btn--small"
            disabled={busy}
            onClick={() => void save({ ...config, enabled: !config.enabled })}
          >
            {config.enabled ? '已开启' : '已关闭'}
          </button>
        </div>
        <p className="m-hint">
          把当天的计时、便利贴、待办写进 Obsidian 日记的指定标题下，双向同步：
          你在文件里删改的内容会被读回应用。
        </p>
      </div>

      <SyncCloudPane view={view} busy={busy} onSave={save} onTest={test} />

      <div className="setting-group">
        <div className="setting-row m-sync__row">
          <span className="setting-row__label">日记目录</span>
          <span className="m-sync__path" data-ok={saf?.granted ? 'true' : 'false'}>
            {saf?.granted ? saf.label : '未选择'}
          </span>
          <button
            type="button"
            className="m-btn m-btn--small"
            disabled={busy}
            onClick={() => void pick()}
          >
            {saf?.granted ? '更换' : '选择'}
          </button>
        </div>

        {config.bindings.map((binding) => (
          <div className="setting-row m-sync__row" key={binding.kind}>
            <span className="setting-row__label">{MD_SYNC_KIND_LABELS[binding.kind]}</span>
            <span className="m-sync__heading">{binding.heading}</span>
            <button
              type="button"
              className="m-btn m-btn--small"
              disabled={busy}
              onClick={() =>
                void save({
                  ...config,
                  bindings: config.bindings.map((item) =>
                    item.kind === binding.kind ? { ...item, enabled: !item.enabled } : item,
                  ),
                })
              }
            >
              {binding.enabled ? '同步' : '跳过'}
            </button>
          </div>
        ))}
        {cloudReady && (
          <p className="m-hint">云端已可用：这一栏可以不选目录，手机只当云端的另一个写端。</p>
        )}
      </div>

      <div className="setting-group">
        <button
          type="button"
          className="m-btn m-btn--primary"
          disabled={busy || !config.enabled || !(saf?.granted || cloudReady)}
          onClick={() => void runNow()}
        >
          {busy ? '同步中…' : '立即同步'}
        </button>
        <p className="m-hint">{note || statusText}</p>
      </div>
    </>
  );
}
