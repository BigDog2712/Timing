/**
 * Timing — 设置 · 数据管理 · ③ 的一行（V0.11.15）
 * -----------------------------------------------------------------------------
 * 责任边界：一个 `MdSyncBinding` 在块③里的那**一行**——根目录 + 选择… + 该种类的启用
 * 开关 + 运行状态 + 打开今日文件 + 失败原文。
 *
 * 它与 `MdFormatBlock` 共用同一个 `bindings` 数组（这是设计点名的最大风险）：本文件
 * 改的是 `root` / `enabled`，脏标记走 `part: 'sync'`；`file` / `heading` 归块①。
 * 文件名与标题在本行**只读展示**，指向块①——一个字段只有一个入口（PRD 目标 2）。
 */
import type { MdSyncBinding, MdSyncBindingStatus } from '../../types/domain';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { Switch } from '../ui/Switch';
import { previewFile } from './mdSyncConfig';

interface MdSyncPathRowProps {
  binding: MdSyncBinding;
  status: MdSyncBindingStatus | undefined;
  today: string;
  disabled: boolean;
  onChange: (next: MdSyncBinding) => void;
  onPick: () => void;
  onOpen: () => void;
  /** 后端校验原文里属于这一行的部分（`splitBindingError` 已经定位好） */
  error?: string;
}

/** 运行状态一行字：`已写入 Markdown · 10:32` / `无变化` / `上次同步失败` / `尚未同步` */
function statusText(status: MdSyncBindingStatus | undefined): string {
  if (!status) return '尚未同步';
  if (status.lastError) return '上次同步失败';
  if (status.lastSyncAt == null) return '尚未同步';
  const direction =
    status.lastDirection === 'import'
      ? '已从 Markdown 导入'
      : status.lastDirection === 'export'
        ? '已写入 Markdown'
        : '无变化';
  const time = new Date(status.lastSyncAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${direction} · ${time}`;
}

export function MdSyncPathRow({
  binding,
  status,
  today,
  disabled,
  onChange,
  onPick,
  onOpen,
  error,
}: MdSyncPathRowProps) {
  const label = MD_SYNC_KIND_LABELS[binding.kind];
  const file = previewFile(binding.file, today);
  /* 根目录空 = 未配置：路径行说「尚未设置根目录」，而不是拼出一个只有文件名的假路径 */
  const path = binding.root.trim() ? `${binding.root}\\${file}` : '尚未设置根目录';

  return (
    <div className="sync__card" data-disabled={binding.enabled ? 'false' : 'true'}>
      <header className="sync__card-head">
        <div className="sync__card-title">
          <h5 className="sync__kind">{label}</h5>
          <p className="sync__desc">
            文件名与标题来自「Markdown 落点设置」：<code>{file}</code>
          </p>
        </div>
        <div className="sync__card-tools">
          <Switch
            checked={binding.enabled}
            label={`启用${label}同步`}
            disabled={disabled}
            onChange={(enabled) => onChange({ ...binding, enabled })}
          />
        </div>
      </header>

      <div className="sync__row">
        <input
          className="sync__input"
          value={binding.root}
          disabled={disabled}
          spellCheck={false}
          placeholder="C:\\Users\\你\\Documents\\Obsidian\\日记"
          aria-label={`${label}落点根目录`}
          onChange={(event) => onChange({ ...binding, root: event.target.value })}
        />
        <button type="button" className="btn btn--neutral sync__pick" disabled={disabled} onClick={onPick}>
          选择…
        </button>
      </div>

      <p className="sync__path" title={path}>{path}</p>

      <div className="sync__card-foot">
        <span className="sync__status" data-error={status?.lastError ? 'true' : 'false'}>
          {statusText(status)}
        </span>
        <button
          type="button"
          className="btn btn--ghost sync__open"
          /* 未启用或根目录空时禁用：点了只会得到一句「今日文件尚未生成」 */
          disabled={disabled || !binding.enabled || !binding.root.trim()}
          title={binding.root.trim() ? undefined : '先设置根目录'}
          onClick={onOpen}
        >
          打开今日文件
        </button>
      </div>

      {/* 失败原文整行显示在本行下方（红字只出现在出问题的那个块里） */}
      {status?.lastError && <p className="sync__error">{status.lastError}</p>}
      {error && <p className="sync__error">{error}</p>}
    </div>
  );
}
