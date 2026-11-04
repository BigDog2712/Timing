/**
 * TickBar — 插件面板的单块渲染（apiVersion 3）
 * -----------------------------------------------------------------------------
 * 四种块分开渲染，**没有通用递归**：插件只能声明这四种，宿主也只实现这四种。
 * 想加第五种形态 = 改这里 + 改 Rust 枚举 + 升 apiVersion，而不是让宿主学会解释任意结构。
 *
 * 数据块自己拉数据：`records.byItem` / `todos.pending` 都走 `plugin_panel_data`，
 * 命令层再挡一次白名单。一个块失败不影响别的块——面板整体不该因为一条查询挂掉。
 */
import { useEffect, useState } from 'react';
import { pluginApi } from '../../services/api';
import { errorText } from '../../services/ipc';
import type { PanelAction, PanelBlock, PanelRow } from '../../types/domain';

interface Props {
  block: PanelBlock;
  /** 动作回执交给外壳统一显示（底部一条状态栏） */
  onOutcome: (message: string) => void;
}

export function PanelBlockView({ block, onOutcome }: Props) {
  if (block.type === 'text') {
    return <p className="plgp__text">{block.text}</p>;
  }
  if (block.type === 'actions') {
    return <ActionRow items={block.items} onOutcome={onOutcome} />;
  }
  return <DataBlock block={block} />;
}

/** 一组按钮。执行期间禁用整组——连点两次「开始计时」没有意义。 */
function ActionRow({ items, onOutcome }: { items: PanelAction[]; onOutcome: (m: string) => void }) {
  const [busy, setBusy] = useState(false);

  const run = async (item: PanelAction) => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await pluginApi.runAction(item.action, item.params);
      onOutcome(outcome.message);
    } catch (err) {
      onOutcome(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plgp__actions">
      {items.map((item) => (
        <button
          key={`${item.action}:${item.label}`}
          type="button"
          className="btn btn--neutral plgp__action"
          disabled={busy}
          onClick={() => void run(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 数据块：`stats` 画条，`list` 只有文字。 */
function DataBlock({ block }: { block: Extract<PanelBlock, { type: 'stats' | 'list' }> }) {
  const [rows, setRows] = useState<PanelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* 参数是对象，直接进依赖会每次渲染都变 —— 用序列化值当键（面板里 params 只有标量）。 */
  const key = JSON.stringify(block.params ?? {});

  useEffect(() => {
    let alive = true;
    setError(null);
    pluginApi
      .panelData(block.source, block.params)
      .then((next) => {
        if (alive) setRows(next);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [block.source, key, block.params]);

  return (
    <section className="plgp__section">
      {block.label && <h4 className="plgp__label">{block.label}</h4>}
      {error && <p className="plgp__error">{error}</p>}
      {!error && rows == null && <p className="plgp__muted">读取中…</p>}
      {!error && rows?.length === 0 && <p className="plgp__muted">暂时没有数据。</p>}
      {!error && rows != null && rows.length > 0 && (
        <ul className="plgp__rows">
          {rows.map((row, index) => (
            <li key={`${row.label}-${index}`} className="plgp__row">
              <div className="plgp__row-head">
                <span className="plgp__row-label">{row.label}</span>
                <span className="plgp__row-detail">{row.detail}</span>
              </div>
              {block.type === 'stats' && row.ratio != null && (
                <div className="plgp__meter" aria-hidden>
                  <span
                    className="plgp__meter-fill"
                    style={{ width: `${Math.max(2, Math.round(row.ratio * 100))}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
