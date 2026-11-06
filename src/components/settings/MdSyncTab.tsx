/**
 * Timing — 设置 · 同步页签（V0.4.0 起；V0.11.5 起是**内核功能**，不再是插件贡献点）
 * -----------------------------------------------------------------------------
 * 本文件只留版面：标题 + 总开关 + 折叠 / 间隔行 / 云端通道卡 / 落点卡列表 / 两个按钮 /
 * 备份卡。状态与副作用在 `useMdSyncDraft`，数字口径在 `mdSyncConfig`——[V0.11.13] 拆开很
 * 实在：拆之前 298 行，新增云端与备份两块已无处可放。草稿策略：输入只改本地 state，点
 * 「保存并同步」才落 `settings` KV；轮询照旧在后台跑，`dirty` 时事件不覆盖草稿。
 */
import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, SettingsIcon, iconStroke } from '../../lib/icons';
import { pickFolder } from '../../services/folderPicker';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { Switch } from '../ui/Switch';
import { MdSyncBackupCard } from './MdSyncBackupCard';
import { MdSyncBindingCard } from './MdSyncBindingCard';
import { MdSyncCloudCard } from './MdSyncCloudCard';
import {
  POLL_MAX_MINUTES,
  POLL_MIN_MINUTES,
  clampMinutes,
  describeInterval,
} from './mdSyncConfig';
import { useMdSyncDraft } from './useMdSyncDraft';

export function MdSyncTab() {
  const draft = useMdSyncDraft();
  /* 落点的运行状态与「今天」不属于草稿（草稿只管用户能改的东西），直接读视图 */
  const view = useMdSyncStore((s) => s.view);
  const { enabled, bindings, pollMin, saving, loading, loaded, dirty, error, notice } = draft;
  const [settingsOpen, setSettingsOpen] = useState(true);

  /* 关掉总开关时把落点设置自动收起来；重新打开时展开。
     [V0.11.5] 去掉「插件未安装就展开」——同步已是内核功能，没有装没装这回事。 */
  useEffect(() => {
    setSettingsOpen(enabled);
  }, [enabled]);

  const handlePick = async (index: number) => {
    const current = bindings[index];
    if (!current) return;
    const picked = await pickFolder(
      `选择「${MD_SYNC_KIND_LABELS[current.kind]}」落点根目录`,
      current.root.includes('%') ? undefined : current.root,
    );
    if (picked) draft.updateBinding(index, { ...current, root: picked });
  };

  return (
    <div className="sync">
      <div className="sync__bar">
        <div className="sync__intro">
          <h3 className="sync__title">Markdown 双向同步</h3>
          <p className="sync__hint">
            默认每 {describeInterval(clampMinutes(pollMin))}自动对齐一次；
            两边同时改过时，以 Markdown 为准。想立刻同步点「立即同步」。
          </p>
          {/* [V0.11.5] 出厂默认关：三档落点已备好，但要用户自己把总开关打开。 */}
          {loaded && !enabled && (
            <p className="sync__hint">
              同步出厂默认关闭：三档落点已经备好，把右侧「启用」打开即可开始。
            </p>
          )}
        </div>
        <div className="sync__enable">
          <span className="sync__label">启用</span>
          <Switch checked={enabled} label="启用 Markdown 同步" disabled={saving}
            onChange={(next) => draft.setEnabled(next)} />
          <button type="button" className="sync__fold-btn" aria-expanded={settingsOpen}
            aria-controls="md-sync-settings" aria-label={settingsOpen ? '收起同步设置' : '展开同步设置'}
            title={settingsOpen ? '收起设置' : '展开设置'}
            onClick={() => setSettingsOpen((value) => !value)}>
            {settingsOpen
              ? <ChevronDownIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              : <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />}
          </button>
        </div>
      </div>

      {!settingsOpen && (
        <button type="button" className="sync__folded" aria-controls="md-sync-settings"
          onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
          <span>{enabled ? '落点设置已收纳' : '同步已关闭，落点设置已自动收纳'}</span>
          <span className="sync__folded-meta">{bindings.length} 个落点</span>
          <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
        </button>
      )}

      {error && <p className="sync__error">{error}</p>}
      {notice && <p className="sync__ok">{notice}</p>}

      <div id="md-sync-settings" className="sync__body" hidden={!settingsOpen}>
        {/* [V0.11.3] 同步间隔：原先固定 2 秒，现在默认 15 分钟、可调 */}
        <div className="sync__interval">
          <span className="sync__label">同步间隔</span>
          <label className="num-field">
            <input className="num-field__input" type="number" inputMode="numeric"
              min={POLL_MIN_MINUTES} max={POLL_MAX_MINUTES} step={1} value={pollMin}
              aria-label="自动同步间隔（分钟）" title="输入分钟数后回车或点别处生效"
              disabled={saving || !enabled}
              onChange={(e) => draft.setPollMin(e.target.value)}
              onBlur={(e) => draft.commitPoll(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  draft.commitPoll(e.currentTarget.value);
                }
              }} />
            <span className="num-field__unit">MIN</span>
          </label>
          <span className="sync__interval-hint">
            {POLL_MIN_MINUTES} 分钟 ~ {POLL_MAX_MINUTES / 60} 小时，改动后点「保存并同步」
          </span>
        </div>

        <MdSyncCloudCard draft={draft} />

        {bindings.length === 0 ? (
          <p className="sync__empty">{loading ? '正在读取落点…' : '没有可同步的落点。'}</p>
        ) : (
          bindings.map((binding, index) => (
            <MdSyncBindingCard
              key={`${binding.kind}-${index}`}
              binding={binding}
              status={view?.status.bindings.find((item) => item.kind === binding.kind)}
              today={view?.today ?? ''}
              disabled={saving}
              onChange={(next) => draft.updateBinding(index, next)}
              onPick={() => void handlePick(index)}
              onOpen={() => void draft.open(binding.kind)}
            />
          ))
        )}

        <div className="sync__actions">
          <button type="button" className="btn btn--ghost"
            disabled={saving || loading || bindings.length === 0 || dirty}
            title={dirty ? '有未保存的修改，先保存再同步' : '按已保存的配置同步一轮'}
            onClick={() => void draft.run()}>
            立即同步
          </button>
          <button type="button" className="btn btn--primary"
            disabled={saving || loading || bindings.length === 0}
            onClick={() => void draft.save()}>
            {saving ? '保存中…' : '保存并同步'}
          </button>
        </div>

        <MdSyncBackupCard />

        <p className="sync__foot">
          文件模板支持 {'{date}'}、{'{yyyy}'}、{'{MM}'}、{'{dd}'}；根目录支持 {'%APP_DIR%'}、{'%USERPROFILE%'} 与开头的 ~。
          同步只改目标标题下的区块，日记其他内容不动。
        </p>
      </div>
    </div>
  );
}
