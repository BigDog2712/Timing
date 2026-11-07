/**
 * Timing — 设置 · 数据管理 · 存储通道二选一（V0.11.18，PRD 三 / CH1–CH4）
 * -----------------------------------------------------------------------------
 * 为什么提到页签顶部而不是留在块④：它管的是**整页**（块①③④ 都受它影响），而块④ 只是
 * 它能打开的那一块。放在块④ 里，用户会以为它只管云端那几个输入框（PRD §3.1 的「位置」）。
 *
 * 三条纪律（改之前先看这里）：
 * 1. **只动 `cloud.enabled`**（走 `withChannel`），地址 / 目录 / 账号原样保留 —— CH4
 *    「云端配置已保留，切回即恢复」靠这一条成立，也是选「提升 enabled 语义」而不是
 *    「从 `cloud !== null` 推导」的全部理由（后者等于切到只用本地时删掉用户已存的配置）；
 * 2. 文案逐字照 PRD：`存储通道`（`aria-label`）/ `只用本地` / `本地 + 云端` /
 *    `云端配置已保留，切回即恢复。`。组件里不许再写第二份同义字面量；
 * 3. **不给「只用本地」做任何额外解释**（PRD A1：每块标题下只有一句，页签顶部只允许
 *    出现一行**控件**）。CH4 那句**只在**已配过云端时出现：从没配过的人看见「配置已保留」
 *    会去找那份不存在的配置。
 *
 * 落点纪律：本组件必须是 `.data` 的**直接子元素**、且**不在 `.data__head` 里**。
 * `mdSyncA1.test.tsx` 用 `toBe` 钉死了 `.data__head` 的 `textContent` 逐字等于「数据管理」，
 * 又用 `:scope >` 钉死页签层 `.data__note` / `.data__hint` 各 0 个 —— 放错位置会撞一批红。
 */
import { channelOf, withChannel } from './mdSyncConfig';
import type { MdSyncChannel } from './mdSyncConfig';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncChannelSegProps {
  draft: MdSyncDraft;
}

/* `data-on` 是字符串 `'true' | 'false'`（照抄块④ mode 分段的既有写法）：
   `settings-panel.css` 里的 `.seg__item[data-on="true"]` 只认这个形状，
   写成布尔属性会「能点但没有选中态」。 */
const OPTIONS: { value: MdSyncChannel; label: string }[] = [
  { value: 'local', label: '只用本地' },
  { value: 'both', label: '本地 + 云端' },
];

export function MdSyncChannelSeg({ draft }: MdSyncChannelSegProps) {
  const current = channelOf(draft.cloud);
  const pick = (next: MdSyncChannel) => {
    /* 点当前那一项不产生脏标记：否则「点一下又点回来」也显示「有未保存的修改」 */
    if (next === current) return;
    draft.updateCloud(withChannel(draft.cloud, next));
  };
  return (
    <div className="sync__channel">
      <div className="seg seg--compact" role="group" aria-label="存储通道">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="seg__item"
            disabled={draft.saving}
            data-on={current === option.value ? 'true' : 'false'}
            aria-pressed={current === option.value}
            onClick={() => pick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {current === 'local' && draft.cloudConfigured && (
        /* 用 `sync-cloud__hint` 而不是 `data__hint` / `data__note`：后两个在页签层被
           `:scope >` 断言钉死为 0 个，而这句话是 PRD CH4 明确要求出现的那一行。
           `data-retained` 供测试区分「CH4 这一句」与其它 hint。 */
        <p className="sync-cloud__hint" data-retained="true">云端配置已保留，切回即恢复。</p>
      )}
    </div>
  );
}
