/**
 * Timing — 设置 · 数据管理 · 块⑤「云端同步」（V0.11.13 → V0.11.26，ADR-061）
 * -----------------------------------------------------------------------------
 * 原来是「云端通道卡」，按 `cloud.mode` 在「本地目录 / WebDAV」之间二选一。
 * [V0.11.26] 拆分之后它**只做 WebDAV 这一条通路**（本地那一半搬去 `MdSyncLocalCard`，
 * 块标题也从「WebDAV 云端同步」改成「云端同步」，PRD §7.1 L5）：
 *
 * - 载体分段（`云端通道方式`）整组删除，「选边」这个概念不存在了（PRD §4.2）；
 * - 开关移到块标题右侧（`MdSyncTab` 的 `actions` 槽，aria `启用云端同步`），
 *   块内不再有第二个布尔；关掉只变灰、**不隐藏**（用户要能看到自己填过什么）；
 * - 三档绑 `cloudWebdav.auto` 这一份（PRD R5：两块各一份，值独立存）；
 * - 状态行读 `view.cloud`（后端 `state::status_for(Webdav)`），与块④ 的 `view.local` 互不串。
 *
 * 三条纪律（改之前先看这里）：
 * 1. **要落库的值一律走 `draft.webdav`**，本文件只留「与保存无关」的界面状态（测试结果）；
 * 2. 密码框**不受控于** `hasSecret`：`secret === null` 的含义是「没碰过」，保存时按
 *    `undefined` 透传（不动已存密文），所以绝不能把 `hasSecret` 反填成 `'******'`；
 * 3. 「测试连接」只读探测（`probe.rs` 首行「不写任何状态」），通路关着也保持可点。
 */
import { useState } from 'react';
import { errorText, mdSyncApi } from '../../services/hostApi';
import { useMdSyncStore } from '../../services/host/mdSyncRuntimeStore';
import type {
  MdSyncCloudAuto,
  MdSyncConfig,
  MdSyncTestResult,
  MdSyncTestStepKey,
} from '../../services/host/hostTypes';
import { purgeNoteOf } from '../../services/host/mdSyncAuto';
import { isWebdavReady, legacyCloudForTest } from '../../services/host/mdSyncConfig';
import { CLOUD_DIR_HINT } from '../../services/host/mdSyncCopy';
import { MdSyncCloudAuto as MdSyncAutoControl } from './MdSyncCloudAuto';
import type { MdSyncDraft } from '../../services/host/useMdSyncDraft';

interface MdSyncWebdavCardProps {
  draft: MdSyncDraft;
}

/**
 * [V0.11.16] 三关的**界面标签**。后端的 `key` 是契约（`account` / `dir` / `write`），
 * 中文标签归前端：改「目录」这个说法不必动 Rust。
 */
const STEP_LABELS: Record<MdSyncTestStepKey, string> = { account: '账号', dir: '目录', write: '写入' };

/** 块⑤ 状态行的「没填全」句（PRD §7.2 逐字不变）。 */
export const WEBDAV_MISSING_NOTE = '云端还没填全，暂时不会同步。';

export function MdSyncWebdavCard({ draft }: MdSyncWebdavCardProps) {
  const status = useMdSyncStore((s) => s.view?.cloud ?? null);
  const { webdav, saving, secret, updateWebdav, setSecret } = draft;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MdSyncTestResult | null>(null);
  /* 声明式兜底（PRD §五 A8「机制保留」）：结论只对**测过的那份账号+地址**生效。
     两块各持一份 state，天然互不残留（O15）；这一层再挡「同一块里改了字段没重测」。 */
  const [testedKey, setTestedKey] = useState<string | null>(null);

  /* 绑的是 `webdav.enabled` 这个**值**（块⑤ 自己的开关），与块④ 的开关互不影响。 */
  const disabled = !webdav.enabled || saving;
  const ready = isWebdavReady(webdav);
  const pendingDates = status?.pendingDates ?? [];
  const key = `${webdav.baseUrl ?? ''}\u0000${webdav.basePath ?? ''}\u0000${webdav.user ?? ''}`;

  const patch = (next: Partial<typeof webdav>) => updateWebdav({ ...webdav, ...next });

  const handleTest = async () => {
    /* (1) 命令式：每次开测先清上一次的结论（上一次测的是另一份配置，不该留在屏幕上）。 */
    setTestResult(null);
    setTestedKey(key);
    setTesting(true);
    try {
      const config: MdSyncConfig = {
        enabled: draft.enabled,
        /* [V0.11.19] 与保存**同一份来源**（落库原值透传），不再从界面状态推算。 */
        pollSecs: draft.pollSecs,
        /* 与保存**同一个数组**：测试按草稿的统一意图跑，保存也按它写。 */
        bindings: draft.resolvedBindings,
        /* 探测载荷现拼 legacy `webdav` 形状（红线 `probe.rs` 只认带 `mode` 的旧结构）。 */
        cloud: legacyCloudForTest('webdav', webdav),
      };
      /* 与保存同一条口径：`secret === null` → `undefined`（拿已存密文去测）。 */
      setTestResult(await mdSyncApi.test(config, secret ?? undefined));
    } catch (err) {
      setTestResult({ ok: false, detail: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  /* 失败那一关（`steps` 只含走过的关，所以最多一个 `ok === false`）。 */
  const shown = testedKey === key ? testResult : null;
  const failedStep = shown?.steps?.find((item) => !item.ok) ?? null;

  return (
    <div className="sync__fields">
      {/* [V0.11.26] 三档占块内第一行，绑 `cloudWebdav.auto` 这一份（R5）。 */}
      <MdSyncAutoControl
        auto={webdav.auto}
        disabled={disabled}
        onChange={(next: MdSyncCloudAuto) => patch({ auto: next })}
      />

      <label className="sync__field">
        <span className="sync__label">服务地址</span>
        <input
          className="sync-cloud__input"
          value={webdav.baseUrl ?? ''}
          disabled={disabled}
          spellCheck={false}
          placeholder="https://dav.jianguoyun.com/dav/"
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>
      <div className="sync__grid">
        <label className="sync__field">
          <span className="sync__label">远端目录</span>
          <input
            className="sync-cloud__input"
            value={webdav.basePath ?? ''}
            disabled={disabled}
            spellCheck={false}
            placeholder="/Timing"
            onChange={(event) => patch({ basePath: event.target.value })}
          />
        </label>
        <label className="sync__field">
          <span className="sync__label">账号</span>
          <input
            className="sync-cloud__input"
            value={webdav.user ?? ''}
            disabled={disabled}
            spellCheck={false}
            placeholder="坚果云登录邮箱"
            onChange={(event) => patch({ user: event.target.value })}
          />
        </label>
      </div>
      {/* [V0.11.17] B3：默认目录 /Timing 要用户先在网页版建好这个文件夹。文案在
          `mdSyncCopy.ts::CLOUD_DIR_HINT`（不在组件里写死）。 */}
      <p className="sync-cloud__hint">{CLOUD_DIR_HINT}</p>
      <label className="sync__field">
        <span className="sync__label">应用密码</span>
        <div className="sync__row">
          {/* `value={secret ?? ''}` 不是「密码是空的」，而是「用户这次没打算改」 */}
          <input
            className="sync-cloud__input"
            type="password"
            value={secret ?? ''}
            disabled={disabled}
            placeholder={status?.hasSecret ? '已保存，留空表示不修改' : '坚果云请用应用密码'}
            onChange={(event) => setSecret(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--ghost sync__pick"
            disabled={disabled}
            title="清空已保存的密码"
            onClick={() => setSecret('')}
          >
            清除密码
          </button>
        </div>
      </label>

      {/* 「测试连接」只跟 `saving || testing`：只读探测，通路关着也保持可点。**别顺手灰掉。** */}
      <div className="sync-cloud__test">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={saving || testing}
          onClick={() => void handleTest()}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        {shown && (
          <div className="sync-cloud__result" data-ok={shown.ok ? 'true' : 'false'}>
            {/* 三关逐步点亮（E3/E6）：红在哪一关就停在那一关，后面关不显示 */}
            {shown.steps && shown.steps.length > 0 ? (
              <>
                <span className="sync-cloud__steps">
                  {shown.steps.map((item, index) => (
                    <span key={item.key} className="sync-cloud__step" data-ok={item.ok ? 'true' : 'false'}>
                      {index > 0 ? ' ' : ''}{STEP_LABELS[item.key]} {item.ok ? '✓' : '✗'}
                    </span>
                  ))}
                </span>
                {/* 失败只说那一件事：那一关的原文，不改写、不拼接 */}
                {failedStep?.detail && <p className="sync__error">{failedStep.detail}</p>}
              </>
            ) : (
              <span>{shown.detail}</span>
            )}
          </div>
        )}
      </div>

      {/* 状态一律以 `status` 为准：没拿到视图时宁可不显示，也不假装「已开启 / 已上传」 */}
      {webdav.enabled && status && (
        <div className="sync-cloud__status" data-channel="webdav" data-ready={ready ? 'true' : 'false'}>
          {ready ? (
            <>
              <span>{status.hasSecret ? '密码已保存' : '密码未设置'}</span>
              <span>{status.todayPushed ? '今天已上传' : '今天还没上传'}</span>
              {pendingDates.length > 0 && (
                <span>待补传 {pendingDates.length} 天：{pendingDates.slice(0, 3).join('、')}…</span>
              )}
              {status.lastError && <p className="sync__error">{status.lastError}</p>}
              {/* 清理四句的优先级唯一在 `purgeNoteOf`，块④ 同一份 */}
              <span data-purge="true">{purgeNoteOf(status.purge)}</span>
            </>
          ) : (
            /* 没填全只显示这一句，不叠加「今天还没上传」（A6c 口径平移）。
               判据取**草稿**而不是 `status`：视图没有字段本身，而「照你现在填的这份会不会跑」
               比拿旧的落库值更贴合作者当下在做的事。 */
            <span data-missing="true">{WEBDAV_MISSING_NOTE}</span>
          )}
        </div>
      )}
    </div>
  );
}
