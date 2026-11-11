/**
 * Timing — 浏览器降级 Mock：命令处理器（非 Tauri 环境使用）
 * -----------------------------------------------------------------------------
 * 目的：在纯浏览器（`npm run dev` / 单测）下无 Tauri 运行时也能跑通全部交互，
 *       便于 UI 走查。**不参与生产**：Tauri 环境下 ipc.ts 一律走 invoke。
 * 种子数据与状态构造见同目录 mockSeed.ts。
 */
import type {
  ItemIdParams,
  RecordPatch,
  StatsSummary,
  TimeRecord,
  UpdateRecordParams,
  UpdateSettingsParams,
  UndoStopParams,
} from '../types/domain';
/* [0.12.1 归一] `pill` 的半份合并需要出厂值兜底；两者都属主窗（mocks 与 lib 同侧，L9 允许） */
import { DEFAULT_HANDLE_BINDINGS } from '../lib/handleCatalog';
import { DEFAULT_APPEARANCE } from '../lib/pillAppearance';
import { createMockApiV020 } from './browserMockV020';
import { createMockApiDaily } from './browserMockDaily';
import { createMockApiItems } from './browserMockItems';
import { createMockApiPlugins } from './browserMockPlugins';
import { createMockApiMigration } from './browserMockMigration';
import { buildState, fail, now, seed, type MockState } from './mockSeed';

/**
 * 命令名 -> 处理器。返回 rejected value 时抛 `{ code, message }`。
 */
export function createMockApi(): Record<string, (args?: any) => unknown> {
  const s: MockState = seed();

  const findItem = (id: number) => s.items.find((i) => i.id === id && i.status === 'active');

  const core: Record<string, (args?: any) => unknown> = {
    start_timer: (a) => {
      if (s.active) fail('TIMER_ALREADY_RUNNING', '已有进行中的计时');
      const itemId = (a?.itemId as number | undefined) ?? 1;
      if (!findItem(itemId)) fail('ITEM_NOT_FOUND', '事项不存在');
      const t = now();
      s.active = {
        id: ++s.seq,
        itemId,
        status: 'active',
        startedAt: t,
        endedAt: null,
        accumulatedSec: 0,
        runningSince: t,
        note: null,
        /* [V0.2.0] 正计时 */
        mode: 'countup',
        targetSec: null,
      };
      s.lastItemId = itemId;
      return s.active;
    },
    pause_timer: () => {
      if (!s.active) fail('TIMER_NOT_RUNNING', '没有进行中的计时');
      if (s.active.runningSince != null) {
        s.active.accumulatedSec += Math.floor((now() - s.active.runningSince) / 1000);
        s.active.runningSince = null;
      }
      return s.active;
    },
    resume_timer: () => {
      if (!s.active) fail('TIMER_NOT_RUNNING', '没有进行中的计时');
      if (s.active.runningSince == null) s.active.runningSince = now();
      return s.active;
    },
    stop_timer: () => {
      if (!s.active) fail('TIMER_NOT_RUNNING', '没有进行中的计时');
      const rec = s.active;
      if (rec.runningSince != null) {
        rec.accumulatedSec += Math.floor((now() - rec.runningSince) / 1000);
        rec.runningSince = null;
      }
      rec.status = 'saved';
      rec.endedAt = now();
      s.active = null;
      /* [V0.3.4] 与后端 `services::timer::stop` 同口径：低于「最短记录时长」→ 不保存
         （后端是软删，mock 直接不进 records），返回 discarded 让前端不展示撤销条。
         阈值读 `MockState.reference`，与设置页滑杆同一份状态。 */
      if (rec.accumulatedSec < s.reference.minRecordSeconds) {
        return { record: rec, discarded: true };
      }
      s.records.unshift(rec);
      return { record: rec, discarded: false };
    },
    undo_stop: (a) => {
      const { recordId } = a as UndoStopParams;
      if (s.active) fail('TIMER_ALREADY_RUNNING', '已开启新的计时');
      const idx = s.records.findIndex((r) => r.id === recordId);
      if (idx < 0) fail('TIMER_NO_UNDO', '撤销窗口已过期');
      const rec = s.records[idx];
      if (!rec || rec.status !== 'saved' || (rec.endedAt != null && now() - rec.endedAt > 3200)) {
        fail('TIMER_NO_UNDO', '撤销窗口已过期');
      }
      s.records.splice(idx, 1);
      rec.status = 'active';
      rec.endedAt = null;
      rec.runningSince = now();
      s.active = rec;
      return rec;
    },
    get_timer_state: () => buildState(s),
    switch_item: (a) => {
      if (!s.active) fail('TIMER_NOT_RUNNING', '没有进行中的计时');
      const itemId = a?.itemId as number;
      const mode = a?.mode as string;
      if (!findItem(itemId)) fail('ITEM_NOT_FOUND', '事项不存在');
      if (mode === 'end_and_start') {
        const rec = s.active;
        if (rec.runningSince != null) rec.accumulatedSec += Math.floor((now() - rec.runningSince) / 1000);
        rec.runningSince = null;
        rec.status = 'saved';
        rec.endedAt = now();
        s.records.unshift(rec);
        const t = now();
        s.active = {
          id: ++s.seq,
          itemId,
          status: 'active',
          startedAt: t,
          endedAt: null,
          accumulatedSec: 0,
          runningSince: t,
          note: null,
          /* [V0.2.0] 分段后新会话默认正计时 */
          mode: 'countup',
          targetSec: null,
        };
      } else {
        s.active.itemId = itemId;
      }
      s.lastItemId = itemId;
      return buildState(s);
    },
    list_records: (a) => {
      const itemId = a?.itemId as number | undefined;
      const page = (a?.page as number | undefined) ?? 1;
      const limit = (a?.limit as number | undefined) ?? 20;
      let rows = s.records.filter((r) => r.status === 'saved');
      if (itemId != null) rows = rows.filter((r) => r.itemId === itemId);
      rows = rows.sort((x, y) => y.startedAt - x.startedAt);
      const total = rows.length;
      const items = rows.slice((page - 1) * limit, page * limit);
      return { items, total, page, limit, hasMore: page * limit < total };
    },
    stats_summary: (a) => {
      const itemId = a?.itemId as number | undefined;
      let rows = s.records.filter((r) => r.status === 'saved');
      if (itemId != null) rows = rows.filter((r) => r.itemId === itemId);
      const byMap = new Map<number, number>();
      let totalSec = 0;
      for (const r of rows) {
        totalSec += r.accumulatedSec;
        byMap.set(r.itemId, (byMap.get(r.itemId) ?? 0) + r.accumulatedSec);
      }
      const byItem = [...byMap.entries()]
        .map(([id, sec]) => ({ itemId: id, totalSec: sec }))
        .sort((x, y) => y.totalSec - x.totalSec);
      const summary: StatsSummary = { totalSec, recordCount: rows.length, byItem, activity: [] };
      return summary;
    },
    update_record: (a) => {
      const p = a as UpdateRecordParams;
      const rec = s.records.find((r) => r.id === p.id);
      if (!rec) fail('ITEM_NOT_FOUND', '记录不存在');
      const patch: RecordPatch = p.patch;
      if (patch.itemId !== undefined) rec.itemId = patch.itemId;
      if (patch.endedAt !== undefined && patch.endedAt < (patch.startedAt ?? rec.startedAt)) {
        fail('INVALID_DURATION', '结束时间早于开始时间');
      }
      if (patch.startedAt !== undefined) rec.startedAt = patch.startedAt;
      if (patch.endedAt !== undefined) rec.endedAt = patch.endedAt;
      if (patch.note !== undefined) rec.note = patch.note;
      return rec;
    },
    delete_record: (a) => {
      const id = (a as ItemIdParams).id;
      s.records = s.records.filter((r) => r.id !== id);
      return undefined;
    },
    /* [P1-01] 补记为一条已完成的计时记录：与 Rust 同口径（saved / runningSince=null /
       countup / targetSec=null、走 (itemId, startedAt) 幂等）。浏览器 mock 不拆本地零点——
       拆段是 `services::timer_split` 的职责，这里只为走查弹卡与泳道刷新。 */
    create_record: (a) => {
      const itemId = a?.itemId as number, startedAt = a?.startedAt as number, endedAt = a?.endedAt as number;
      const note = (a?.note as string | null | undefined) ?? null;
      if (!findItem(itemId)) fail('ITEM_NOT_FOUND', '事项不存在');
      const t = now();
      if (endedAt <= startedAt || startedAt >= t || endedAt > t) fail('INVALID_DURATION', '补记时长不合法');
      const dup = s.records.find((r) => r.itemId === itemId && r.startedAt === startedAt && r.status === 'saved');
      if (dup) return [dup];
      const rec: TimeRecord = { id: ++s.seq, itemId, status: 'saved', startedAt, endedAt, accumulatedSec: Math.floor((endedAt - startedAt) / 1000), runningSince: null, note, mode: 'countup', targetSec: null };
      s.records.push(rec);
      return [rec];
    },
    resolve_open_record: (a) => {
      const action = a?.action as string;
      /* [V0.4.2] 与 Rust 同口径：只有勾了 includeGap 才补「退出期间」 */
      const includeGap = a?.includeGap === true;
      if (!s.active) return null;
      const rec = s.active;
      const gapSec =
        includeGap && rec.runningSince != null
          ? Math.max(0, Math.floor((now() - rec.runningSince) / 1000))
          : 0;
      if (action === 'resume') {
        rec.accumulatedSec += gapSec;
        rec.runningSince = now();
        return rec;
      }
      if (action === 'close') {
        rec.accumulatedSec += gapSec;
        rec.runningSince = null;
        rec.status = 'saved';
        rec.endedAt = (a?.endAt as number | undefined) ?? now();
        s.records.unshift(rec);
        s.active = null;
        return rec;
      }
      rec.status = 'saved';
      rec.endedAt = now();
      s.active = null;
      return null;
    },
    get_settings: () => s.settings,
    update_settings: (a) => {
      const patch = (a as UpdateSettingsParams).patch;
      const next = { ...s.settings, ...patch };
      /* [0.12.1 归一] `pill` 是**半份合并**：设置页的外观卡只发 `appearance`、手柄面板只发
         `handles`，浅合并会把另半份抹成 `undefined`（预览里表现为「调了不透明度，手柄
         绑定全没了」）。口径与 Rust `merge_pill_prefs` 一致：缺的那一半保持旧值。 */
      if (patch.pill) {
        next.pill = {
          appearance: patch.pill.appearance ?? s.settings.pill?.appearance ?? DEFAULT_APPEARANCE,
          handles: patch.pill.handles ?? s.settings.pill?.handles ?? DEFAULT_HANDLE_BINDINGS,
        };
      }
      s.settings = next;
      return s.settings;
    },
    set_autostart: (a) => {
      const enabled = Boolean(a?.enabled);
      s.settings.autostartEnabled = enabled;
      return enabled;
    },
    get_autostart: () => s.settings.autostartEnabled,
    show_window: () => undefined,
    /* 浏览器 mock：无权读真实工作区，退化成屏幕可用区（DIP 口径不严格，仅供布局不崩） */
    main_work_area: () => ({
      x: 0,
      y: 0,
      w: window.screen.availWidth || 1440,
      h: window.screen.availHeight || 900,
    }),
    hide_window: () => undefined,
    toggle_window: () => undefined,
    /* 浏览器 mock：没有真实小条，给小条应处的右下角位置，保证便利贴落点逻辑可走查 */
    main_window_rect: () => ({
      x: Math.max(0, (window.screen.availWidth || 1440) - 200),
      y: Math.max(0, (window.screen.availHeight || 900) - 60),
      w: 168,
      h: 32,
    }),
    save_window_position: () => undefined,
    quit_app: () => undefined,
  };

  /* [V0.2.0] 新增命令拆至 browserMockV020（单文件 <=300 行纪律） */
  /* [V0.3.4] 原 browserMockDiary 的日记四条命令已随日记域下架删除，
     余下的日状态 / 丢弃计时 / 计时窗三条拆至 browserMockDaily */
  /* [V0.3.0] 事项域 6 条拆至 browserMockItems（同上纪律，ADR-017） */
  /* [V0.3.2] 插件域 2 条拆至 browserMockPlugins */
  /* [V0.5.0] 迁移可见性 2 条拆至 browserMockMigration（命令 65 → 67） */
  return {
    ...core,
    ...createMockApiItems(s),
    ...createMockApiV020(s, findItem),
    ...createMockApiDaily(s),
    ...createMockApiPlugins(),
    ...createMockApiMigration(),
  };
}
