/**
 * Timing — 摸鱼菜单 · 常用摸鱼管理 MoyuManage（V0.3.9）
 * -----------------------------------------------------------------------------
 * 入口：摸鱼菜单末行「管理常用摸鱼…」。
 *
 * 能力对齐用户口径：记录 **事项名称 / 时间 / 正计时还是倒计时**，并**排序**。
 *   - 列表顺序 = 菜单展示顺序：↑ / ↓ 直接换位并落库（不做拖拽，触屏与键盘都稳）；
 *   - 新增与编辑共用一张表单；编辑时表单预填，取消回到新增态；
 *   - 每次变更整表覆盖保存（settings KV `moyu.presets`），失败提示并保留旧值。
 *
 * 为什么不用插件：V0.3.9 起常用摸鱼是**应用内置功能**，插件的 `quickTimers`
 * 仍由设置页展示，但不再驱动这个菜单（见 ADR-026）。
 */
import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { errorText } from '../../services/ipc';
import { settingsApi } from '../../services/api';
import { fitBounds } from '../../lib/fitBounds';
import { formatMinutes } from '../../lib/format';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  TrashIcon,
  iconStroke,
} from '../../lib/icons';
import {
  clampMoyuMinutes,
  moveMoyuPreset,
  normalizeMoyuPresets,
  MOYU_DEFAULT_MINUTES,
  MOYU_MAX_MINUTES,
  MOYU_MIN_MINUTES,
  MOYU_NAME_MAX_LEN,
} from '../../lib/moyu';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import type { MoyuPreset, TimerMode } from '../../types/domain';
import '../../styles/moyu.css';

const W = 248;
const EDGE = 4;
/** 贴底时至少留这么高（再小就只剩半行表单了），超出部分列表内部滚动 */
const MIN_H = 220;

interface MoyuManageProps {
  anchor: MenuPos;
  onBack: () => void;
}

function newPresetId(): string {
  const provider = globalThis.crypto;
  if (provider && typeof provider.randomUUID === 'function') return provider.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function MoyuManage({ anchor, onBack }: MoyuManageProps) {
  const presets = useSettingsStore((s) => s.settings.moyuPresets);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [minutes, setMinutes] = useState(MOYU_DEFAULT_MINUTES);
  const [busy, setBusy] = useState(false);

  const persist = useCallback(async (next: MoyuPreset[]) => {
    setBusy(true);
    try {
      const saved = await settingsApi.update({ moyuPresets: normalizeMoyuPresets(next) });
      useSettingsStore.getState().setSettings(saved);
      return true;
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setMode('countdown');
    setMinutes(MOYU_DEFAULT_MINUTES);
  };

  const startEdit = (preset: MoyuPreset) => {
    setEditingId(preset.id);
    setName(preset.item);
    setMode(preset.mode);
    setMinutes(preset.mode === 'countdown' ? preset.minutes : MOYU_DEFAULT_MINUTES);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const item = name.trim();
    if (item.length === 0 || busy) return;
    const safeMode: TimerMode = mode;
    const safeMinutes = safeMode === 'countdown' ? clampMoyuMinutes(minutes) : MOYU_DEFAULT_MINUTES;
    const next = editingId
      ? presets.map((p) => (p.id === editingId ? { ...p, item, mode: safeMode, minutes: safeMinutes } : p))
      : [...presets, { id: newPresetId(), item, mode: safeMode, minutes: safeMinutes }];
    void persist(next).then((ok) => {
      if (ok) resetForm();
    });
  };

  const remove = (preset: MoyuPreset) => {
    if (busy) return;
    if (editingId === preset.id) resetForm();
    void persist(presets.filter((p) => p.id !== preset.id));
  };

  const shift = (index: number, delta: number) => {
    if (busy) return;
    void persist(moveMoyuPreset(presets, index, delta));
  };

  const placement = useMemo(() => {
    const viewport = fitBounds();
    const leftEdge = viewport.x + EDGE;
    const topEdge = viewport.y + EDGE;
    const left = Math.min(Math.max(anchor.x, leftEdge), Math.max(leftEdge, viewport.x + viewport.w - W - EDGE));
    const top = Math.min(Math.max(anchor.y, topEdge), Math.max(topEdge, viewport.y + viewport.h - MIN_H - EDGE));
    return { left, top, maxHeight: Math.max(MIN_H, viewport.y + viewport.h - top - EDGE) };
  }, [anchor.x, anchor.y]);

  return (
    <>
      <div className="menu-scrim" onMouseDown={onBack} aria-hidden />
      <div
        className="menu moyu-manage"
        role="dialog"
        aria-label="管理常用摸鱼"
        style={{
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          width: `${W}px`,
          maxHeight: `${placement.maxHeight}px`,
        }}
      >
        <div className="menu__group">常用摸鱼 · 顺序即菜单顺序</div>

        <div className="moyu-manage__list">
          {presets.length === 0 && <p className="moyu-manage__empty">还没有条目，用下面的表单添加</p>}
          {presets.map((preset, index) => (
            <div className="moyu-manage__row" key={preset.id} data-editing={editingId === preset.id}>
              <span className="moyu-manage__name" title={preset.item}>
                {preset.item}
              </span>
              <span className="moyu-manage__meta">
                {preset.mode === 'countdown' ? formatMinutes(preset.minutes * 60) : '正计时'}
              </span>
              <button
                type="button"
                className="moyu-manage__act"
                aria-label={`上移「${preset.item}」`}
                disabled={busy || index === 0}
                onClick={() => shift(index, -1)}
              >
                <ChevronUpIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              </button>
              <button
                type="button"
                className="moyu-manage__act"
                aria-label={`下移「${preset.item}」`}
                disabled={busy || index === presets.length - 1}
                onClick={() => shift(index, 1)}
              >
                <ChevronDownIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              </button>
              <button
                type="button"
                className="moyu-manage__act"
                aria-label={`编辑「${preset.item}」`}
                disabled={busy}
                onClick={() => startEdit(preset)}
              >
                <PencilIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              </button>
              <button
                type="button"
                className="moyu-manage__act moyu-manage__act--danger"
                aria-label={`删除「${preset.item}」`}
                disabled={busy}
                onClick={() => void remove(preset)}
              >
                <TrashIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <div className="menu__sep" />

        <form className="moyu-manage__form" onSubmit={submit}>
          <div className="menu__group">{editingId ? '编辑条目' : '新增条目'}</div>
          <input
            type="text"
            className="moyu-custom__input"
            placeholder="事项名称，如「刷手机」"
            maxLength={MOYU_NAME_MAX_LEN}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="moyu-manage__mode" role="group" aria-label="计时方式">
            <button
              type="button"
              data-on={mode === 'countdown'}
              onClick={() => setMode('countdown')}
            >
              倒计时
            </button>
            <button type="button" data-on={mode === 'countup'} onClick={() => setMode('countup')}>
              正计时
            </button>
          </div>
          {mode === 'countdown' && (
            <label className="moyu-manage__minutes">
              <input
                type="number"
                className="moyu-custom__input"
                min={MOYU_MIN_MINUTES}
                max={MOYU_MAX_MINUTES}
                step={1}
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
              <span>分钟</span>
            </label>
          )}
          <div className="moyu-manage__actions">
            <button type="button" className="btn btn--ghost" onClick={editingId ? resetForm : onBack}>
              {editingId ? '取消编辑' : '返回'}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || name.trim().length === 0}>
              {editingId ? '保存' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
