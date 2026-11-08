/**
 * Timing — 移动端云端通道的两块「只读事实」（V0.11.21）
 * -----------------------------------------------------------------------------
 * 从 `SyncCloudPane.tsx` 抽出来的：那个文件抽完这两块之前是 329 行，越过 `check:size`
 * 的 300 行硬门禁。抽走的都是**没有交互**的部分——测试结果与状态行，它们的输入只有
 * props，所以放在这里还能单独被用例钉住。
 *
 * 两条纪律（照桌面的口径，别自己另立一套）：
 * 1. 状态一律以 `status` 为准：没拿到视图时宁可不显示，也不假装「已开启 / 已上传」；
 * 2. 失败只说那一件事：只渲染走过且失败的那一关的原文，不改写、不拼接、不出现裸状态码。
 */
import type { MdSyncCloudStatus, MdSyncTestResult } from '../../types/domain';

/**
 * 三关的**界面标签**。后端的 `key` 是契约（`account` / `dir` / `write`），
 * 中文标签归前端：改「目录」这个说法不必动 Rust。
 */
const STEP_LABELS: Record<string, string> = { account: '账号', dir: '目录', write: '写入' };

/** 「测试连接」的结果：三关逐步点亮，红在哪一关就停在哪一关。 */
export function CloudTestResult({ result }: { result: MdSyncTestResult | null }) {
  if (!result) return null;
  /* `steps` 只含走过的关，所以最多一个 `ok === false`。
     没有 `steps`（老后端 / 极端失败）时退回一句 `detail`。 */
  const failed = result.steps?.find((item) => !item.ok) ?? null;
  return (
    <div className="m-cloud__result" data-ok={result.ok ? 'true' : 'false'}>
      {result.steps && result.steps.length > 0 ? (
        <>
          <span className="m-cloud__steps">
            {result.steps.map((item) => (
              <span key={item.key} data-ok={item.ok ? 'true' : 'false'}>
                {STEP_LABELS[item.key] ?? item.key} {item.ok ? '✓' : '✗'}
              </span>
            ))}
          </span>
          {failed?.detail && <p className="m-cloud__error">{failed.detail}</p>}
        </>
      ) : (
        <span>{result.detail}</span>
      )}
    </div>
  );
}

/**
 * 状态行。`ready` 由调用方按**草稿**算（「照现在填的这份会不会跑」），不是落库值。
 *
 * 未填全那一刻**只**显示那一句，**不叠加**「今天还没上传」：两句并排，用户会读成
 * 「在传、只是没传上去」，而事实是压根没跑。`lastError` 也一起不显示——那是上一份
 * 配置留下的旧结论，跟「还没填全」无关。
 */
export function CloudStatusLine({
  status,
  ready,
}: {
  status: MdSyncCloudStatus;
  ready: boolean;
}) {
  const pending = status.pendingDates;
  return (
    <div className="m-cloud__status" data-ready={ready ? 'true' : 'false'}>
      {ready ? (
        <>
          <span>{status.hasSecret ? '密码已保存' : '密码未设置'}</span>
          <span>{status.todayPushed ? '今天已上传' : '今天还没上传'}</span>
          {pending.length > 0 && (
            <span>
              待补传 {pending.length} 天：{pending.slice(0, 3).join('、')}
              {pending.length > 3 ? '…' : ''}
            </span>
          )}
          {status.lastError && <p className="m-cloud__error">{status.lastError}</p>}
        </>
      ) : (
        <span>云端还没填全，暂时不会同步。</span>
      )}
    </div>
  );
}
