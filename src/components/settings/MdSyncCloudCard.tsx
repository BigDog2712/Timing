/**
 * Timing — 设置 · 同步 · 云端通道卡（V0.11.13，ADR-061）
 * -----------------------------------------------------------------------------
 * 从 `MdSyncTab` 拆出（那个文件已 298 行，新增控件只能另起文件）。
 *
 * [V0.11.15] 变成块④的**正文**：自带的 `<section>` / `<header>` 去掉了，标题「WebDAV
 * 云端同步」与折叠交给 `FoldBlock`（再套一层卡会得到两层边框）。
 *
 * [V0.11.18] 三处改动，都是为了「通道」这件事：
 * 1. **删掉卡内第一行的「启用云端通道」Switch**：通道位已上移到页签顶部
 *    （`MdSyncChannelSeg`），块里再留一个布尔就是第二个真相（PRD §3.1 的「与块④的关系」）。
 *    变灰机制不受影响——它绑的是 `cloud.enabled` 这个**值**（见 `disabled`），
 *    不是那个 `Switch` 组件；
 * 2. **「测试连接」搬出 `mode` 三元**：原来它只在 WebDAV 分支里，`localfolder` 用户
 *    根本没有自证入口，只能把载体切到 WebDAV 去点 → 一点就 403 → 「报红但能同步」；
 * 3. **状态行的「密码」只在 WebDAV 下渲染**：`state.rs` 的 `has_secret` 无条件读
 *    `KEY_WEBDAV`，`localfolder` 用户因此恒定看到一句「密码未设置」。
 *    这两条的真根因都在界面层，后端 `probe.rs` / `state.rs` 一行未改。
 *
 * 三条纪律：
 * 1. **要落库的值一律走 `draft`**，本文件只留「与保存无关」的界面状态（测试连接结果）；
 * 2. 密码框**不受控于** `hasSecret`：`secret === null` 的含义是「没碰过」，保存时按
 *    `undefined` 透传（不动已存密文），所以绝不能把 `hasSecret` 反填成 `'******'`；
 * 3. 关掉通道只把字段变灰、不隐藏（用户要能看到自己填过什么）；手机端不渲染「本地目录」，
 *    **[V0.11.14] 并且草稿里的 `mode` 也换成 `webdav`**（在 `useMdSyncDraft` 回填时换），
 *    本文件只负责把这件事说出来——显示与落库必须是同一个值，静默不一致比显示错更糟。
 */
import { useState } from 'react';
import { IS_MOBILE } from '../../lib/platform';
import { errorText, mdSyncApi } from '../../services/api';
import { pickFolder } from '../../services/folderPicker';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import type {
  CloudMode, MdSyncCloud, MdSyncConfig, MdSyncTestResult, MdSyncTestStepKey,
} from '../../types/domain';
import { pollSecsOf } from './mdSyncConfig';
import { CLOUD_DIR_HINT } from './mdSyncCopy';
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
  /* [V0.11.18] T02-b 声明式兜底：结果只对**测过的那一个载体**生效。

     为什么需要它：`testResult` 的 `null` 赋值全项目只有两处（`handleTest` 开头 +
     下面切载体的 `onClick`），而原来那个「切总开关就清结果」的 `Switch` 已经删掉（T01）。
     只靠命令式清 → 将来任何新增的 `patch({ mode })` 路径漏写一行，上一档的红字就会
     跨载体残留到另一档（用户看到「报红但同步明明在正常写文件」）。
     比「上一次测的是哪个载体」而不是「清得干不干净」，所以漏写也不会错。 */
  const [testedMode, setTestedMode] = useState<CloudMode | null>(null);
  /* 手机端只有 WebDAV 一条路，`mode` 就是草稿里那个值（`useMdSyncDraft` 已把
     `localfolder` 换掉），这里不再做第二遍掰值——显示与落库必须是同一个值。 */
  const mode: CloudMode = cloud.mode;
  /* 绑的是 `cloud.enabled` 这个**值**（= 存储通道是不是「本地 + 云端」），不是上面那个
     已被删掉的 `Switch` 组件。所以删 Switch 不破坏「只用本地时块④ 变灰」，
     分段控件写 `enabled` 之后灰/亮立刻跟着走（PRD A5：变灰、**不隐藏**）。 */
  const disabled = !cloud.enabled || saving;
  const pendingDates = status?.pendingDates ?? [];
  const patch = (next: Partial<MdSyncCloud>) => updateCloud({ ...cloud, ...next });

  const handlePick = async () => {
    const picked = await pickFolder('选择云端那份 TimingMD 的落点目录', cloud.localRoot || undefined);
    if (picked) patch({ localRoot: picked });
  };

  const handleTest = async () => {
    /* (1) 命令式：每次开测先清上一次的结论（上一次测的是另一档 / 旧配置，都不该留在屏幕上）。 */
    setTestResult(null);
    setTestedMode(mode);
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
      /* 与保存同一条口径：`secret === null` → `undefined`（拿已存密文去测）。
         [V0.11.18] 整份 `cloud` 传下去，`probe` 自己按 `mode` 分派
         （`probe.rs:50-53`）——所以这个按钮两个载体共用一个，不需要两份逻辑。 */
      setTestResult(await mdSyncApi.test(config, secret ?? undefined));
    } catch (err) {
      setTestResult({ ok: false, detail: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  /* 失败那一关（`steps` 只含走过的关，所以最多一个 `ok === false`）。
     [V0.11.18] 用 `shown` 而不是 `testResult`：(2) 声明式兜底，见 `testedMode` 的注释。 */
  const shown = testedMode === mode ? testResult : null;
  const failedStep = shown?.steps?.find((item) => !item.ok) ?? null;

  return (
    <div className="sync__fields">
      <div className="seg seg--compact" role="group" aria-label="云端通道方式">
        {MODE_ORDER.filter((value) => !IS_MOBILE || value !== 'localfolder').map((value) => (
          <button key={value} type="button" className="seg__item" disabled={saving}
            data-on={mode === value ? 'true' : 'false'} aria-pressed={mode === value}
            /* [V0.11.18] A8：切载体**必须**清掉上一次的测试结果。原来只有切总开关时清
               （那一行已随 Switch 一起删除），于是上一次 WebDAV 的红字会跨载体残留到
               本地目录上——用户看到「报红但本地同步明明在正常写文件」。
               这里同时把 `testedMode` 清掉：只清 `testResult` 的话，「A → B → A」切回来时
               声明式兜底会认为「A 还是那一次测的」，把已经过期的结论重新显出来。 */
            onClick={() => { setTestResult(null); setTestedMode(null); patch({ mode: value }); }}>
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
                placeholder="/Timing" onChange={(event) => patch({ basePath: event.target.value })} />
            </label>
            <label className="sync__field">
              <span className="sync__label">账号</span>
              <input className="sync-cloud__input" value={cloud.user} disabled={disabled} spellCheck={false}
                placeholder="坚果云登录邮箱" onChange={(event) => patch({ user: event.target.value })} />
            </label>
          </div>
          {/* [V0.11.17] B3：默认目录 /Timing 要用户先在网页版建好这个文件夹。文案在
              `mdSyncCopy.ts::CLOUD_DIR_HINT`（不在组件里写死）。 */}
          <p className="sync-cloud__hint">{CLOUD_DIR_HINT}</p>
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
        </div>
      )}

      {/* [V0.11.18] 「测试连接」在这里，**两个载体共用**（从 `mode` 三元里搬出来）。
          原来它只长在 WebDAV 分支里，于是本地目录用户没有自证入口，只能切到 WebDAV 去点，
          一点就 403 —— 这就是「报红但能同步」的主因（PRD A7 / 设计 §3.1 真因 1）。

          `disabled` 只跟 `saving || testing`，**故意不跟上面那个 `disabled`**：
          它是只读探测（`probe.rs` 首行注释「不写任何状态」），「只用本地」时想知道
          「打开了云端会不会能用」是合理诉求。**下一个人别顺手把它也灰掉。** */}
      <div className="sync-cloud__test">
        <button type="button" className="btn btn--ghost" disabled={saving || testing}
          onClick={() => void handleTest()}>
          {testing ? '测试中…' : '测试连接'}
        </button>
        {shown && (
          <div className="sync-cloud__result" data-ok={shown.ok ? 'true' : 'false'}>
            {/* [V0.11.16] 三关逐步点亮（PRD E3/E6）：红在哪一关就停在那一关，
                后面关不显示；`steps` 缺失（localfolder / 浏览器 mock / 老后端）时退回一句
                `detail` —— 本地目录那一档 `probe` 返回 `steps: Vec::new()`（`probe.rs:100`），
                所以它永远走这条退回路径，正是为这一档预留的。 */}
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
      {cloud.enabled && status && (
        <div className="sync-cloud__status" data-mode={mode}>
          {/* [V0.11.18] 「密码」这一项**只在 WebDAV 下有意义**：`state.rs:24-28` 的
              `has_secret` 无条件读 `KEY_WEBDAV`，而本地目录走的是文件系统、根本没有
              「应用密码」这回事。不门控就是一句恒定的错话（localfolder 用户永远是
              「密码未设置」）。门控放在前端 → 后端零改动、契约零变。
              `todayPushed` 在 localfolder 下是**准的**（`round_folder.rs` 与 webdav 走
              同一条 `md_cloud_pending::mark_synced` 落库路径），所以那一行不门控。 */}
          {mode === 'webdav' && (
            <span>{status.hasSecret ? '密码已保存' : '密码未设置'}</span>
          )}
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
