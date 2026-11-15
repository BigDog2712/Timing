import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errorText } from '../../services/ipc';
import {
  TREND_DAYS,
  loadUsageDay,
  openUsageSettings,
  recentDayKeys,
  shiftDayKey,
  todayKey,
} from '../../services/usageActions';
import { appSeries, rangeOf, type UsageRange } from '../../services/usageRange';
import { buildInsights } from './usageInsights';
import { UsageAppDetail } from './UsageAppDetail';
import { UsageDayView } from './UsageDayView';
import { UsageGate } from './UsageGate';
import { UsageRangeSwitch, type UsageMode } from './UsageRangeSwitch';
import { UsageTrend, type UsageTrendPoint } from './UsageTrend';
import { UsageWeekView } from './UsageWeekView';
import type { UsageDayDto } from '../../types/domain/usage';
import { useUiStore } from '../../stores/uiStore';

/**
 * [0.13.2] 应用使用统计（安卓）· 单日 / 近 7 天 + 单应用详情。
 *
 * 这一页只干三件事：**取数**（补算 7 天窗口）、**管状态**（哪种门禁 / 哪一天失败）、
 * **分流**（单日 / 区间 / 详情）。排版全在 `UsageDayView` / `UsageWeekView` /
 * `UsageAppDetail` 三个视图里，页面自身不认识任何一行的样式。
 *
 * ## 为什么打开页面要先补算整个 7 天窗口
 * 系统只保留约 7 天明细，而落库（`app_usage`）只在这一页被打开时发生。如果只读今天，
 * 用户隔一天再进来，昨天就永久没了。所以进页面**从旧到新**串行补算 7 天：既填满趋势柱，
 * 也把历史落到本机。重复上报取 MAX（见 `services/usage.rs`），补算无害。
 *
 * ## 三个不许
 * - 未读到的一天**不许**画成 0 柱（`totalSec: null` 走骨架，不是空柱）。
 * - 某一天读失败**不许**整页翻红：只把这一天标成失败，其余照常。
 * - 合计与排行**必须同一份数**：都走 `rangeOf()`（由行求和），不另读一个总量。
 */
type Phase = 'loading' | 'ready' | 'denied' | 'unsupported' | 'error';

export function UsagePage() {
  const today = useMemo(() => todayKey(), []);
  const keys = useMemo(() => recentDayKeys(today, TREND_DAYS), [today]);
  const yesterdayKey = useMemo(() => shiftDayKey(today, -1), [today]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<UsageMode>('day');
  const [selectedKey, setSelectedKey] = useState(today);
  const [detailPkg, setDetailPkg] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, UsageDayDto>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [trend, setTrend] = useState<UsageTrendPoint[]>(() =>
    recentDayKeys(today, TREND_DAYS).map((key) => ({ key, totalSec: null })),
  );
  /* 缓存与 `days` 同步写：`selectDay` 要先判断「这天有没有」，用 state 读会拿到上一次渲染的值 */
  const cache = useRef<Record<string, UsageDayDto>>({});
  const mounted = useRef(true);
  const setNotice = useUiStore((s) => s.setNotice);

  /* StrictMode 下 effect 会 unmount 再 mount 一次：标志位必须在 effect 体里**写回 true**，
     只在 cleanup 里置 false 的话，第二次 mount 之后它就永远是 false（页面永久「加载中」） */
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const put = useCallback((dto: UsageDayDto) => {
    cache.current[dto.date] = dto;
    setDays((prev) => ({ ...prev, [dto.date]: dto }));
    setTrend((prev) =>
      prev.map((point) => (point.key === dto.date ? { ...point, totalSec: dto.totalSec } : point)),
    );
    setFailed((prev) => {
      if (!(dto.date in prev)) return prev;
      const next = { ...prev };
      delete next[dto.date];
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let filled = 0;
      for (const key of recentDayKeys(today, TREND_DAYS)) {
        try {
          /* 串行：原生桥不并发（同一条 `usageDay` 通道，并行只会让两端都变慢） */
          const dto = await loadUsageDay(key);
          if (!alive) return;
          if (!dto.supported) {
            setPhase('unsupported');
            return;
          }
          put(dto);
          filled += 1;
          if (filled === 1) setPhase('ready');
        } catch (error) {
          if (!alive) return;
          const code = (error as { code?: string })?.code;
          if (code === 'USAGE_PERMISSION_DENIED') {
            setMessage(errorText(error));
            setPhase('denied');
            return;
          }
          if (filled === 0) {
            setMessage(errorText(error));
            setPhase('error');
            return;
          }
          /* 已经有数据：这一天记成失败，不打断整页 */
          setFailed((prev) => ({ ...prev, [key]: errorText(error) }));
        }
      }
      if (alive && filled > 0) setPhase('ready');
    })();
    return () => {
      alive = false;
    };
  }, [today, put]);

  const selectDay = useCallback(
    (key: string) => {
      setSelectedKey(key);
      setMode('day');
      if (cache.current[key]) return;
      void (async () => {
        try {
          const dto = await loadUsageDay(key);
          if (!mounted.current) return;
          put(dto);
        } catch (error) {
          if (!mounted.current) return;
          const code = (error as { code?: string })?.code;
          if (code === 'USAGE_PERMISSION_DENIED') {
            setMessage(errorText(error));
            setPhase('denied');
            return;
          }
          setFailed((prev) => ({ ...prev, [key]: errorText(error) }));
        }
      })();
    },
    [put],
  );

  const grant = useCallback(async () => {
    try {
      await openUsageSettings();
      /* 用户去系统设置里开完回来，本页重新挂载才会重取；这里给一句提示，不假装已生效。 */
      setNotice({ text: '开好权限后回到这一页即可看到统计', tone: 'info' });
    } catch (error) {
      setNotice({ text: errorText(error), tone: 'danger' });
    }
  }, [setNotice]);

  const current = days[selectedKey];
  const loadedDays = useMemo(
    () => keys.map((key) => days[key]).filter((day): day is UsageDayDto => day != null),
    [keys, days],
  );
  const week = useMemo(() => rangeOf(loadedDays), [loadedDays]);
  const day: UsageRange | null = useMemo(
    () => (current == null ? null : rangeOf([current])),
    [current],
  );
  /* 洞察句以「用户正在看的那一天」为准：看往日时说「比昨天多用」必须指那一天的前一天，
     否则就是拿今天的趋势去描述 11/12（看着相关、其实无关）。区间态锚在今天。 */
  const insights = useMemo(
    () => buildInsights({ days, keys, anchor: mode === 'week' ? today : selectedKey }),
    [days, keys, mode, today, selectedKey],
  );
  /* 详情柱与主趋势柱同一口径：没读到的那天是 null，不是 0 */
  const detailPoints = useMemo<UsageTrendPoint[]>(() => {
    if (detailPkg == null) return [];
    const series = appSeries(days, keys, detailPkg);
    return keys.map((key, i) => ({ key, totalSec: series[i] ?? null }));
  }, [days, keys, detailPkg]);
  const yesterday = days[yesterdayKey];

  if (phase === 'unsupported' || phase === 'denied' || phase === 'error') {
    return (
      <UsageGate
        kind={phase}
        message={message}
        onGrant={() => void grant()}
        onRetry={() => void selectDay(selectedKey)}
      />
    );
  }

  if (detailPkg != null) {
    const row = current?.rows.find((item) => item.packageName === detailPkg);
    return (
      <UsageAppDetail
        packageName={detailPkg}
        points={detailPoints}
        selected={selectedKey}
        onSelectDay={selectDay}
        onBack={() => setDetailPkg(null)}
        firstLast={row == null ? null : { first: row.first, last: row.last }}
      />
    );
  }

  return (
    <div className="m-usage">
      <UsageRangeSwitch mode={mode} onChange={setMode} />
      <UsageTrend points={trend} selected={selectedKey} onSelect={selectDay} />
      {mode === 'week' ? (
        <UsageWeekView week={week} insights={insights} onSelectApp={setDetailPkg} />
      ) : (
        <UsageDayView
          selectedKey={selectedKey}
          today={today}
          day={day}
          failure={failed[selectedKey]}
          deltaSec={
            selectedKey === today && yesterday != null && day != null
              ? day.totalSec - yesterday.totalSec
              : null
          }
          insights={insights}
          onSelectDay={selectDay}
          onStepDay={(delta) => selectDay(shiftDayKey(selectedKey, delta))}
          onSelectApp={setDetailPkg}
          onRetry={() => void selectDay(selectedKey)}
        />
      )}
    </div>
  );
}
