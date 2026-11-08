/**
 * Timing — 移动端「数据管理 · 云端通道」（V0.11.21）
 * -----------------------------------------------------------------------------
 * 手机上原来**没有任何地方**能填 WebDAV 地址、账号、应用密码，也没有三档——而
 * `app::md_sync_mobile::sync_once` 早就能跑云端那一轮，三条命令也早就在手机端注册过。
 * 这一页补的就是那道门：一条能跑的路，之前没有入口。
 *
 * ## 为什么另起组件，不复用桌面的 `MdSyncCloudCard`
 *
 * 桌面的卡绑的是 `useMdSyncDraft`（整页草稿 + 页底一个保存），且被两套用例按
 * `.seg__item` / `.sync-cloud__*` 数按钮与文案。手机的交互是「在这一块里填完点保存」，
 * 模型不同；硬复用会让「改手机就红桌面用例」。**复用的是纯函数那层**
 * （`emptyCloud` / `channelOf` / `withChannel` / `isCloudReady` / `autoOf` /
 * `withSchedule` / `clampAutoMinutes`）——口径只有一份，界面各写各的。
 *
 * ## 四条纪律
 *
 * 1. **草稿与落库分开**：输入框改的是本地 `draft`，点「保存」才落库。逐键保存会让
 *    每敲一个字符写一次 `settings` 行、顺带触发一轮同步；
 * 2. **密码三分语义**：`secret === null` 表示「没碰过」→ 保存时传 `undefined`（不动已存密文）；
 *    输入框有内容 → 传原串；点「清除密码」→ 传空串（后端语义 = 清空）。绝不把
 *    `hasSecret` 反填成 `******`；
 * 3. **「填全没填全」看草稿不看落库**：用户改了框还没保存时，那句提示正好回答
 *    「照现在填的这份会不会跑」；
 * 4. **手机不显示云端往期清理那句文案**：手机不装真删挂点（`#[cfg(not(mobile))]`），
 *    写「更早的会删除」是一句假承诺。见任务书 v0.11.21 §四。
 */
import { useState } from 'react';
import type {
  CloudSchedule,
  MdSyncCloud,
  MdSyncConfig,
  MdSyncTestResult,
  MdSyncViewCloud,
} from '../../types/domain';
import { autoOf, clampAutoMinutes, withSchedule } from '../settings/mdSyncAuto';
import { channelOf, emptyCloud, isCloudReady, withChannel } from '../settings/mdSyncConfig';
import { AUTO_COPY, CLOUD_DIR_HINT } from '../settings/mdSyncCopy';
import { CloudStatusLine, CloudTestResult } from './SyncCloudFacts';

interface SyncCloudPaneProps {
  view: MdSyncViewCloud;
  busy: boolean;
  onSave: (config: MdSyncConfig, secret?: string | null) => void;
  onTest: (config: MdSyncConfig, secret?: string | null) => Promise<MdSyncTestResult>;
}

const SCHEDULES: CloudSchedule[] = ['off', 'interval', 'smart'];
const SCHEDULE_LABELS: Record<CloudSchedule, string> = {
  off: '关闭',
  interval: '定时',
  smart: '智能',
};

export function SyncCloudPane({ view, busy, onSave, onTest }: SyncCloudPaneProps) {
  const config = view.config;
  const status = view.cloud;
  const saved = config.cloud ?? emptyCloud();
  const savedKey = JSON.stringify(saved);

  const [draft, setDraft] = useState<MdSyncCloud>(saved);
  const [baseKey, setBaseKey] = useState(savedKey);
  const [secret, setSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MdSyncTestResult | null>(null);
  const [minutesText, setMinutesText] = useState<string | null>(null);

  /* 保存回来（父层换了一份视图）或别处改了配置 → 草稿跟着重置。
     渲染期 setState 是 React 官方的「props 变了就调自己的 state」写法：
     比 useEffect 少一帧，也不会在首帧闪一下旧值。 */
  if (savedKey !== baseKey) {
    setBaseKey(savedKey);
    setDraft(saved);
    setSecret(null);
  }

  const auto = autoOf(draft.auto);
  const channel = channelOf(draft);
  const ready = isCloudReady(draft);
  const dirty = savedKey !== JSON.stringify(draft);
  /* 通道 = 只用本地时字段变灰但**不隐藏**：用户要能看到自己填过什么。 */
  const locked = busy || !draft.enabled;
  const patch = (next: Partial<MdSyncCloud>) => setDraft((prev) => ({ ...prev, ...next }));

  const commit = () => {
    onSave({ ...config, cloud: draft }, secret ?? undefined);
    setSecret(null);
  };

  const pickChannel = (next: 'local' | 'both') => {
    if (next === channel) return;
    /* 切通道必须清掉上一次的测试结论：上一档的红字跨载体残留，正是「报红但同步正常」的来源。 */
    setTestResult(null);
    setDraft((prev) => withChannel(prev, next));
  };

  const commitMinutes = (raw: string) => {
    setMinutesText(null);
    patch({ auto: { ...auto, intervalMinutes: clampAutoMinutes(raw) } });
  };

  const handleTest = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      setTestResult(await onTest({ ...config, cloud: draft }, secret ?? undefined));
    } catch (err) {
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="setting-group">
        <div className="setting-row">
          <span className="setting-row__label">同步通道</span>
          <div className="m-seg" role="group" aria-label="同步通道">
            <button
              type="button"
              className="m-seg__item"
              data-cloud-channel="local"
              data-on={channel === 'local' ? 'true' : 'false'}
              aria-pressed={channel === 'local'}
              disabled={busy}
              onClick={() => pickChannel('local')}
            >
              只用本地
            </button>
            <button
              type="button"
              className="m-seg__item"
              data-cloud-channel="both"
              data-on={channel === 'both' ? 'true' : 'false'}
              aria-pressed={channel === 'both'}
              disabled={busy}
              onClick={() => pickChannel('both')}
            >
              本地 + 云端
            </button>
          </div>
        </div>
        <p className="m-hint">
          「本地 + 云端」把当天那份再传一份到 WebDAV；数据库始终在本机。
        </p>
      </div>

      <div className="setting-group">
        <div className="setting-row">
          <span className="setting-row__label">自动同步</span>
        </div>
        <div className="m-seg" role="group" aria-label="云端自动同步">
          {SCHEDULES.map((value) => (
            <button
              key={value}
              type="button"
              className="m-seg__item"
              data-cloud-tier={value}
              data-on={auto.schedule === value ? 'true' : 'false'}
              aria-pressed={auto.schedule === value}
              disabled={locked}
              onClick={() =>
                setDraft((prev) => ({ ...prev, auto: withSchedule(autoOf(prev.auto), value) }))
              }
            >
              {SCHEDULE_LABELS[value]}
            </button>
          ))}
        </div>
        {auto.schedule === 'interval' && (
          <div className="setting-row m-cloud__interval">
            <span className="setting-row__label">每隔</span>
            <input
              className="m-input m-cloud__minutes"
              type="number"
              inputMode="numeric"
              min={5}
              max={120}
              step={1}
              aria-label="云端自动同步间隔（分钟）"
              value={minutesText ?? String(auto.intervalMinutes)}
              disabled={locked}
              onChange={(event) => {
                const text = event.target.value;
                setMinutesText(text);
                const parsed = Number.parseInt(text, 10);
                if (Number.isFinite(parsed)) {
                  patch({ auto: { ...auto, intervalMinutes: parsed } });
                }
              }}
              onBlur={(event) => commitMinutes(event.currentTarget.value)}
            />
            <span className="m-hint">分钟（5–120）</span>
          </div>
        )}
        <p className="m-hint">
          {auto.schedule === 'off'
            ? '自动路径不跑，只有点「立即同步」才传。'
            : auto.schedule === 'interval'
              ? `每 ${auto.intervalMinutes} 分钟传一次，不管有没有改动。`
              : AUTO_COPY.smartNote}
        </p>
      </div>

      <div className="setting-group">
        <label className="setting-row m-cloud__field">
          <span className="setting-row__label">服务地址</span>
          <input
            className="m-input m-cloud__input"
            data-cloud-field="baseUrl"
            value={draft.baseUrl}
            spellCheck={false}
            disabled={locked}
            placeholder="https://dav.jianguoyun.com/dav/"
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </label>
        <label className="setting-row m-cloud__field">
          <span className="setting-row__label">远端目录</span>
          <input
            className="m-input m-cloud__input"
            data-cloud-field="basePath"
            value={draft.basePath}
            spellCheck={false}
            disabled={locked}
            placeholder="/Timing"
            onChange={(event) => patch({ basePath: event.target.value })}
          />
        </label>
        <label className="setting-row m-cloud__field">
          <span className="setting-row__label">账号</span>
          <input
            className="m-input m-cloud__input"
            data-cloud-field="user"
            value={draft.user}
            spellCheck={false}
            disabled={locked}
            placeholder="坚果云登录邮箱"
            onChange={(event) => patch({ user: event.target.value })}
          />
        </label>
        <label className="setting-row m-cloud__field">
          <span className="setting-row__label">应用密码</span>
          <input
            className="m-input m-cloud__input"
            data-cloud-field="secret"
            type="password"
            value={secret ?? ''}
            spellCheck={false}
            disabled={locked}
            placeholder={status.hasSecret ? '已保存，留空表示不修改' : '坚果云请用应用密码'}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        <p className="m-hint">{CLOUD_DIR_HINT}</p>

        <div className="m-cloud__actions">
          <button
            type="button"
            className="m-btn m-btn--primary"
            disabled={busy}
            onClick={commit}
          >
            {dirty ? '保存云端设置' : '保存'}
          </button>
          <button
            type="button"
            className="m-btn m-btn--small"
            disabled={busy || testing}
            onClick={() => void handleTest()}
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="m-btn m-btn--small"
            disabled={locked}
            onClick={() => setSecret('')}
          >
            清除密码
          </button>
        </div>

        <CloudTestResult result={testResult} />

        {draft.enabled && status && <CloudStatusLine status={status} ready={ready} />}
      </div>
    </>
  );
}
