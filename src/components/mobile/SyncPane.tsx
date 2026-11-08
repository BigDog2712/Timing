/**
 * Timing — 移动端「数据管理」页签（V0.12.0；[V0.11.21] 加云端通道；[V0.11.22] 只留云端）
 * -----------------------------------------------------------------------------
 * ## 这一页现在是什么
 *
 * ```text
 * 云端同步        开 / 关      ← 一次写 config.enabled 与 cloud.enabled（见 SyncCloudPane）
 *   三档 / 四字段 / 保存 / 测试连接 / 状态行
 * 立即同步
 * 备份与恢复      列表 → 二次确认 → 覆盖回去
 * ```
 *
 * ## [V0.11.22] 为什么本地日记目录整段消失了
 *
 * 那一套（SAF 目录授权 + 三个事项绑定 + 「只用本地 / 本地 + 云端」）需要用户在手机上指定
 * 一个真实目录，而主人这条路上根本走不通（原话：「手机端无法使用云端的本地同步，
 * 此功能去除，仅保留云端同步」）。于是：
 *
 * - 界面：目录行、三个绑定行、通道二选一全部移除；
 * - 调度：`jobs/md_sync_mobile` 的 `Legacy` 分支不再跑轮（只 60 秒醒一次等配置变化）；
 * - 手动：云端不可用时给一句「先填云端」，不再偷偷回落 SAF 拿一句「未授权」。
 *
 * 后端的 SAF 能力没有删——`md_saf_status` / `md_sync_open` 仍在契约面上（78 条），
 * 它们现在的用处是「在 Obsidian 里打开今天那份」以及排障时回答「授权还在不在」。
 */
import { useCallback, useEffect, useState } from 'react';
import type { MdSyncConfig, MdSyncReport, MdSyncTestResult, MdSyncViewCloud } from '../../types/domain';
import { errorText, IpcError } from '../../services/ipc';
import { mobileNative } from '../../services/mobileNative';
import { isCloudReady } from '../settings/mdSyncConfig';
import { SyncBackupPane } from './SyncBackupPane';
import { SyncCloudPane } from './SyncCloudPane';

/**
 * 同步失败时的提示。
 *
 * `errorText()` 把 `IO_ERROR` 统一润色成「系统调用失败，请重试」——那句话在别处是对的，
 * 在这一页却是灾难：手机上的同步失败大多来自原生桥或网络，后端给的原文
 * （「云端 401…」/「原生桥 … 失败：…」）恰好是唯一能定位问题的线索，被润色掉就只剩盲猜。
 */
function syncErrorText(err: unknown): string {
  if (err instanceof IpcError && err.message) return err.message;
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    setView(await mobileNative.syncView());
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
  /* 「能不能同步」只有一个判据：开关 + 填全。取 `isCloudReady`（与桌面、后端 `is_usable`
     同口径），不在这里写第三份。 */
  const ready = config.enabled && config.cloud !== null && isCloudReady(config.cloud);
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
      <SyncCloudPane view={view} busy={busy} onSave={save} onTest={test} />

      <div className="setting-group">
        <button
          type="button"
          className="m-btn m-btn--primary"
          disabled={busy || !ready}
          onClick={() => void runNow()}
        >
          {busy ? '同步中…' : '立即同步'}
        </button>
        <p className="m-hint" data-sync-note={ready ? 'ready' : 'not-ready'}>
          {note || (ready ? statusText : '云端还没填全，暂时不会同步。')}
        </p>
      </div>

      <SyncBackupPane />
    </>
  );
}
