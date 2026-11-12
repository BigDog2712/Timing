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
import type { MdSyncBinding, MdSyncBindingStatus } from '../../services/host/hostTypes';
import { MD_SYNC_KIND_LABELS } from '../../services/host/hostTypes';
import QuietSwitch from '../../../../shared/components/QuietSwitch';
import { bindingStatusText, previewFile } from '../../services/host/mdSyncConfig';

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

/* [V0.11.16] 原来这里有一个私有的 `statusText`：现在搬到 `mdSyncConfig`
   （逐档行与块③的聚合行必须是**同一套状态词**，两处各写一份就会出现「上面说已写入、
   下面说无变化」这种自相矛盾的界面）。 */

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
          {/* [V0.11.16] C17：这里原本还有一行「文件名与标题来自「Markdown 落点设置」：
              `2026-11-07.md`」——它与块①的那句话重复，PRD A2 要求全页零命中，删掉。 */}
        </div>
        <div className="sync__card-tools">
          <QuietSwitch
            checked={binding.enabled}
            ariaLabel={`启用${label}同步`}
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
          {bindingStatusText(status)}
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
