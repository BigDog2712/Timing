/**
 * Timing — 结束态瞬时确认（900ms 绿勾 / 「已保存」）
 * -----------------------------------------------------------------------------
 * `uiStore.endedAt` 是**时刻**（`flashEnded()` 写入 `Date.now()`），不是布尔：它从不归零，
 * 也就意味着「有没有结束过」这件事永远为真。药丸/圆点常驻不卸载时无所谓，但任何重挂载
 * （手机切 Tab、桌面折叠后展开）都会把那个旧时间戳当成刚刚发生，重放一次 900ms 结束态——
 * 用户看到的是「我什么都没点，界面自己说已保存」。
 *
 * 所以这里把「时刻」当窗口用：只有落在 `ENDED_FLASH_MS` 之内的才算数，
 * 并且只闪剩余的毫秒数（重挂载晚了 300ms 就只闪 600ms，而不是重新计 900ms）。
 * 三个消费方（PillBar / CollapsedDot / TimerPage）共用，避免三份同样的判断各自漂移。
 */
import { useEffect, useState } from 'react';
import { ENDED_FLASH_MS } from '../lib/constants';
import { useUiStore } from '../stores/uiStore';

export function useEndedFlash(): boolean {
  const endedAt = useUiStore((s) => s.endedAt);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (endedAt == null) return;
    const elapsed = Date.now() - endedAt;
    /* 陈旧时间戳（上一次结束留下的）不重放 */
    if (elapsed >= ENDED_FLASH_MS) return;
    setEnded(true);
    const id = window.setTimeout(() => setEnded(false), ENDED_FLASH_MS - elapsed);
    return () => window.clearTimeout(id);
  }, [endedAt]);

  return ended;
}
