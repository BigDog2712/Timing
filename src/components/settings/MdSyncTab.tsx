/**
 * Timing — 设置 · 同步页签（V0.4.0 / 插件 API v2）
 * -----------------------------------------------------------------------------
 * 这是 md-sync 插件的「快捷设置落点」入口：
 * - 总开关：停止读写但保留配置；
 * - 每个数据种类一张卡：根目录（原生文件夹选择）、文件模板、标题行；
 * - 保存后立即同步一次；「立即同步」只读现有配置；
 * - 状态来自 Rust 侧最后一次运行，失败原因原样展示，不假装成功。
 *
 * 草稿策略：输入只改本地 state，点「保存并同步」才落 `settings` KV。轮询在后台
 * 仍会跑；如果用户正在编辑（dirty），事件不覆盖草稿，避免「改一半被同步结果冲掉」。
 *
 * [V0.11.3] 新增「同步间隔」：默认 15 分钟，可调（1 分钟 ~ 1 天）。原先固定 2 秒，
 * 一天要全量渲染几千次；用户明确要求降频，并把「立即同步」当作主用法。
 */
import { useEffect, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SettingsIcon,
  iconStroke,
} from '../../lib/icons';
import { pickFolder } from '../../services/folderPicker';
import { mdSyncApi } from '../../services/api';
import { errorText } from '../../services/ipc';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { IPC_EVENTS } from '../../types/domain';
import type { MdSyncBinding, MdSyncReport } from '../../types/domain';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { Switch } from '../ui/Switch';
import { MdSyncBindingCard } from './MdSyncBindingCard';

/** 间隔上下限（分钟）：与后端 `MD_SYNC_POLL_MIN_SECS / MAX_SECS` 同值 */
const POLL_MIN_MINUTES = 1;
const POLL_MAX_MINUTES = 1440;
const POLL_DEFAULT_MINUTES = 15;

/** 秒 → 分钟（配置存秒，界面按分钟说人话） */
const toMinutes = (secs: number): number => Math.max(POLL_MIN_MINUTES, Math.round(secs / 60));

/** 分钟文案：整点显示「15 分钟」，超过 60 补一个「≈2 小时」的提示感 */
function describeInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${minutes} 分钟（${hours} 小时）` : `${minutes} 分钟`;
}

export function MdSyncTab() {
  const view = useMdSyncStore((s) => s.view);
  const loaded = useMdSyncStore((s) => s.loaded);
  const loading = useMdSyncStore((s) => s.loading);
  const saving = useMdSyncStore((s) => s.saving);
  const error = useMdSyncStore((s) => s.error);
  const load = useMdSyncStore((s) => s.load);
  const save = useMdSyncStore((s) => s.save);
  const run = useMdSyncStore((s) => s.run);

  const [enabled, setEnabled] = useState(true);
  const [pollMin, setPollMin] = useState(String(POLL_DEFAULT_MINUTES));
  const [bindings, setBindings] = useState<MdSyncBinding[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);

  useEffect(() => {
    void load();
  }, [load]);

  /* 关掉总开关时把落点设置自动收起来；重新打开、或插件未安装时展开。 */
  useEffect(() => {
    setSettingsOpen(enabled || !view?.installed);
  }, [enabled, view?.installed]);

  /* 第一次拿到视图 / 保存后重新拿到视图时，把草稿同步过来；dirty 时不动。 */
  useEffect(() => {
    if (!view || dirty) return;
    setEnabled(view.config.enabled);
    setPollMin(String(toMinutes(view.config.pollSecs)));
    setBindings(view.config.bindings.map((binding) => ({ ...binding })));
  }, [view, dirty]);

  useTauriEvent<MdSyncReport>(IPC_EVENTS.mdSyncChanged, (report) => {
    if (!dirty) void load();
    if (report.imported > 0) {
      setNotice(`已从 Markdown 同步 ${report.imported} 条更新`);
    }
  });

  const update = (index: number, next: MdSyncBinding) => {
    setBindings((current) => current.map((item, i) => (i === index ? next : item)));
    setDirty(true);
    setNotice(null);
  };

  const handlePick = async (index: number) => {
    const current = bindings[index];
    if (!current) return;
    const picked = await pickFolder(
      `选择「${MD_SYNC_KIND_LABELS[current.kind]}」落点根目录`,
      current.root.includes('%') ? undefined : current.root,
    );
    if (picked) update(index, { ...current, root: picked });
  };

  /** 间隔输入归一：越界夹到边界，非数字回默认（不让用户卡在一个非法值上）。 */
  const commitPoll = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const minutes = Number.isFinite(parsed)
      ? Math.min(POLL_MAX_MINUTES, Math.max(POLL_MIN_MINUTES, parsed))
      : POLL_DEFAULT_MINUTES;
    setPollMin(String(minutes));
    setDirty(true);
    setNotice(null);
  };

  const handleSave = async () => {
    const minutes = Math.min(
      POLL_MAX_MINUTES,
      Math.max(POLL_MIN_MINUTES, Number.parseInt(pollMin, 10) || POLL_DEFAULT_MINUTES),
    );
    try {
      await save({ enabled, pollSecs: minutes * 60, bindings });
      setPollMin(String(minutes));
      setDirty(false);
      setNotice('已保存并同步');
    } catch {
      /* store.error 已经拿到可读文案；这里不重复提示。 */
    }
  };

  const handleRun = async () => {
    try {
      const report = await run();
      setNotice(
        report.errors.length > 0
          ? `同步完成，但有 ${report.errors.length} 个落点失败`
          : `同步完成：写入 ${report.exported} 个落点，导入 ${report.imported} 条`,
      );
    } catch {
      /* store.error */
    }
  };

  const handleOpen = async (kind: MdSyncBinding['kind']) => {
    try {
      await mdSyncApi.open(kind);
    } catch (err) {
      setNotice(errorText(err));
    }
  };

  return (
    <div className="sync">
      <div className="sync__bar">
        <div className="sync__intro">
          <h3 className="sync__title">Markdown 双向同步</h3>
          <p className="sync__hint">
            默认每 {describeInterval(Number.parseInt(pollMin, 10) || POLL_DEFAULT_MINUTES)}自动对齐一次；
            两边同时改过时，以 Markdown 为准。想立刻同步点「立即同步」。
          </p>
          {view?.installed && (
            <p className="sync__plugin">
              插件：{view.pluginName} v{view.pluginVersion}
            </p>
          )}
        </div>
        <div className="sync__enable">
          <span className="sync__label">启用</span>
          <Switch
            checked={enabled}
            label="启用 Markdown 同步"
            disabled={saving}
            onChange={(next) => {
              setEnabled(next);
              setDirty(true);
              setNotice(null);
            }}
          />
          <button
            type="button"
            className="sync__fold-btn"
            aria-expanded={settingsOpen}
            aria-controls="md-sync-settings"
            aria-label={settingsOpen ? '收起同步设置' : '展开同步设置'}
            title={settingsOpen ? '收起设置' : '展开设置'}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            {settingsOpen ? (
              <ChevronDownIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            ) : (
              <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            )}
          </button>
        </div>
      </div>

      {!settingsOpen && (
        <button
          type="button"
          className="sync__folded"
          aria-controls="md-sync-settings"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>{enabled ? '落点设置已收纳' : '同步已关闭，落点设置已自动收纳'}</span>
          <span className="sync__folded-meta">{bindings.length} 个落点</span>
          <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      )}

      {loaded && view && !view.installed && (
        <p className="sync__warn">
          未检测到声明 mdSync 的插件。把 <code>plugins/md-sync</code> 放进插件目录后，到「插件」页签点「重新加载」。
        </p>
      )}

      {error && <p className="sync__error">{error}</p>}
      {notice && <p className="sync__ok">{notice}</p>}

      <div id="md-sync-settings" className="sync__body" hidden={!settingsOpen}>
        {/* [V0.11.3] 同步间隔：原先固定 2 秒，现在默认 15 分钟、可调 */}
        <div className="sync__interval">
          <span className="sync__label">同步间隔</span>
          <label className="num-field">
            <input
              className="num-field__input"
              type="number"
              inputMode="numeric"
              min={POLL_MIN_MINUTES}
              max={POLL_MAX_MINUTES}
              step={1}
              value={pollMin}
              aria-label="自动同步间隔（分钟）"
              title="输入分钟数后回车或点别处生效"
              disabled={saving || !enabled}
              onChange={(e) => setPollMin(e.target.value)}
              onBlur={(e) => commitPoll(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitPoll(e.currentTarget.value);
                }
              }}
            />
            <span className="num-field__unit">MIN</span>
          </label>
          <span className="sync__interval-hint">
            {POLL_MIN_MINUTES} 分钟 ~ {POLL_MAX_MINUTES / 60} 小时，改动后点「保存并同步」
          </span>
        </div>

        {bindings.length === 0 ? (
          <p className="sync__empty">
            {loading ? '正在读取落点…' : '这个插件没有声明可同步的落点。'}
          </p>
        ) : (
          bindings.map((binding, index) => (
            <MdSyncBindingCard
              key={`${binding.kind}-${index}`}
              binding={binding}
              status={view?.status.bindings.find((item) => item.kind === binding.kind)}
              today={view?.today ?? ''}
              disabled={saving}
              onChange={(next) => update(index, next)}
              onPick={() => void handlePick(index)}
              onOpen={() => void handleOpen(binding.kind)}
            />
          ))
        )}

        <div className="sync__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={saving || loading || bindings.length === 0 || dirty}
          title={dirty ? '有未保存的修改，先保存再同步' : '按已保存的配置同步一轮'}
          onClick={() => void handleRun()}
        >
          立即同步
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || loading || bindings.length === 0}
          onClick={() => void handleSave()}
        >
          {saving ? '保存中…' : '保存并同步'}
        </button>
      </div>

        <p className="sync__foot">
          文件模板支持 {'{date}'}、{'{yyyy}'}、{'{MM}'}、{'{dd}'}；根目录支持 {'%USERPROFILE%'} 与开头的 ~。
          同步只改目标标题下的区块，日记其他内容不动。
        </p>
      </div>
    </div>
  );
}
