/**
 * [0.13.2] 统计页的三道门禁屏：不支持 / 未授权 / 读失败。
 *
 * 三种状态必须长得不一样（本页唯一的设计原则），所以它们从一个组件出去、由 `kind` 分流，
 * 而不是散在页面里三段 early return —— 页面文件要留给状态与取数。
 *
 * **未授权绝不显示 0 分钟排行**：那会让人以为自己今天什么都没干。
 */
interface Props {
  kind: 'unsupported' | 'denied' | 'error';
  message?: string;
  onGrant: () => void;
  onRetry: () => void;
}

export function UsageGate({ kind, message, onGrant, onRetry }: Props) {
  if (kind === 'unsupported') {
    return (
      <div className="m-usage">
        <p className="m-usage__hint">应用使用统计只有安卓版有。电脑上的统计在分析窗里。</p>
      </div>
    );
  }

  if (kind === 'denied') {
    return (
      <div className="m-usage">
        <div className="m-usage__card">
          <h2 className="m-usage__title">需要「使用情况访问」权限</h2>
          <p className="m-usage__hint">
            安卓只允许在系统设置里单独打开这项权限。打开后，这一页会显示每个应用今天在前台用了多久。
          </p>
          <p className="m-usage__hint">记录只留在本机，不上传。只统计前台时间，息屏不计。</p>
          <button type="button" className="m-btn m-btn--primary" onClick={onGrant}>
            去系统设置打开
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-usage">
      <div className="m-usage__card">
        <h2 className="m-usage__title">读不到应用使用数据</h2>
        {/* 原文照登：这一层是最后一道防线，把原因润色成「请重试」就再也没人能修它了 */}
        <p className="m-usage__raw">{message || '系统没有返回原因'}</p>
        <button type="button" className="m-btn" onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}
