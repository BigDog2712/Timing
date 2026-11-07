/**
 * Timing — 设置 · 数据管理 · 通用折叠块 FoldBlock（V0.11.15）
 * -----------------------------------------------------------------------------
 * 责任边界：**只画壳**——标题 + 说明 + 右侧动作槽 + chevron + 折叠体。
 * 它不知道「块里是什么」，也不持有任何业务状态（脏标记由调用方按 `dirty` 传进来）。
 *
 * 为什么抽出来：五块原本各写一遍 `aria-expanded` / `aria-controls` / `hidden` 三件套，
 * 漏一处就是「视觉上收起了、键盘还能 Tab 进去」（验收 A3 点名要看的东西）。
 * 沿用 `sync__fold-btn` 那套既有习惯（图标按钮 + aria 三件套），样式落在 `data__*`。
 *
 * `defaultOpen` 会被「晚到的值」修正一次（`MdSyncTab` 的视图是异步加载的，④ 的默认
 * 展开判据 `cloud === null` 在首帧还读不出来）；用户自己点过之后就不再改，避免把
 * 用户刚收起的块又弹开。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon, iconStroke } from '../../lib/icons';

interface FoldBlockProps {
  /** 块标识；折叠体 id 由它派生（`${id}-body`），页签与测试都按它定位 */
  id: string;
  title: string;
  /** 标题下方那句「这一块管什么」 */
  hint?: string;
  /** 标题右侧的动作槽（例如 ③ 的总开关） */
  actions?: ReactNode;
  /** 这一块被改过（标题旁显示「未保存」） */
  dirty?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function FoldBlock({
  id,
  title,
  hint,
  actions,
  dirty = false,
  defaultOpen = true,
  children,
}: FoldBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const touched = useRef(false);
  const bodyId = `${id}-body`;

  /* 只修正「用户还没点过」的那一段：先收起（视图未加载），加载完发现已配置就展开 */
  useEffect(() => {
    if (!touched.current) setOpen(defaultOpen);
  }, [defaultOpen]);

  const toggle = () => {
    touched.current = true;
    setOpen((value) => !value);
  };

  return (
    <section className="data__block" data-block={id}>
      <header className="data__block-head">
        <div className="data__block-main">
          <div className="data__block-title-row">
            <h4 className="data__block-title">{title}</h4>
            {dirty && <span className="data__dirty">未保存</span>}
          </div>
          {hint && <p className="data__block-hint">{hint}</p>}
        </div>
        <div className="data__block-actions">
          {actions}
          <button
            type="button"
            className="sync__fold-btn"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? `收起${title}` : `展开${title}`}
            title={open ? '收起' : '展开'}
            onClick={toggle}
          >
            {open
              ? <ChevronDownIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />
              : <ChevronRightIcon size={16} strokeWidth={iconStroke(16)} aria-hidden />}
          </button>
        </div>
      </header>

      {/* `hidden` 而不是 `display:none` 之外的残留：收起后块内控件不可聚焦（PRD A3） */}
      <div id={bodyId} className="data__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
