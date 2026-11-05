/**
 * Timing — 「换事项方式」选单（分段 + 人话说明，两处入口共用）
 * -----------------------------------------------------------------------------
 * 为什么抽出来：`end_and_start` / `just_switch` 这两句人话（PRD P0-2）现在有两个入口
 *   - 计时页「换事项」Sheet：先挑事项，方式在顶部；
 *   - 事项页「已经在计时时点某条待办」：先定方式，再切过去。
 * 文案各写一份，两边迟早分叉（一处改了另一处没跟上，用户就会看到同一件事两种说法），
 * 所以口径只留本文件：`SWITCH_MODES` 是唯一来源。
 *
 * 为什么 `SwitchModeSeg` 只「选」不「确认」：
 *   - 换事项 Sheet 里选完还要挑事项，分段即全部 UI，多一个确认按钮是纯负担；
 *   - 待办 Sheet 里选完会**当场改动一条正在计时的记录**（结束并新开还会落两段），
 *     点错一格就写坏了记录，所以那一层必须再给一次确认。
 */
import { useState } from 'react';
import { mobileTimerActions } from '../../services/mobileTimerActions';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import type { SwitchMode } from '../../types/domain';
import { Sheet } from './Sheet';

interface ModeOption {
  id: SwitchMode;
  label: string;
  hint: string;
}

/** 两种切换的唯一文案来源（两处入口都从这里取，禁止就地再写一份） */
const SWITCH_MODES: readonly ModeOption[] = [
  { id: 'end_and_start', label: '结束并新开', hint: '这段记入记录，新事项从 0 开始' },
  { id: 'just_switch', label: '仅改归属', hint: '时长连续，仍是同一条记录' },
];

/** 取当前方式的一句话说明（找不到时留空，宁可少说也不说错） */
function switchModeHint(mode: SwitchMode): string {
  return SWITCH_MODES.find((option) => option.id === mode)?.hint ?? '';
}

interface SwitchModeSegProps {
  mode: SwitchMode;
  onChange: (mode: SwitchMode) => void;
  disabled?: boolean;
}

/** 方式分段控件 + 说明（`m-seg` 原语，44px 命中区由 primitives.css 保证） */
export function SwitchModeSeg({ mode, onChange, disabled = false }: SwitchModeSegProps) {
  return (
    <>
      <div className="m-seg" role="radiogroup" aria-label="切换方式">
        {SWITCH_MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            className="m-seg__item"
            data-on={mode === option.id ? 'true' : 'false'}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="m-hint">{switchModeHint(mode)}</p>
    </>
  );
}

interface TodoSwitchSheetProps {
  todoId: number;
  /** 待办标题：既用来找同名事项，也用来把话说清楚（「开始「写周报」」） */
  title: string;
}

/**
 * 计时中点待办的确认面板。
 * 这里只说「已经在计时」这一件事，并给出两种收尾方式；真正的动作在
 * `mobileTimerActions.startTodo(todo, mode)`（它保证「切换成功才删待办」）。
 */
export function TodoSwitchSheet({ todoId, title }: TodoSwitchSheetProps) {
  const closeSheet = useMobileUiStore((s) => s.closeSheet);
  const [mode, setMode] = useState<SwitchMode>('end_and_start');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    /* 失败提示由 mobileTimerActions 统一弹（notify）；待办原样留在列表里可重试 */
    await mobileTimerActions.startTodo({ id: todoId, title }, mode);
    setBusy(false);
    closeSheet();
  };

  return (
    <Sheet
      title={`开始「${title}」`}
      onClose={closeSheet}
      footer={
        <div className="m-sheet__foot-row">
          <button type="button" className="m-btn m-field--grow" disabled={busy} onClick={closeSheet}>
            取消
          </button>
          <button type="button" className="m-btn m-btn--primary" disabled={busy} onClick={() => void confirm()}>
            就这样切
          </button>
        </div>
      }
    >
      <p className="m-hint">现在有一条正在计时，先决定这一段怎么收尾。</p>
      <SwitchModeSeg mode={mode} onChange={setMode} disabled={busy} />
    </Sheet>
  );
}
