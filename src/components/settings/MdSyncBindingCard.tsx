/**
 * TickBar — 设置 · 同步 · 单个落点卡（V0.4.0）
 * -----------------------------------------------------------------------------
 * 一张卡 = 一个 `MdSyncBinding`。根目录 / 文件模板 / 标题三个输入都直接改草稿，
 * 点页签底部的「保存并同步」才落库——避免每敲一个字符就触发一次文件同步。
 */
import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, iconStroke } from '../../lib/icons';
import type { MdSyncBinding, MdSyncBindingStatus } from '../../types/domain';
import { MD_SYNC_KIND_LABELS } from '../../types/domain';
import { Switch } from '../ui/Switch';

interface MdSyncBindingCardProps {
  binding: MdSyncBinding;
  status: MdSyncBindingStatus | undefined;
  today: string;
  disabled: boolean;
  onChange: (next: MdSyncBinding) => void;
  onPick: () => void;
  onOpen: () => void;
}

function kindLabel(kind: MdSyncBinding['kind']): string {
  return MD_SYNC_KIND_LABELS[kind];
}

function kindHint(kind: MdSyncBinding['kind']): string {
  switch (kind) {
    case 'timers':
      return '按事项分组，写入 Planner 兼容的 YAML log；改时间或删组会回写数据库。';
    case 'notes':
      return '三列表格，隐藏 id 标记；新增 / 编辑 / 删除行都会回写数据库。只写当天创建或改过的便利贴。';
    case 'todos':
      return '清单项，隐藏 id 标记；勾掉或改标题 / 计划时间会回写数据库。只列未完成、且计划时间不在今天的待办。';
  }
}

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

export function MdSyncBindingCard({
  binding,
  status,
  today,
  disabled,
  onChange,
  onPick,
  onOpen,
}: MdSyncBindingCardProps) {
  const label = kindLabel(binding.kind);
  const [open, setOpen] = useState(binding.enabled);

  /* 关闭某个种类的同步时，设置自动收纳；重新打开时自动展开。 */
  useEffect(() => {
    setOpen(binding.enabled);
  }, [binding.enabled]);

  const file = binding.file
    .replace(/\{date\}/g, today)
    .replace(/\{yyyy\}/g, today.slice(0, 4))
    .replace(/\{MM\}/g, today.slice(5, 7))
    .replace(/\{dd\}/g, today.slice(8, 10));
  const path = binding.root ? `${binding.root}\\${file}` : '尚未设置根目录';

  return (
    <section className="sync__card" data-disabled={binding.enabled ? 'false' : 'true'}>
      <header className="sync__card-head">
        <div className="sync__card-title">
          <h3 className="sync__kind">{label}</h3>
          <p className="sync__desc">{kindHint(binding.kind)}</p>
        </div>
        <div className="sync__card-tools">
          <Switch
            checked={binding.enabled}
            label={`启用${label}同步`}
            disabled={disabled}
            onChange={(enabled) => onChange({ ...binding, enabled })}
          />
          <button
            type="button"
            className="sync__fold-btn"
            aria-expanded={open}
            aria-controls={`md-sync-${binding.kind}`}
            aria-label={open ? `收起${label}设置` : `展开${label}设置`}
            title={open ? '收起设置' : '展开设置'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <ChevronDownIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            ) : (
              <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
            )}
          </button>
        </div>
      </header>

      <div id={`md-sync-${binding.kind}`} className="sync__fields" hidden={!open}>
        <label className="sync__field">
          <span className="sync__label">落点根目录</span>
          <div className="sync__row">
            <input
              className="sync__input"
              value={binding.root}
              disabled={disabled}
              spellCheck={false}
              placeholder="C:\\Users\\你\\Documents\\Obsidian\\日记"
              onChange={(event) => onChange({ ...binding, root: event.target.value })}
            />
            <button
              type="button"
              className="btn btn--neutral sync__pick"
              disabled={disabled}
              onClick={onPick}
            >
              选择…
            </button>
          </div>
        </label>

        <div className="sync__grid">
          <label className="sync__field">
            <span className="sync__label">文件（支持 {'{date}'}）</span>
            <input
              className="sync__input"
              value={binding.file}
              disabled={disabled}
              spellCheck={false}
              placeholder="{date}.md"
              onChange={(event) => onChange({ ...binding, file: event.target.value })}
            />
          </label>
          <label className="sync__field">
            <span className="sync__label">标题行</span>
            <input
              className="sync__input"
              value={binding.heading}
              disabled={disabled}
              spellCheck={false}
              placeholder="#### 事项计时"
              onChange={(event) => onChange({ ...binding, heading: event.target.value })}
            />
          </label>
        </div>
      </div>

      <p className="sync__path" title={path}>
        {path || `今天：${today}`}
      </p>

      {open && (
        <div className="sync__card-foot">
          <span className="sync__status" data-error={status?.lastError ? 'true' : 'false'}>
            {statusText(status)}
          </span>
          <button
            type="button"
            className="btn btn--ghost sync__open"
            disabled={disabled || !binding.enabled}
            onClick={onOpen}
          >
            打开今日文件
          </button>
        </div>
      )}

      {status?.lastError && <p className="sync__error">{status.lastError}</p>}
    </section>
  );
}
