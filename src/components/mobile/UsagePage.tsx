import { useCallback, useEffect, useMemo, useState } from 'react';

import { errorText } from '../../services/ipc';
import { loadUsageDay, openUsageSettings, todayKey } from '../../services/usageActions';
import type { UsageDayDto } from '../../types/domain/usage';
import { useUiStore } from '../../stores/uiStore';

/**
 * [0.13.0] 应用使用统计（安卓）。
 *
 * 三种状态必须长得不一样，这是本页唯一的设计原则：
 * 1. **不支持**（桌面 / 老系统）：一句话说清「手机上才有」，不画空图表。
 * 2. **未授权**（`USAGE_PERMISSION_DENIED`）：讲清为什么、给一个「去授权」按钮。
 *    **绝不显示 0 分钟排行** —— 那会让人以为自己今天什么都没干。
 * 3. **有数据**：按时长降序的排行 + 合计。
 *
 * 数据口径（与 PC 版一致的部分）：只算前台，息屏不计。页面底部常驻一句说明，
 * 因为「我明明用了两小时」是这类功能最常见的一句反问。
 */
export function UsagePage() {
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'unsupported' | 'error'>('loading');
  const [day, setDay] = useState<UsageDayDto | null>(null);
  const [message, setMessage] = useState<string>('');
  const setNotice = useUiStore((s) => s.setNotice);

  const dayKey = useMemo(() => todayKey(), []);

  const load = useCallback(async () => {
    try {
      const next = await loadUsageDay(dayKey);
      setDay(next);
      setState(next.supported ? 'ready' : 'unsupported');
    } catch (error) {
      const text = errorText(error);
      setMessage(text);
      /* 只有一条分支能进「未授权」：错误码明确是权限。别的错误一律按错误态显示原文，
         不许含糊成「今天没有数据」。 */
      const code = (error as { code?: string })?.code;
      setState(code === 'USAGE_PERMISSION_DENIED' ? 'denied' : 'error');
    }
  }, [dayKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = useCallback(async () => {
    try {
      await openUsageSettings();
      /* 用户去系统设置里开完回来，本页重新挂载才会重取；这里给一句提示，不假装已生效。 */
      setNotice({ text: '开好权限后回到这一页即可看到统计', tone: 'info' });
    } catch (error) {
      setNotice({ text: errorText(error), tone: 'danger' });
    }
  }, [setNotice]);

  const total = day?.totalSec ?? 0;
  const max = day?.rows.reduce((peak, row) => Math.max(peak, row.sec), 0) ?? 0;

  return (
    <div className="m-usage">
      {state === 'loading' ? <p className="m-usage__hint">正在读取…</p> : null}

      {state === 'unsupported' ? (
        <p className="m-usage__hint">应用使用统计只有安卓版有。电脑上的统计在分析窗里。</p>
      ) : null}

      {state === 'denied' ? (
        <div className="m-usage__card">
          <h2 className="m-usage__title">需要「使用情况访问」权限</h2>
          <p className="m-usage__hint">
            安卓只允许在系统设置里单独打开这项权限。打开后，这一页会显示每个应用今天在前台用了多久。
          </p>
          <p className="m-usage__hint">记录只留在本机，不上传。只统计前台时间，息屏不计。</p>
          <button type="button" className="m-btn m-btn--primary" onClick={() => void grant()}>
            去系统设置打开
          </button>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="m-usage__card">
          <p className="m-usage__hint">{message || '读取失败'}</p>
          <button type="button" className="m-btn" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      {state === 'ready' ? (
        total === 0 ? (
          <p className="m-usage__hint">今天还没有可统计的前台使用记录。</p>
        ) : (
          <>
            <p className="m-usage__total">
              今日合计 <strong>{formatDuration(total)}</strong>
            </p>
            <ul className="m-usage__list">
              {day?.rows.map((row) => (
                <li key={row.packageName} className="m-usage__row">
                  <span className="m-usage__name" title={row.packageName}>{shortName(row.packageName)}</span>
                  <span className="m-usage__bar" aria-hidden="true">
                    <span
                      className="m-usage__bar-fill"
                      style={{ width: `${max > 0 ? Math.max(2, Math.round((row.sec / max) * 100)) : 0}%` }}
                    />
                  </span>
                  <span className="m-usage__sec">{formatDuration(row.sec)}</span>
                </li>
              ))}
            </ul>
            <p className="m-usage__note">只统计前台时间，息屏与后台播放不计。数据只留本机。</p>
          </>
        )
      ) : null}
    </div>
  );
}

/** 秒 → 「1h 05m」/「12m」：与 PC 版 `formatDashboardDuration` 同口径（分钟取整）。 */
export function formatDuration(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(safe / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return `${hours}h ${String(rest).padStart(2, '0')}m`;
  return `${minutes}m`;
}

/**
 * 包名 → 可读名。
 *
 * 真正的应用名要从 `PackageManager` 取（拿 label 需要原生桥再走一趟）。这一步排在 P2：
 * 先把「哪个包用了多久」显示对，比显示一个漂亮名字更重要。这里取包名最后一段并首字母大写，
 * 至少比 `com.tencent.mm` 这种长串好认。
 */
export function shortName(packageName: string): string {
  const tail = packageName.split('.').filter(Boolean).pop() ?? packageName;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
