/**
 * TickBar — 图标集中出口（唯一）
 * -----------------------------------------------------------------------------
 * 依据 UIUX-v1 §8.2 图标清单（全项目统一，不得混用）+ DESIGN.md §4.6。
 * 只导出清单内图标；组件禁止直接 import lucide-react，一律经本文件。
 *
 * 描边规范（UIUX-v1 §8.2，必须写进代码）：
 *   - 16px -> stroke-width 2.5
 *   - 20px -> stroke-width 2
 *   - 24px -> stroke-width 2
 *   lucide 的 stroke-width 相对 viewBox 0 0 24 24；缩到 16px 时用 2.5 保持视觉线重一致。
 *
 * 反模式红线：全项目零 emoji 作功能图标，且禁用 U+2713 / U+26A0 / U+2714 / U+274C
 * 等字符符号——状态一律用下方 check / circleAlert。
 */
import {
  Play,
  Pause,
  Check,
  Plus,
  Undo2,
  Pencil,
  Trash2,
  Settings2,
  Keyboard,
  CircleAlert,
  Clock,
  ChevronRight,
  ChevronLeft,
  GripVertical,
  CircleDot,
  Inbox,
  X,
  Sun,
  Moon,
  RotateCcw,
  Puzzle,
  Monitor,
  /* [V0.2.0] 自绘菜单 / 事项窗口（context-menu.md §5 / todos-panel.md §5） */
  List,
  BookOpen,
  EyeOff,
  Square,
  Bell,
  /* [V0.2.0 批2] 倒计时 / 提醒 / 常用事项 / 便利贴（countdown-menu.md §5 / reminder-popover.md §5 / sticky-note.md §5） */
  Timer,
  Repeat,
  StickyNote,
  BellRing,
  Link,
  Unlink,
  CalendarClock,
  /* [V0.3.9] 常用事项（置顶）+ 常用摸鱼排序 */
  Pin,
  PinOff,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

export type IconSize = 16 | 20 | 24;

/** lucide 图标组件类型（供自绘菜单等处声明 rows 的 icon 字段；仍不直连 lucide-react） */
export type { LucideIcon } from 'lucide-react';

/** 16px 档图标（行内） */
export const PlayIcon = Play;
export const PauseIcon = Pause;
export const CheckIcon = Check;
export const PlusIcon = Plus;
export const UndoIcon = Undo2;
export const PencilIcon = Pencil;
export const TrashIcon = Trash2;
export const SettingsIcon = Settings2;
export const KeyboardIcon = Keyboard;
export const AlertIcon = CircleAlert;
export const ClockIcon = Clock;
/* [V0.2.0] 设置 / 主题 / 配色（settings-panel.md §5 / theme-picker.md §5） */
export const XIcon = X;
export const SunIcon = Sun;
export const MoonIcon = Moon;
export const RotateCcwIcon = RotateCcw;
export const PuzzleIcon = Puzzle;
export const MonitorIcon = Monitor;
/* [V0.2.0] 自绘菜单各项 + 事项窗口（reminder 铃 / 事项窗口 / 隐藏到托盘） */
export const ListIcon = List;
export const BookOpenIcon = BookOpen;
export const EyeOffIcon = EyeOff;
export const SquareIcon = Square;
export const BellIcon = Bell;
/* [V0.2.0 批2] 倒计时 / 提醒 / 常用事项 / 便利贴 */
export const TimerIcon = Timer;
export const RepeatIcon = Repeat;
export const StickyNoteIcon = StickyNote;
export const BellRingIcon = BellRing;
export const LinkIcon = Link;
export const UnlinkIcon = Unlink;
export const CalendarClockIcon = CalendarClock;
/* [V0.3.9] 常用事项管理（置顶 / 取消置顶）+ 常用摸鱼上移下移 */
export const PinIcon = Pin;
export const PinOffIcon = PinOff;
export const ChevronUpIcon = ChevronUp;
export const ChevronDownIcon = ChevronDown;

/** 20px 档图标（按钮内） */
export const ChevronRightIcon = ChevronRight;
export const ChevronLeftIcon = ChevronLeft;
export const GripIcon = GripVertical;

/** 24px 档图标（独立） */
export const EmptyDotIcon = CircleDot;
export const InboxIcon = Inbox;

/**
 * 依尺寸返回正确的描边宽：
 *   16 -> 2.5；20 / 24 -> 2。
 */
export function iconStroke(size: IconSize): number {
  return size === 16 ? 2.5 : 2;
}

/** 统一图标渲染参数（配合 lucide 组件的 size / strokeWidth props） */
export interface IconProps {
  size?: IconSize;
  className?: string;
}
