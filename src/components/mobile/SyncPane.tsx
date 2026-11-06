/**
 * Timing — 移动端「同步」页签（V0.12.0）
 * -----------------------------------------------------------------------------
 * 与桌面「设置 → 同步」是**同一套配置、同一套合并规则**，差别只在落点怎么表达：
 *
 *   桌面：一个可写的绝对路径（用户在输入框里填 / 用文件夹选择器挑）
 *   手机：一个 SAF 目录授权（`content://` 树 URI，用户点一次「选择目录」）
 *
 * 所以这一页不显示「根目录」输入框——手机上那个框填什么都没意义，Rust 侧会把根目录
 * 换成沙箱镜像目录。用户只需要选一次目录、决定同步哪几类数据、点同步。
 *
 * 三个落点（事项计时 / 便利贴 / 待办）通常指向**同一个** `2026-11-06.md` 的不同标题区块；
 * 页面上仍分开列，是因为「只想同步计时不想同步待办」是真实需求。
 */
import { useCallback, useEffect, useState } from 'react';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import type { MdSyncConfig, MdSyncReport, MdSyncView, SafStatus } from '../../types/domain';
import { errorText, IpcError } from '../../services/ipc';
import { mobileNative } from '../../services/mobileNative';

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
  const [view, setView] = useState<MdSyncView | null>(null);
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

  const save = async (next: MdSyncConfig) => {
    setBusy(true);
    setNote('');
    try {
      setView(await mobileNative.syncSave(next));
      setNote('已保存');
    } catch (err) {
      setNote(syncErrorText(err));
    } finally {
      setBusy(false);
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
      </div>

      <div className="setting-group">
        <button
          type="button"
          className="m-btn m-btn--primary"
          disabled={busy || !config.enabled || !saf?.granted}
          onClick={() => void runNow()}
        >
          {busy ? '同步中…' : '立即同步'}
        </button>
        <p className="m-hint">{note || statusText}</p>
      </div>
    </>
  );
}
