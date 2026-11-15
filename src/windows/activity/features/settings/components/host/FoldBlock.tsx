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
 * `defaultOpen` 会被「晚到的值」修正一次（`MdSyncTab` 的视图是异步加载的，⑤ 的默认
 * 展开判据 `cloud === null` 在首帧还读不出来）；用户自己点过之后就不再改，避免把
 * 用户刚收起的块又弹开。
 *
 * [V0.11.26] **默认值 true → false**（PRD R2 / O4）：六块全部默认折叠，展开状态不记忆。
 * 参数默认值改掉（不是每个调用点传 `false`）是为了防下一个调用点不小心拿到 true。
 * 「晚到的值修正一次」那个 effect **保留不动**：`defaultOpen` 恒 false 后它无事可做，
 * 但删它属于顺手重构，本轮不做（PRD §3.2）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
/* [T04b] 图标从 lucide-react 取（`lib/icons` 属主窗，L9 禁跨窗 import）：\\n   宿主 `iconStroke(16)` 恒为 1.6，这里直接写字面量。 */
import { ChevronDown, ChevronRight } from 'lucide-react';

interface FoldBlockProps {
  /** 块标识；折叠体 id 由它派生（`${id}-body`），页签与测试都按它定位 */
  id: string;
  title: string;
  /** 标题下方那句「这一块管什么」 */
  hint?: string;
  /** 标题右侧的动作槽（例如 ③ 的总开关） */
  actions?: ReactNode;
  /**
   * 标题下的附加一行（[V0.11.16] 块⑤的「当条记录」）。
   *
   * 为什么加一个槽而不是让块自己画：五块必须共用**同一套折叠语义**（`aria-expanded` /
   * `aria-controls` / `hidden` 三件套漏一处就是「视觉上收起了、键盘还能 Tab 进去」）。
   * 数据在子组件里（备份列表），所以由调用方从上面把它抬进来——`hint` 是纯字符串，
   * 装不下一个会被数据驱动的行。
   */
  summary?: ReactNode;
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
  summary,
  dirty = false,
  defaultOpen = false,
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
          {/* 折叠态也可见：块⑤收起来时用户要能一眼看到「最近那份底是什么」 */}
          {summary}
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
              ? <ChevronDown size={16} strokeWidth={1.6} aria-hidden />
              : <ChevronRight size={16} strokeWidth={1.6} aria-hidden />}
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
