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
 *
 * [B5c] **`titleAs`：标题层级可配**（默认 `h4`）。同一个壳跨组复用时，块在页面标题大纲里的
 * 层级得跟着父级走 —— 数据卡嵌在 `h2` 卡里用 `h4`，「把手绑定」直接挂在页级 `h1` 下用 `h2`。
 * 详见 prop 注释里的「为什么不用 sr-only 补一个 h2」。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
/* [T04b] 图标从 lucide-react 取（`lib/icons` 属主窗，L9 禁跨窗 import）：\\n   宿主 `iconStroke(16)` 恒为 1.6，这里直接写字面量。 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { onFoldRevealRequested } from '../../services/settingsFoldReveal';

interface FoldBlockProps {
  /**
   * 块标识；折叠体 id 由它派生（`${id}-body`），页签与测试都按它定位。
   *
   * [B5c] 它同时是**块根节点的 DOM id**：`s-pill-handles` 这种分组锚点直接挂在这里，
   * 于是「锚点在折叠块的可见头部上」这件事由结构保证 —— 折叠体是 `hidden` 的，锚点要是
   * 落在体里，导航点上去既不滚也不报错。六块数据卡的 id（`data-*`）顺带也成了 DOM id，
   * 全仓无重名（与 `s-*` 锚点、`data-block` 属性均不冲突）。
   */
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
  /**
   * 标题的标签层级，默认 `'h4'`。
   *
   * 为什么可配：六块数据卡的父级是「数据与同步」那张 `h2` 卡，标题用 `h4` 在它下面是顺的；
   * 但「把手绑定」折进第 3 组后直接挂在页级 `<h1>` 下面（设置页没有 `h2` 包着它），
   * `h1 → h4` 跳了两级，读屏的标题大纲会断档。给它 `'h2'` 就与同页其它卡片平级。
   *
   * 为什么不用 `sr-only` 补一个 `h2`：那会让**同一张卡出现两个标题**，正是 B5c 换成
   * `FoldBlock` 时要避开的那个问题（一张卡两个标题比跳级更糟）。
   *
   * 默认值取 `'h4'` 而不是必填：六个既有调用点一个字不用改，行为与之前完全一致。
   */
  titleAs?: 'h2' | 'h3' | 'h4';
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
  titleAs = 'h4',
  children,
}: FoldBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const touched = useRef(false);
  const bodyId = `${id}-body`;
  /* 动态标签：`'h2' | 'h3' | 'h4'` 全是内建标签名，React 直接按名字渲染，不需要一张映射表 */
  const TitleTag = titleAs;

  /* 只修正「用户还没点过」的那一段：先收起（视图未加载），加载完发现已配置就展开 */
  useEffect(() => {
    if (!touched.current) setOpen(defaultOpen);
  }, [defaultOpen]);

  /**
   * [B5c] 导航点了「我这个块」→ 展开。
   *
   * 两条与 `defaultOpen` 的边界：
   *  ① 先把 `touched` 置真再展开 —— 否则 `defaultOpen` 恒 false 的那个 effect 会在下一次
   *     依赖变化时把块重新收回去，用户点了导航却看到块又合上。
   *  ② 不看当前值、直接置 true（幂等）：已经展开时再点导航不该反而收起。
   * 用户手动收起之后，再点导航**仍然能**再展开 —— 因为 `touched` 只挡 `defaultOpen`，
   * 不挡这条信号。
   */
  useEffect(() => onFoldRevealRequested((anchorId) => {
    if (anchorId !== id) return;
    touched.current = true;
    setOpen(true);
  }), [id]);

  const toggle = () => {
    touched.current = true;
    setOpen((value) => !value);
  };

  return (
    <section className="data__block" data-block={id} id={id}>
      <header className="data__block-head">
        <div className="data__block-main">
          <div className="data__block-title-row">
            <TitleTag className="data__block-title">{title}</TitleTag>
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
