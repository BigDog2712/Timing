/**
 * Timing — 药丸手柄区（三形态连排）
 * -----------------------------------------------------------------------------
 * **不包 wrapper**：三个 `<button>` 必须是 `.pill` 的直接 flex 子项。包一层 div 会让
 * `gap` 只作用在 div 与前后元素之间，手柄之间失去 8px 间距、宽度算式（§6.1 的
 * `Σ(8 − 4 + 命中宽)`）当场作废。所以这里返回 fragment。
 *
 * `baseCtx` 由 PillBar 拼（timer / ui / notice / status / itemId 都只有它知道），
 * `anchor` 由每个手柄在派发瞬间自己取 rect 补上（见 HandleButton）。
 */
import { HANDLE_FORMS } from '../../lib/handleCatalog';
import type { HandleBindings } from '../../lib/handleCatalog';
import type { HandleActionCtx } from '../../services/handleActions/guards';
import { HandleButton } from './HandleButton';

export interface HandleClusterProps {
  bindings: HandleBindings;
  baseCtx: Omit<HandleActionCtx, 'anchor'>;
}

export function HandleCluster({ bindings, baseCtx }: HandleClusterProps) {
  return (
    <>
      {HANDLE_FORMS.map((form) => (
        <HandleButton
          key={form}
          form={form}
          enabled={bindings[form].enabled}
          slots={bindings[form].slots}
          baseCtx={baseCtx}
        />
      ))}
    </>
  );
}
