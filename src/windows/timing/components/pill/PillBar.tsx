/**
 * Timing — 药丸主视图 PillBar（常驻，AC-01）
 * -----------------------------------------------------------------------------
 * 区域操作以 Timing v1.7.3 MainForm.OnMouseUp 为准；拖动由 usePillDrag 隔离。
 * 键盘：Space 开始/暂停，Enter 结束；Menu / Shift+F10 菜单，Esc 收起。
 * 视觉四态：idle / running / paused / ended（ended 为 900ms 瞬时确认，非状态机第四态）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { COUNTDOWN_WARN_SEC, DEBOUNCE_MS, HIGHLIGHT_MS } from '../../lib/constants';
import { clientToLayer } from '../../lib/fitBounds';
import { defaultCountdownSec } from '../../lib/countdown';
import { useTimerActions } from '../../hooks/useTimerActions';
import { useTimerTick } from '../../hooks/useTimerTick';
import { useEndedFlash } from '../../hooks/useEndedFlash';
import { usePillDrag } from '../../hooks/usePillDrag';
import { usePillInlineEdit } from '../../hooks/usePillInlineEdit';
import { usePillKeyboard } from '../../hooks/usePillKeyboard';
import { usePauseMoyu } from '../../hooks/usePauseMoyu';
import { usePillWheel } from '../../hooks/usePillWheel';
import { countdownActions } from '../../services/countdownActions';
import { readCountdownDuration, useCountdownArmStore } from '../../stores/countdownArm';
import { useSettingsStore } from '../../stores/settingsStore';
import { openTodosWindow } from '../../services/todosActions';
import { findItem, useItemStore } from '../../stores/itemStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import type { MenuPos } from '../../stores/uiStore';
import type { HandleActionCtx } from '../../services/handleActions/guards';
import { useHandleBindings } from '../../hooks/useHandleBindings';
import { toVisualState, type VisualState } from '../../types/ui';
import { HandleCluster } from './HandleCluster';
import { ItemName } from './ItemName';
import { InlineNameEntry } from './InlineNameEntry';
import { MainButton } from './MainButton';
import { NewItemEntry } from './NewItemEntry';
import { TimerDisplay } from './TimerDisplay';

/** [V0.3.1] 高亮闪烁总时长见 `lib/constants` 的 `HIGHLIGHT_MS`（圆点形态共用同一个值） */

const RING_LABEL: Record<VisualState, string> = {
  idle: '开始计时',
  running: '暂停计时',
  paused: '继续计时',
  ended: '已保存',
};

export function PillBar() {
  const actions = useTimerActions();
  const submitInline = usePillInlineEdit();
  const seconds = useTimerTick();
  const status = useTimerStore((s) => s.state.status);
  const session = useTimerStore((s) => s.state.session);
  const sessionItemId = useTimerStore((s) => s.state.session?.itemId ?? null);
  const lastItemId = useTimerStore((s) => s.state.lastItemId);
  /* [V0.2.5 · 5] 已设定的倒计时时长：idle 时小条直接显示它（参照 Timing v1.7.3 的 TimeText） */
  const armedSec = useCountdownArmStore((s) => s.armedSec);
  const arm = useCountdownArmStore((s) => s.arm);
  const clearArm = useCountdownArmStore((s) => s.clear);
  /* [P1 优化] 倒计时默认时长统一走参考设置（见 lib/countdown.ts），
     原先这里订阅 settings.countdownPresets 只为取第一档当默认值，口径不一致，已下线。 */
  const defaultSec = useSettingsStore((s) => defaultCountdownSec(s.referenceSettings));
  const items = useItemStore((s) => s.items);
  const openNotesList = useUiStore((s) => s.openNotesList);
  const panel = useUiStore((s) => s.panel);
  const countdownPos = useUiStore((s) => s.countdownPos);
  const countdownCardPos = useUiStore((s) => s.countdownCardPos);
  const moyuPos = useUiStore((s) => s.moyuPos);
  const commonItemsPos = useUiStore((s) => s.commonItemsPos);
  const reminderPopover = useUiStore((s) => s.reminderPopover);
  const notesListPos = useUiStore((s) => s.notesListPos);
  const itemMenu = useUiStore((s) => s.itemMenu);
  const inlineEdit = useUiStore((s) => s.inlineEdit);
  /** [V0.3.1] 托盘双击 → 高亮定位：序号变化即闪一下（3 × 0.8s） */
  const highlightSeq = useUiStore((s) => s.highlightSeq);
  const openInlineEdit = useUiStore((s) => s.openInlineEdit);
  const openCountdownMenu = useUiStore((s) => s.openCountdownMenu);
  const openMoyuMenu = useUiStore((s) => s.openMoyuMenu);
  const openCommonItems = useUiStore((s) => s.openCommonItems);
  const openCommonItemsNew = useUiStore((s) => s.openCommonItemsNew);
  const openPanel = useUiStore((s) => s.openPanel);
  /* [0.12.1] 手柄绑定：三形态 × 5 槽。跨窗改动由 appearanceSync 的"人回来就重读"送达 */
  const handleBindings = useHandleBindings();

  /* 未悬停时隐去背景板；任一悬浮层（面板 / 倒计时 / 摸鱼 / 提醒 / 便利贴清单 / 事项菜单）展开期间强制显影，
     避免交互中「药丸凭空消失」 */
  const revealed =
    panel !== 'none' ||
    countdownPos != null ||
    countdownCardPos != null ||
    moyuPos != null ||
    reminderPopover != null ||
    notesListPos != null ||
    inlineEdit != null ||
    itemMenu != null ||
    commonItemsPos != null;

  /* 结束态：900ms 瞬时视觉确认（--dur-confirm）。窗口判定在 hook 里，
     组件重挂载（折叠后展开）不会把上一次结束重放一遍。 */
  const ended = useEndedFlash();

  const visual = toVisualState(status, ended);

  /* [V0.3.1] 高亮定位：托盘双击后闪 3 下（0.8s × 3），到点自动摘掉属性。
     `highlightSeq` 从 0 起步——初始挂载不该闪，所以只在 > 0 时触发。 */
  const [highlighting, setHighlighting] = useState(false);
  useEffect(() => {
    if (highlightSeq <= 0) return;
    setHighlighting(true);
    const id = window.setTimeout(() => setHighlighting(false), HIGHLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [highlightSeq]);
  const currentItemId = status === 'idle' ? lastItemId : sessionItemId;
  const currentName = findItem(items, currentItemId)?.name;

  /* 就地长出输入框（不再弹 ItemPicker 面板）。[V0.3.9] 只剩「圆环 + 尚无任何事项」这条路径：
     空闲态的「新建事项」格已改为弹常用事项框（框里自带常驻输入框）。 */
  const beginCreate = useCallback(() => {
    if (status === 'running') {
      useUiStore.getState().setNotice({ text: '计时进行中，事项已锁定；请先暂停或结束当前计时。', tone: 'info' });
      return;
    }
    openInlineEdit({ itemId: null, initial: '' });
  }, [openInlineEdit, status]);

  /* 倒计时菜单整块 233px 高，用光标位置当锚点会盖住小条本身：统一贴到小条下沿 +4px 展开。
     rect 是 viewport 坐标，必须换回 layer 坐标；auto-fit 扩展窗口后 layer 会平移，不能直接拿 rect.bottom。 */
  const pillRef = useRef<HTMLDivElement>(null);
  const posBelowBar = useCallback((pos: MenuPos): MenuPos => {
    const rect = pillRef.current?.getBoundingClientRect();
    return rect ? { x: pos.x, y: clientToLayer(0, rect.bottom).y + 4 } : pos;
  }, []);

  /* 主菜单已删除（V0.3.1：用户口径「悬浮框右键唤出设置菜单」不要了），
     右下的注释保留说明：菜单锚点曾用 pill 的 rect 换算到层坐标。 */

  /* [V0.2.0] 倒计时：小条显示**剩余**（targetSec - accumulatedSec 派生），到点前 warn 提示
     [V0.2.5 · 5] 空闲但已设定档位时，小条直接显示该时长（等用户点圆环才开始倒数） */
  const isCountdown = session?.mode === 'countdown' && session.targetSec != null;
  const remaining = isCountdown ? Math.max(0, (session.targetSec ?? 0) - seconds) : 0;
  const armedIdle = status === 'idle' && armedSec != null;
  const displaySec = isCountdown ? remaining : armedIdle ? (armedSec ?? 0) : seconds;
  const nearEnd = isCountdown && remaining > 0 && remaining <= COUNTDOWN_WARN_SEC;

  /* [V0.3.8] 暂停即弹摸鱼菜单：方向判定 / 失败不弹 / 锚点同源等连招细节见 usePauseMoyu */
  const pauseAndOpenMoyu = usePauseMoyu(actions, pillRef, currentItemId);

  /* 左键：连点去抖；空闲且已设定倒计时档位时，左键 = 开始倒计时（参照 v1.7.3 的点开始）
     [V0.3.1] 运行中点击圆环只做暂停；[V0.3.8] 暂停后自动弹摸鱼菜单（连招补回） */
  const lastClickRef = useRef(0);
  const onRingClick = useCallback(() => {
    const t = Date.now();
    if (t - lastClickRef.current < DEBOUNCE_MS) return;
    lastClickRef.current = t;
    useUiStore.getState().closeCountdownCard();
    if (status === 'idle' && currentItemId == null) {
      beginCreate();
      return;
    }
    if (status === 'idle' && armedSec != null) {
      void countdownActions.start(currentItemId ?? undefined, armedSec, false);
      return;
    }
    /* [V0.3.8] running / paused 都交给连招：暂停弹摸鱼菜单、继续收菜单（方向判定在 hook 内） */
    pauseAndOpenMoyu();
  }, [armedSec, currentItemId, status, beginCreate, pauseAndOpenMoyu]);

  /* [V0.2.6] Zone.Time 左键：计时中/暂停 = 与圆环相同；空闲 = 正计时 ⇄ 倒计时切换
     （对齐 ToggleCountdownMode：切到倒计时用「默认倒计时时长」，再点回正计时） */
  const onTimeClick = useCallback(() => {
    if (status !== 'idle') {
      onRingClick();
      return;
    }
    if (armedSec != null) {
      clearArm();
      useUiStore.getState().setNotice({ text: '正计时', tone: 'info' });
      return;
    }
    /* [P1 优化] 默认值改读参考设置「默认倒计时」（Timing 默认 25 分钟），
       不再拿预设档位第一档（5 分钟）冒充默认；上次用过的时长仍优先（readCountdownDuration）。 */
    const duration = readCountdownDuration(defaultSec);
    arm(duration);
    useUiStore.getState().openCountdownCard(posBelowBar({ x: 32, y: 56 }));
  }, [status, onRingClick, armedSec, clearArm, arm, defaultSec, posBelowBar]);
  // 注：`openCountdownMenu` / `currentItemId` 曾列在依赖里但函数体内未使用（lint 已报
  // unnecessary-dependencies）。去掉不改变行为——两者都不是这里的闭包读取项。

  const drag = usePillDrag();
  /* [V0.2.10] 空闲时滚轮调倒计时：位移归一、攒够一格才步进的细节在 hook 里 */
  const onWheel = usePillWheel(status === 'idle', defaultSec);

  /* [V0.3.1] 小条右键不再唤出任何菜单（主菜单已整体删除）：
     只吞掉事件，避免 WebView2 弹出浏览器自带菜单。各子区域的右键语义见各自组件。 */
  const suppressContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
  };

  /* Space/Enter 只在圆环上生效，Esc 只收浮层——细节见 usePillKeyboard；
     [V0.3.8] Space 的暂停方向也要自动弹摸鱼菜单（与左键同一回调） */
  const handleKeyDown = usePillKeyboard(status, actions, pauseAndOpenMoyu);

  /* [0.12.1] 手柄派发上下文。`anchor` 不在这里：只有手柄自己知道自己的 rect（见 HandleButton） */
  const handleCtx: Omit<HandleActionCtx, 'anchor'> = {
    status,
    itemId: currentItemId,
    timer: actions,
    ui: { openPanel, openNotesList, openCountdownMenu, openMoyuMenu },
    notice: (text) => useUiStore.getState().setNotice({ text, tone: 'info' }),
  };

  return (
    <div
      ref={pillRef}
      className="pill"
      data-state={visual}
      data-reveal={revealed ? 'true' : undefined}
      data-highlight={highlighting ? 'true' : undefined}
      onPointerDown={(e) => {
        drag.onDown(e);
      }}
      onPointerMove={drag.onMove}
      onPointerUp={drag.onUp}
      onPointerCancel={drag.onUp}
      onClickCapture={drag.onClickCapture}
      onContextMenu={suppressContextMenu}
      onWheel={onWheel}
      onKeyDown={handleKeyDown}
    >
      <MainButton
        state={visual}
        label={
          armedIdle
            ? '开始倒计时（滚轮或右键数字改档位）'
            : status === 'paused'
              ? '继续计时（右键数字唤出摸鱼菜单）'
              : isCountdown
                ? `${RING_LABEL[visual]}（倒计时）`
                : RING_LABEL[visual]
        }
        onClick={onRingClick}
        countdown={isCountdown || armedIdle}
        progress={isCountdown && session?.targetSec ? remaining / session.targetSec : 1}
        warn={nearEnd}
        /* [V0.3.1] 右键主菜单删除后：空闲右键什么也不弹；计时中右键仍 = 结束并保存 */
        onMenu={status === 'idle' ? undefined : () => void actions.stop()}
      />
      <TimerDisplay
        seconds={displaySec}
        mode={isCountdown || armedIdle ? 'countdown' : 'countup'}
        tone={nearEnd ? 'warn' : 'default'}
        /* [V0.2.6] Zone.Time 左键：计时中 = 与圆环相同（暂停/继续）；空闲 = 正计时 ⇄ 倒计时切换 */
        onActivate={onTimeClick}
        /* [P2] 对齐 Timing v1.7.3 的 Zone.Time 右键（MainForm.cs OnMouseUp → ToggleCountdownMode）：
           空闲时右键数字**直接切倒计时**——一次给齐九档预设 / 输入分秒 / 改为正计时 / 开始倒计时。
           [V0.3.2] 暂停态右键数字改开**摸鱼菜单**（快捷换件事 + 定长）；计时中仍不弹菜单。 */
        onMenu={
          status === 'idle'
            ? (pos) => openCountdownMenu({ pos: posBelowBar(pos), itemId: currentItemId })
            : status === 'paused'
              ? (pos) => openMoyuMenu({ pos: posBelowBar(pos), itemId: currentItemId })
              : undefined
        }
      />
      {inlineEdit ? (
        <InlineNameEntry
          key={inlineEdit.itemId ?? 'new'}
          initial={inlineEdit.initial}
          placeholder={inlineEdit.itemId == null ? '新事项名称' : '事项名称'}
          onSubmit={submitInline}
          onCancel={() => useUiStore.getState().closeInlineEdit()}
        />
      ) : status === 'idle' ? (
        <NewItemEntry
          /* [V0.3.9] 空闲态点事项组件 = **新建输入框与常用事项框一起出**（用户口径）：
             条上就地长出输入框可以直接命名，下方同时展开常用框可以挑已有事项。
             两者由 `openCommonItemsNew` 一次落库（分两次会互相顶掉）。 */
          onClick={() => openCommonItemsNew(posBelowBar({ x: 32, y: 56 }))}
          /* [V0.2.6] Zone.Task 右键：展开事项窗口（对齐 Timing 的「今日计时」面板；事项级菜单在窗内逐行给） */
          onMenu={() => void openTodosWindow()}
        />
      ) : (
        <ItemName
          name={currentName ?? '未归类'}
          muted={visual === 'ended'}
          /* [V0.3.1] Zone.Task：左键 = 快捷新建（就地命名后立即开始）；右键 = 展开事项窗口。
             [V0.3.9] 计时中 / 暂停态左键改为**常用事项框**（置顶 + 最近编辑 + 事项管理点），
             点一行即切事项；摸鱼菜单仍由右键数字与暂停自动弹出承担。 */
          onActivate={() => openCommonItems(posBelowBar({ x: 32, y: 56 }))}
          onMenu={() => void openTodosWindow()}
        />
      )}
      {/* [0.12.1] 三手柄 × 5 槽，替掉原来的「今天」图标位与单个便利贴手柄：
          today.panel / today.digest = full 的双击（默认），note.current / note.list = full 的左右键 */}
      <HandleCluster bindings={handleBindings} baseCtx={handleCtx} />
    </div>
  );
}
