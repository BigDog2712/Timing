/**
 * Timing — 事项行长按菜单与编辑（停止计时 / 编辑 / 归档 / 删除）
 * -----------------------------------------------------------------------------
 * 桌面的右键菜单（`ItemMenu` / `TodosItemMenu`）在手机上必须是长按（PRD §5 D11），
 * 而且必须给**停止计时**一个位置——手机上用户不会去猜「再点一次行就是停」。
 *
 * 删除与归档的差别写进文案：归档只是从选择器里消失、历史记录还在；
 * 删除是软删事项，历史记录同样保留（ADR-021），但新建同名事项会得到**新 id**。
 * 「未归类」受后端保护：删除 / 归档都会返回 ITEM_SYSTEM_PROTECTED，这里只把错误转成提示。
 */
import { useEffect, useMemo, useState } from 'react';
import { ITEM_NAME_MAX_CHARS } from '../../lib/constants';
import { itemTimerMinutes, ITEM_TIMER_MAX_MINUTES } from '../../lib/commonItems';
import { startOfDay } from '../../lib/time';
import { formatClockTime, formatDuration } from '../../lib/format';
import { aiApi, errorText, itemApi, recordApi, tagApi } from '../../services/api';
import { useItemStore } from '../../stores/itemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { writeItemTimer } from '../../services/itemTimerWrite';
import { itemMemoryEntries, pickExamples, resolveLocally } from '../../services/aiMemory';
import type { TimeRecord } from '../../types/domain';
import { Sheet } from './Sheet';

interface ItemMenuSheetProps {
  itemId: number;
}

export function ItemMenuSheet({ itemId }: ItemMenuSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const bumpRecords = useMobileUiStore((s) => s.bumpRecords);
  const items = useItemStore((s) => s.items);
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const timerActions = useTimerActions();
  const [mode, setMode] = useState<'menu' | 'edit' | 'confirmDelete'>('menu');
  const [name, setName] = useState('');
  const [timerMode, setTimerMode] = useState<'countup' | 'countdown'>('countup');
  const [minutes, setMinutes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagHint, setTagHint] = useState('');
  const [todayRecords, setTodayRecords] = useState<TimeRecord[]>([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [tagLoadError, setTagLoadError] = useState(false);
  const [timeEdit, setTimeEdit] = useState<number | null>(null);
  const [startClock, setStartClock] = useState('');
  const [endClock, setEndClock] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = useSettingsStore((s) => s.settings);

  const current = items.find((i) => i.id === itemId);
  const isSystem = current?.isSystem ?? false;
  const dayStart = useMemo(() => startOfDay(), []);
  const dayEnd = useMemo(() => {
    const next = new Date(dayStart);
    next.setDate(next.getDate() + 1);
    return next.getTime();
  }, [dayStart]);

  useEffect(() => {
    if (mode !== 'edit') return;
    let alive = true;
    void Promise.all([
      tagApi.list(),
      tagApi.catalog().catch(() => []),
      recordApi.list({ itemId, from: dayStart, to: dayEnd, limit: 100 }).catch(() => null),
    ]).then(([rows, catalog, records]) => {
      if (!alive) return;
      setTags(rows.find((row) => row.itemId === itemId)?.tags ?? []);
      setTagsLoaded(true);
      setTagLoadError(false);
      setTagOptions([...new Set([...catalog, ...rows.flatMap((row) => row.tags)])].sort((a, b) => a.localeCompare(b, 'zh-CN')));
      setTodayRecords(records?.items ?? []);
    }).catch((err) => {
      if (!alive) return;
      setTagLoadError(true);
      setTagHint(`标签读取失败，暂不能保存：${errorText(err)}`);
    });
    return () => { alive = false; };
  }, [mode, itemId, dayStart, dayEnd]);

  useEffect(() => {
    if (!current || mode !== 'edit') return;
    setName(current.name);
    const savedMinutes = itemTimerMinutes(settings.itemsTimers, itemId);
    setMinutes(savedMinutes == null ? '' : String(savedMinutes));
    setTimerMode(savedMinutes == null ? 'countup' : 'countdown');
  }, [current, itemId, mode, settings.itemsTimers]);
  const isActive = status !== 'idle' && session?.itemId === itemId;

  const fail = (err: unknown) => {
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  };

  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      done();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (busy || !current || !tagsLoaded || tagLoadError) return;
    const nextName = name.trim();
    if (!nextName) return;
    const parsedMinutes = minutes.trim() === '' ? null : Number(minutes);
    if (timerMode === 'countdown' && (!Number.isInteger(parsedMinutes) || parsedMinutes! < 1 || parsedMinutes! > ITEM_TIMER_MAX_MINUTES)) {
      setTagHint(`默认时长请输入 1–${ITEM_TIMER_MAX_MINUTES} 分钟`);
      return;
    }
    setBusy(true);
    try {
      if (nextName !== current.name) await itemApi.update({ id: itemId, patch: { name: nextName } });
      await writeItemTimer(itemId, timerMode === 'countdown' ? parsedMinutes : null);
      try {
        await tagApi.set(itemId, tags);
      } catch (err) {
        setTagHint(`事项已保存，标签没保存上：${errorText(err)}`);
        return;
      }
      await useItemStore.getState().reload();
      bumpRecords();
      closeSheet('itemMenu');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const suggestTags = async () => {
    if (busy) return;
    setBusy(true);
    setTagHint('');
    try {
      const [rows, allItems] = await Promise.all([tagApi.list().catch(() => []), itemApi.list().catch(() => items)]);
      const tagsByItem = new Map(rows.map((row) => [row.itemId, row.tags]));
      const memory = itemMemoryEntries(allItems, tagsByItem, new Set([String(itemId)]));
      if (tags.length === 0) {
        const local = resolveLocally([{ id: String(itemId), text: name.trim(), existing: [] }], memory);
        const hit = local.hints[0];
        if (hit) {
          setTags(hit.tags.slice(0, 8));
          setTagHint(`按记忆填入 ${hit.tags.join('、')}（没调用模型）`);
          return;
        }
      }
      const response = await aiApi.suggestTags({
        mode: 'item',
        targets: [{ id: String(itemId), text: name.trim(), existing: tags }],
        candidates: tagOptions.map((tag) => ({ key: tag, label: tag })).slice(0, 200),
        examples: pickExamples([name], memory),
      });
      const proposed = response.suggestions.find((row) => row.id === String(itemId))?.tags ?? [];
      const next = [...tags];
      for (const tag of proposed) if (!next.includes(tag) && next.length < 8) next.push(tag);
      setTags(next);
      setTagHint(next.length === tags.length ? 'AI 没有给出更合适的标签' : response.created?.length ? `AI 新建了 ${response.created.join('、')}` : '建议已填入，保存后生效');
    } catch (err) {
      setTagHint(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const addTag = () => {
    const tag = tagDraft.trim().replace(/^#+/, '').split('/').map((part) => part.trim()).filter(Boolean).join('/').slice(0, 64);
    setTagDraft('');
    if (!tag || tags.includes(tag)) return;
    if (tags.length >= 8) { setTagHint('最多 8 个标签'); return; }
    setTagHint('');
    setTags([...tags, tag]);
    setTagOptions((options) => options.includes(tag) ? options : [...options, tag].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  };

  const editRecordTime = async (record: TimeRecord) => {
    if (busy) return;
    if (record.endedAt == null || new Date(record.endedAt).toDateString() !== new Date(record.startedAt).toDateString()) return;
    const start = new Date(record.startedAt);
    const end = new Date(record.endedAt);
    const startValue = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const endValue = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    const toMs = (clock: string) => {
      const [hour, minute] = clock.split(':').map(Number);
      const value = new Date(start);
      value.setHours(hour, minute, 0, 0);
      return value.getTime();
    };
    const startMs = toMs(startClock || startValue);
    const endMs = toMs(endClock || endValue);
    if (startMs < dayStart || startMs >= dayEnd || endMs < dayStart || endMs >= dayEnd) {
      setTagHint('时间必须在今天之内');
      return;
    }
    if (endMs <= startMs) {
      setTagHint('结束时间必须晚于开始时间');
      return;
    }
    setBusy(true);
    try {
      await recordApi.update(record.id, { startedAt: startMs, endedAt: endMs });
      setTimeEdit(null);
      setTagHint('记录时刻已更新');
      const result = await recordApi.list({ itemId, from: dayStart, to: dayEnd, limit: 100 });
      setTodayRecords(result.items);
      bumpRecords();
    } catch (err) {
      setTagHint(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const doArchive = () => {
    void run(async () => {
      await itemApi.archive({ id: itemId });
      await useItemStore.getState().reload();
      bumpRecords();
    }, closeSheet);
  };

  const doDelete = () => {
    void run(async () => {
      await itemApi.remove({ id: itemId });
      await useItemStore.getState().reload();
      bumpRecords();
    }, closeSheet);
  };

  const footer =
    mode === 'edit' ? (
      <div className="m-sheet__foot-row">
        <button type="button" className="m-btn m-field--grow" disabled={busy} onClick={() => setMode('menu')}>
          取消
        </button>
        <button type="button" className="m-btn m-btn--primary" disabled={!name.trim() || busy || !tagsLoaded || tagLoadError} onClick={() => void saveEdit()}>
          {busy ? '保存中…' : !tagsLoaded ? '读取中…' : '保存事项'}
        </button>
      </div>
    ) : mode === 'confirmDelete' ? (
      <div className="m-sheet__foot-row">
        <button type="button" className="m-btn m-field--grow" onClick={() => setMode('menu')}>
          取消
        </button>
        <button type="button" className="m-btn m-btn--danger" disabled={busy} onClick={doDelete}>
          确认删除
        </button>
      </div>
    ) : undefined;

  return (
    <Sheet title={current?.name ?? '事项'} onClose={() => closeSheet('itemMenu')} footer={footer}>
      {mode === 'menu' && (
        <div className="m-actions">
          <button
            type="button"
            className="m-action"
            disabled={!isActive}
            data-tone="danger"
            onClick={() =>
              void run(async () => {
                await timerActions.stop();
              }, closeSheet)
            }
          >
            停止计时
            {!isActive && <span className="m-action__hint">这条没有在计时</span>}
          </button>
          <button type="button" className="m-action" onClick={() => setMode('edit')}>
            编辑事项
            <span className="m-action__hint">名称、计时模式、默认时长与标签</span>
          </button>
          <button type="button" className="m-action" onClick={doArchive}>
            归档
            <span className="m-action__hint">从选择器里移除，历史记录保留</span>
          </button>
          <button type="button" className="m-action" data-tone="danger" onClick={() => setMode('confirmDelete')}>
            删除
            <span className="m-action__hint">软删除事项，历史记录仍归属它</span>
          </button>
        </div>
      )}

      {mode === 'edit' && (
        <div className="m-item-edit">
          <label className="m-field">
            <span className="m-field__label">事项名称</span>
            <input className="m-input" value={name} maxLength={ITEM_NAME_MAX_CHARS} autoFocus disabled={isSystem || busy} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="m-item-edit__group">
            <legend className="m-field__label">计时模式</legend>
            <div className="m-seg" role="group" aria-label="计时模式">
              <button type="button" className="m-seg__item" data-on={timerMode === 'countup' ? 'true' : 'false'} disabled={busy} onClick={() => setTimerMode('countup')}>正计时</button>
              <button type="button" className="m-seg__item" data-on={timerMode === 'countdown' ? 'true' : 'false'} disabled={busy} onClick={() => setTimerMode('countdown')}>倒计时</button>
            </div>
          </fieldset>
          {timerMode === 'countdown' && (
            <label className="m-field">
              <span className="m-field__label">默认时长（分钟）</span>
              <input className="m-input" type="number" min={1} max={ITEM_TIMER_MAX_MINUTES} step={1} inputMode="numeric" value={minutes} disabled={busy} onChange={(e) => setMinutes(e.target.value)} />
            </label>
          )}
          <section className="m-item-edit__section">
            <div className="m-section__head">
              <h3 className="m-section__title">标签</h3>
              <button type="button" className="m-link" disabled={busy || !tagsLoaded} onClick={() => void suggestTags()}>{busy ? '建议中…' : 'AI 建议'}</button>
            </div>
            <div className="m-item-edit__tags">
              {tags.map((tag) => <button key={tag} type="button" className="m-item-edit__tag" aria-label={`移除标签 ${tag}`} disabled={busy} onClick={() => setTags(tags.filter((value) => value !== tag))}>#{tag} ×</button>)}
            </div>
            <div className="m-sheet__foot-row">
              <input className="m-input m-field--grow" list="m-item-edit-tag-options" value={tagDraft} disabled={busy} placeholder="回车添加，如 工作/周报" onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addTag(); } }} />
              <datalist id="m-item-edit-tag-options">{tagOptions.map((tag) => <option key={tag} value={tag} />)}</datalist>
              <button type="button" className="m-btn m-btn--small" disabled={busy || !tagDraft.trim()} onClick={addTag}>添加</button>
            </div>
            {tagHint && <p className="m-hint" role="status">{tagHint}</p>}
            {!tagsLoaded && <p className="m-hint" role="status">正在读取标签…</p>}
          </section>
          <section className="m-item-edit__section">
            <div className="m-section__head">
              <h3 className="m-section__title">今日记录</h3>
              <span className="m-section__meta">{todayRecords.length} 段</span>
            </div>
            {todayRecords.length === 0 ? <p className="m-empty">今天还没有这条事项的记录</p> : (
              <ul className="m-list">
                {todayRecords.map((record) => (
                  <li key={record.id} className="m-item-edit__record">
                    <span>{formatClockTime(record.startedAt)}–{record.endedAt == null ? '进行中' : formatClockTime(record.endedAt)}</span>
                    <span>{formatDuration(record.accumulatedSec)}</span>
                    {record.endedAt == null ? <span className="m-item-edit__record-note">进行中的记录不能改时刻</span> : new Date(record.endedAt).toDateString() !== new Date(record.startedAt).toDateString() ? <span className="m-item-edit__record-note">跨日记录请到「记录」页编辑</span> : timeEdit === record.id ? (
                      <div className="m-item-edit__time">
                        <input className="m-input" aria-label="开始时间" type="time" value={startClock} onChange={(e) => setStartClock(e.target.value)} />
                        <input className="m-input" aria-label="结束时间" type="time" value={endClock} onChange={(e) => setEndClock(e.target.value)} />
                        <button type="button" className="m-btn m-btn--small m-btn--primary" disabled={busy} onClick={() => void editRecordTime(record)}>保存时刻</button>
                      </div>
                    ) : <button type="button" className="m-link" disabled={busy} onClick={() => { const s = new Date(record.startedAt); const e = new Date(record.endedAt ?? record.startedAt); setStartClock(`${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`); setEndClock(`${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`); setTimeEdit(record.id); }}>改起止</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="m-hint">应用绑定暂不支持在安卓端配置；这里只显示与桌面可共用的事项属性。</p>
        </div>
      )}

      {mode === 'confirmDelete' && (
        <p className="m-hint">删除「{current?.name}」后它不再出现在选择器，今日记录里仍按原归属显示。</p>
      )}
    </Sheet>
  );
}
