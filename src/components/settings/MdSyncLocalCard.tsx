/**
 * Timing — 设置 · 数据管理 · 块④「本地同步」（V0.11.26 新增，PRD §4.2 / 设计 §1.4）
 * -----------------------------------------------------------------------------
 * 从块⑤ 里拆出来的那一半：**落点目录 + 选择目录 + 测试连接 + 状态行 + 三档**。
 * 它对应后端 `round_folder`（零网络，写进目录就算同步完），与块⑤ 是天平的两端：
 *
 * - 两条通路**各有自己的开关**（`cloudFolder.enabled` / `cloudWebdav.enabled`），允许同开
 *   （PRD R4），所以本组件不认识块⑤ 的任何字段——改了这里，那里一个字节都不动（O13）；
 * - 状态行只读 `view.local`（后端按通路各投一份），不串块⑤ 的 `pendingDates`；
 * - 「没填全」只说一句 `云端目录还没填，暂时不会同步。`（L4 逐字），出现时状态区**只这一句**。
 *
 * 手机端不挂载本块（PRD R7）：手机上只有 WebDAV 一条路，本地目录靠电脑上的网盘客户端，
 * 手机既没有那个目录也没有客户端（后端 `NO_LOCAL_FOLDER_ON_MOBILE` 同一个理由）。
 *
 * 三条纪律（与块⑤ 一致）：
 * 1. **要落库的值一律走 `draft.folder`**，本文件只留「与保存无关」的界面状态（测试结果）；
 * 2. 「测试连接」**保持可点**，即便通路关着（只读探测，PRD §4.3）；其余控件关则灰但**可见**；
 * 3. 探测载荷是 **legacy `localfolder` 形状**（`probe.rs` 是红线文件，只认带 `mode` 的旧结构）。
 */
import { useState } from 'react';
import { errorText, mdSyncApi } from '../../services/api';
import { pickFolder } from '../../services/folderPicker';
import { useMdSyncStore } from '../../stores/mdSyncStore';
import type { MdSyncCloudAuto, MdSyncConfig, MdSyncTestResult } from '../../types/domain';
import { purgeNoteOf } from './mdSyncAuto';
import { isLocalReady, legacyCloudForTest } from './mdSyncConfig';
import { MdSyncCloudAuto as MdSyncAutoControl } from './MdSyncCloudAuto';
import type { MdSyncDraft } from './useMdSyncDraft';

interface MdSyncLocalCardProps {
  draft: MdSyncDraft;
}

/** 块④ 状态行的「没填全」句（PRD §7.1 L4 逐字）。 */
export const LOCAL_MISSING_NOTE = '云端目录还没填，暂时不会同步。';

export function MdSyncLocalCard({ draft }: MdSyncLocalCardProps) {
  /* 只读块④ 自己那份状态：`view.local` 由后端 `state::status_for(Folder)` 投影。 */
  const status = useMdSyncStore((s) => s.view?.local ?? null);
  const { folder, saving, updateFolder } = draft;
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MdSyncTestResult | null>(null);
  /* 声明式兜底（PRD §五 A8「机制保留」）：结论只对**测过的那份落点**生效。
     命令式清（每次开测先置 null）之外再加这一层，是因为将来任何新增的改值路径漏写一行，
     上一份落点的红字就会残留到新落点上——比「上一次测的是哪份目录」而不是「清得干不干净」，
     所以漏写也不会错。 */
  const [testedRoot, setTestedRoot] = useState<string | null>(null);

  const disabled = !folder.enabled || saving;
  const ready = isLocalReady(folder);
  const pendingDates = status?.pendingDates ?? [];

  const patch = (next: Partial<typeof folder>) => updateFolder({ ...folder, ...next });

  const handlePick = async () => {
    const picked = await pickFolder('选择本地同步的落点目录', folder.localRoot || undefined);
    if (picked) patch({ localRoot: picked });
  };

  const handleTest = async () => {
    setTestResult(null);
    setTestedRoot(folder.localRoot ?? '');
    setTesting(true);
    try {
      const config: MdSyncConfig = {
        enabled: draft.enabled,
        pollSecs: draft.pollSecs,
        /* 与保存同一个数组（`resolvedBindings`），否则「测试按旧三档、保存按新的」 */
        bindings: draft.resolvedBindings,
        /* 探测载荷现拼 legacy 形状：`probe` 按 `mode` 分派，红线文件零改动（设计 §四-4）。 */
        cloud: legacyCloudForTest('localfolder', folder),
      };
      setTestResult(await mdSyncApi.test(config, undefined));
    } catch (err) {
      setTestResult({ ok: false, detail: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  const shown = testedRoot === (folder.localRoot ?? '') ? testResult : null;

  return (
    <div className="sync__fields">
      {/* [V0.11.26] 三档在块内第一行（D1 位置形态平移），值属于 folder 这一份（R5）。 */}
      <MdSyncAutoControl
        auto={folder.auto}
        disabled={disabled}
        minutesLabel="本地自动同步周期（分钟）"
        onChange={(next: MdSyncCloudAuto) => patch({ auto: next })}
      />

      <div className="sync__field">
        <span className="sync__label">落点目录</span>
        <div className="sync__row">
          <input
            className="sync-cloud__input"
            value={folder.localRoot ?? ''}
            disabled={disabled}
            spellCheck={false}
            placeholder="D:\\Nutstore\\我的坚果云\\TimingMD"
            aria-label="本地同步落点目录"
            onChange={(event) => patch({ localRoot: event.target.value })}
          />
          <button
            type="button"
            className="btn btn--neutral sync__pick"
            disabled={disabled}
            onClick={() => void handlePick()}
          >
            选择目录
          </button>
        </div>
      </div>

      {/* 「测试连接」只跟 `saving || testing`：它是只读探测，「通路关着时想知道开了能不能用」
          是合理诉求（PRD §4.3 原样裁定）。**下一个人别顺手把它也灰掉。** */}
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
            {/* 本地目录那一档 `probe` 返回空 `steps`（零 HTTP），所以永远走 detail 退回路径 */}
            <span>{shown.detail}</span>
          </div>
        )}
      </div>

      {/* 状态一律以 `status` 为准：没拿到视图时宁可不显示，也不假装「已上传」 */}
      {folder.enabled && status && (
        <div className="sync-cloud__status" data-channel="folder" data-ready={ready ? 'true' : 'false'}>
          {ready ? (
            <>
              <span>{status.todayPushed ? '今天已上传' : '今天还没上传'}</span>
              {pendingDates.length > 0 && (
                <span>待补传 {pendingDates.length} 天：{pendingDates.slice(0, 3).join('、')}…</span>
              )}
              {status.lastError && <p className="sync__error">{status.lastError}</p>}
              {/* 清理四句的优先级唯一在 `purgeNoteOf`（块⑤ 同一份，不另写 if 链） */}
              <span data-purge="true">{purgeNoteOf(status.purge)}</span>
            </>
          ) : (
            /* 没填全只显示这一句：并排「今天还没上传」会被读成「在传、只是没传上去」，
               而事实是这一轮压根没跑（后端 `usable_folder` 返回 `None`）。 */
            <span data-missing="true">{LOCAL_MISSING_NOTE}</span>
          )}
        </div>
      )}
    </div>
  );
}
