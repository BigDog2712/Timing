/**
 * Timing — 设置 · 同步 · 云端通道卡（V0.11.13，ADR-061）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` 拆出（那个文件已 298 行，新增控件只能另起文件）。
 *
 * [V0.11.15] 变成块④的**正文**：自带的 `<section>` / `<header>` 去掉了，标题「WebDAV
 * 云端同步」与折叠交给 `FoldBlock`（再套一层卡会得到两层边框）。
 *
 * 三条纪律：
 * 1. **要落库的值一律走 `draft`**，本文件只留「与保存无关」的界面状态（测试连接结果）；
 * 2. 密码框**不受控于** `hasSecret`：`secret === null` 的含义是「没碰过」，保存时按
 *    `undefined` 透传（不动已存密文），所以绝不能把 `hasSecret` 反填成 `'******'`；
 * 3. 关掉开关只把字段变灰、不隐藏（用户要能看到自己填过什么）；手机端不渲染「本地目录」，
 *    **[V0.11.14] 并且草稿里的 `mode` 也换成 `webdav`**（在 `useMdSyncDraft` 回填时换），
 *    本文件只负责把这件事说出来——显示与落库必须是同一个值，静默不一致比显示错更糟。
 *
 * 总开关留在正文第一行而不是标题右侧：它要顺手清掉本地的 `testResult`（上一次的绿字
 * 不该替刚关掉的通道背书），那个 state 在本文件里，抬到块标题上就得多绕一圈。
 */
import { useState } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { errorText, mdSyncApi } from '../../services/api';
import { pickFolder } from '../../services/folderPicker';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import type {
  CloudMode, MdSyncCloud, MdSyncConfig, MdSyncTestResult, MdSyncTestStepKey,
} from '../../types/domain';
import { Switch } from '../ui/Switch';
import { pollSecsOf } from './mdSyncConfig';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncCloudCardProps {
  draft: MdSyncDraft;
}

const MODE_LABELS: Record<CloudMode, string> = { localfolder: '本地目录', webdav: 'WebDAV' };
const MODE_ORDER: CloudMode[] = ['localfolder', 'webdav'];

/**
 * [V0.11.16] 三关的**界面标签**。后端的 `key` 是契约（`account` / `dir` / `write`），
 * 中文标签归前端：改「目录」这个说法不必动 Rust。
 */
const STEP_LABELS: Record<MdSyncTestStepKey, string> = { account: '账号', dir: '目录', write: '写入' };

export function MdSyncCloudCard({ draft }: MdSyncCloudCardProps) {
  const status = useMdSyncStore((s) => s.view?.cloud ?? null);
  const { cloud, saving, secret, modeConverted, updateCloud, setSecret } = draft;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MdSyncTestResult | null>(null);
  /* 手机端只有 WebDAV 一条路，`mode` 就是草稿里那个值（`useMdSyncDraft` 已把
     `localfolder` 换掉），这里不再做第二遍掰值——显示与落库必须是同一个值。 */
  const mode: CloudMode = cloud.mode;
  const disabled = !cloud.enabled || saving;
  const pendingDates = status?.pendingDates ?? [];
  const patch = (next: Partial<MdSyncCloud>) => updateCloud({ ...cloud, ...next });

  const handlePick = async () => {
    const picked = await pickFolder('选择云端那份 TimingMD 的落点目录', cloud.localRoot || undefined);
    if (picked) patch({ localRoot: picked });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const config: MdSyncConfig = {
        enabled: draft.enabled,
        pollSecs: pollSecsOf(draft.pollMin),
        /* [V0.11.16] 与保存**同一个数组**（`draft.resolvedBindings`）：这里若还用
           `draft.bindings`，就会出现「测试按草稿的旧三档跑、保存按新的写」这种没人
           能复现的错。 */
        bindings: draft.resolvedBindings,
        cloud,
      };
      /* 与保存同一条口径：`secret === null` → `undefined`（拿已存密文去测） */
      setTestResult(await mdSyncApi.test(config, secret ?? undefined));
    } catch (err) {
      setTestResult({ ok: false, detail: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  /* 失败那一关（`steps` 只含走过的关，所以最多一个 `ok === false`） */
  const failedStep = testResult?.steps?.find((item) => !item.ok) ?? null;

  return (
    <div className="sync__fields">
      <div className="sync__card-head">
        <div className="sync__card-title">
          <span className="sync__label">启用云端通道</span>
          {/* [V0.11.16] C19 收到块标题下（`MdSyncTab` 的 `hint` =「再送一份到坚果云。」）：
              卡里再写一遍就是同一句话说两次（PRD A1：每块标题下只有一句）。 */}
        </div>
        <div className="sync__card-tools">
          <Switch checked={cloud.enabled} label="启用云端通道" disabled={saving}
            onChange={(next) => { setTestResult(null); patch({ enabled: next }); }} />
        </div>
      </div>

      <div className="seg seg--compact" role="group" aria-label="云端通道方式">
        {MODE_ORDER.filter((value) => !IS_MOBILE || value !== 'localfolder').map((value) => (
          <button key={value} type="button" className="seg__item" disabled={saving}
            data-on={mode === value ? 'true' : 'false'} aria-pressed={mode === value}
            onClick={() => patch({ mode: value })}>
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>

      {/* 手机端把「本地目录」换成了 WebDAV：这属于改用户配置，必须当面说清，不许静默 */}
      {modeConverted && (
        <p className="sync-cloud__hint" data-converted="true">
          这份配置原来是「本地目录」，手机端不支持（那条路靠电脑上的网盘客户端同步一个目录）；
          保存后会改成 WebDAV，请把服务地址、远端目录与账号补上。
        </p>
      )}

      {mode === 'localfolder' ? (
        <div className="sync__field">
          <span className="sync__label">落点目录</span>
          <div className="sync__row">
            <input className="sync-cloud__input" value={cloud.localRoot} disabled={disabled} spellCheck={false}
              placeholder="D:\\Nutstore\\我的坚果云\\TimingMD"
              onChange={(event) => patch({ localRoot: event.target.value })} />
            <button type="button" className="btn btn--neutral sync__pick" disabled={disabled}
              onClick={() => void handlePick()}>
              选择目录
            </button>
          </div>
          {/* [V0.11.16] C20：原来这里还有一句「这个目录就是云端那份 TimingMD 的落点，
              换机器时把它同步过去即可。」——输入框的 placeholder 已经写着落点目录，
              删掉（PRD A2 要求这类重复话全页零命中）。 */}
        </div>
      ) : (
        <div className="sync__fields">
          <label className="sync__field">
            <span className="sync__label">服务地址</span>
            <input className="sync-cloud__input" value={cloud.baseUrl} disabled={disabled} spellCheck={false}
              placeholder="https://dav.jianguoyun.com/dav/"
              onChange={(event) => patch({ baseUrl: event.target.value })} />
          </label>
          <div className="sync__grid">
            <label className="sync__field">
              <span className="sync__label">远端目录</span>
              <input className="sync-cloud__input" value={cloud.basePath} disabled={disabled} spellCheck={false}
                placeholder="/Timing/md" onChange={(event) => patch({ basePath: event.target.value })} />
            </label>
            <label className="sync__field">
              <span className="sync__label">账号</span>
              <input className="sync-cloud__input" value={cloud.user} disabled={disabled} spellCheck={false}
                placeholder="坚果云登录邮箱" onChange={(event) => patch({ user: event.target.value })} />
            </label>
          </div>
          <label className="sync__field">
            <span className="sync__label">应用密码</span>
            <div className="sync__row">
              {/* `value={secret ?? ''}` 不是「密码是空的」，而是「用户这次没打算改」 */}
              <input className="sync-cloud__input" type="password" value={secret ?? ''} disabled={disabled}
                placeholder={status?.hasSecret ? '已保存，留空表示不修改' : '坚果云请用应用密码'}
                onChange={(event) => setSecret(event.target.value)} />
              <button type="button" className="btn btn--ghost sync__pick" disabled={disabled}
                title="清空已保存的密码" onClick={() => setSecret('')}>
                清除密码
              </button>
            </div>
          </label>
          <div className="sync-cloud__test">
            <button type="button" className="btn btn--ghost" disabled={saving || testing}
              onClick={() => void handleTest()}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <div className="sync-cloud__result" data-ok={testResult.ok ? 'true' : 'false'}>
                {/* [V0.11.16] 三关逐步点亮（PRD E3/E6）：红在哪一关就停在那一关，
                    后面关不显示；`steps` 缺失（浏览器 mock / 老后端）时退回一句 `detail`。 */}
                {testResult.steps && testResult.steps.length > 0 ? (
                  <>
                    <span className="sync-cloud__steps">
                      {testResult.steps.map((item, index) => (
                        <span key={item.key} className="sync-cloud__step" data-ok={item.ok ? 'true' : 'false'}>
                          {index > 0 ? ' ' : ''}{STEP_LABELS[item.key]} {item.ok ? '✓' : '✗'}
                        </span>
                      ))}
                    </span>
                    {/* 失败只说那一件事：那一关的原文，不改写、不拼接 */}
                    {failedStep?.detail && <p className="sync__error">{failedStep.detail}</p>}
                  </>
                ) : (
                  <span>{testResult.detail}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 状态一律以 `status` 为准：没拿到视图时宁可不显示，也不假装「已开启 / 已上传」 */}
      {cloud.enabled && status && (
        <div className="sync-cloud__status">
          <span>{status.hasSecret ? '密码已保存' : '密码未设置'}</span>
          <span>{status.todayPushed ? '今天已上传' : '今天还没上传'}</span>
          {pendingDates.length > 0 && (
            <span>待补传 {pendingDates.length} 天：{pendingDates.slice(0, 3).join('、')}…</span>
          )}
          {status.lastError && <p className="sync__error">{status.lastError}</p>}
        </div>
      )}
    </div>
  );
}
