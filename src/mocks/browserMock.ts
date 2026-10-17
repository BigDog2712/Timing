/**
 * TickBar — 浏览器降级 Mock：命令处理器（非 Tauri 环境使用）
 * -----------------------------------------------------------------------------
 * 目的：在纯浏览器（`npm run dev` / 单测）下无 Tauri 运行时也能跑通全部交互，
 *       便于 UI 走查。**不参与生产**：Tauri 环境下 ipc.ts 一律走 invoke。
 * 种子数据与状态构造见同目录 mockSeed.ts。
 */
import type {
  CreateItemParams,
  Item,
  ItemIdParams,
  RecordPatch,
  StatsSummary,
  UpdateItemParams,
  UpdateRecordParams,
  UpdateSettingsParams,
  UndoStopParams,
} from '../types/domain';
import { createMockApiV020 } from './browserMockV020';
import { buildState, fail, now, seed, type MockState } from './mockSeed';

/** 命令名 -> 处理器。返回 rejected value 时抛 `{ code, message }`。 */
export function createMockApi(): Record<string, (args?: any) => unknown> {
  const s: MockState = seed();

  const findItem = (id: number) => s.items.find((i) => i.id === id && i.status === 'active');

  const core: Record<string, (args?: any) => unknown> = {
    list_items: (a) => {
      const includeArchived = Boolean(a?.includeArchived);
      return s.items
        .filter((i) => (includeArchived ? true : i.status === 'active'))
        .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
    },
    create_item: (a) => {
      const p = a as CreateItemParams;
      const name = (p?.name ?? '').trim();
      if (!name) fail('ITEM_NAME_EMPTY', '事项名称不能为空');
      if (s.items.some((i) => i.status === 'active' && i.name.trim().toLowerCase() === name.toLowerCase())) {
        fail('ITEM_NAME_DUPLICATE', '已存在同名事项');
      }
      const id = ++s.seq;
      const t = now();
      const item: Item = {
        id,
        name,
        color: p?.color ?? null,
        status: 'active',
        isSystem: false,
        sortOrder: s.items.length,
        /* [V0.2.0] */
        remindAt: null,
        remindedAt: null,
        isPinned: false,
        createdAt: t,
        updatedAt: t,
      };
      s.items.push(item);
      return item;
    },
    update_item: (a) => {
      const p = a as UpdateItemParams;
      const item = s.items.find((i) => i.id === p.id);
      if (!item) fail('ITEM_NOT_FOUND', '事项不存在');
      if (p.patch.name !== undefined) {
        const name = p.patch.name.trim();
        if (!name) fail('ITEM_NAME_EMPTY', '事项名称不能为空');
        item.name = name;
      }
      if (p.patch.color !== undefined) item.color = p.patch.color;
      if (p.patch.sortOrder !== undefined) item.sortOrder = p.patch.sortOrder;
      /* [V0.2.0] */
      if (p.patch.remindAt !== undefined) {
        item.remindAt = p.patch.remindAt;
        item.remindedAt = null;
      }
      if (p.patch.isPinned !== undefined) item.isPinned = p.patch.isPinned;
      item.updatedAt = now();
      return item;
    },
    archive_item: (a) => {
      const item = s.items.find((i) => i.id === (a as ItemIdParams).id);
      if (!item) fail('ITEM_NOT_FOUND', '事项不存在');
      if (item.isSystem) fail('ITEM_SYSTEM_PROTECTED', '系统事项不可归档');
      item.status = 'archived';
      item.updatedAt = now();
      return item;
    },
    unarchive_item: (a) => {
      const item = s.items.find((i) => i.id === (a as ItemIdParams).id);
      if (!item) fail('ITEM_NOT_FOUND', '事项不存在');
      item.status = 'active';
      item.updatedAt = now();
      return item;
    },
    delete_item: (a) => {
      const item = s.items.find((i) => i.id === (a as ItemIdParams).id);
      if (!item) fail('ITEM_NOT_FOUND', '事项不存在');
      if (item.isSystem) fail('ITEM_SYSTEM_PROTECTED', '系统事项不可删除');
      item.status = 'archived';
      item.updatedAt = now();
      return undefined;
    },
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
      s.records.unshift(rec);
      s.active = null;
      return rec;
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
      const summary: StatsSummary = { totalSec, recordCount: rows.length, byItem };
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
    resolve_open_record: (a) => {
      const action = a?.action as string;
      if (!s.active) return null;
      const rec = s.active;
      if (action === 'resume') {
        rec.runningSince = now();
        return rec;
      }
      if (action === 'close') {
        if (rec.runningSince != null) rec.accumulatedSec += Math.floor((now() - rec.runningSince) / 1000);
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
      s.settings = { ...s.settings, ...patch };
      return s.settings;
    },
    set_autostart: (a) => {
      const enabled = Boolean(a?.enabled);
      s.settings.autostartEnabled = enabled;
      return enabled;
    },
    get_autostart: () => s.settings.autostartEnabled,
    register_shortcut: () => true,
    show_window: () => undefined,
    hide_window: () => undefined,
    toggle_window: () => undefined,
    set_always_on_top: (a) => {
      s.settings.alwaysOnTop = Boolean(a?.enabled);
      return undefined;
    },
    save_window_position: () => undefined,
    quit_app: () => undefined,
  };

  /* [V0.2.0] 新增命令拆至 browserMockV020（单文件 <=300 行纪律） */
  return { ...core, ...createMockApiV020(s, findItem) };
}
