/**
 * Timing — 浏览器降级 Mock：事项域处理器
 * -----------------------------------------------------------------------------
 * 拆自 browserMock.ts（单文件 ≤300 行纪律，ADR-017）。**不参与生产**。
 * 覆盖：list / create / update / archive / unarchive / delete 共 6 条命令。
 *
 * 校验口径必须与后端一致（`services/item.rs`）：名称为空 → `ITEM_NAME_EMPTY`；
 * 超过 `ITEM_NAME_MAX_CHARS` → `ITEM_NAME_TOO_LONG`（ADR-018）；**同名放行**（ADR-021）。
 * 这里若比后端宽松，浏览器里试出来的行为就不可信。
 */
import type {
  CategoryCatalogRows,
  CreateItemParams,
  Item,
  ItemAppBindParams,
  ItemAppBinding,
  ItemAppKeyParams,
  ItemIdParams,
  UpdateItemParams,
} from '../types/domain';
import { ITEM_NAME_MAX_CHARS } from '../lib/constants';
import { fail, now, type MockState } from './mockSeed';

/** trim + 空判 + 长度校验（与后端 `normalize_name` 同口径），返回可直接入库的名字。 */
function checkName(raw: string): string {
  const name = raw.trim();
  if (!name) fail('ITEM_NAME_EMPTY', '事项名称不能为空');
  if (name.length > ITEM_NAME_MAX_CHARS) {
    fail('ITEM_NAME_TOO_LONG', `事项名称长度不能超过 ${ITEM_NAME_MAX_CHARS} 字`);
  }
  return name;
}

export function createMockApiItems(s: MockState): Record<string, (args?: any) => unknown> {
  return {
    list_items: (a) => {
      const includeArchived = Boolean(a?.includeArchived);
      return s.items
        .filter((i) => (includeArchived ? true : i.status === 'active'))
        .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
    },
    create_item: (a) => {
      const p = a as CreateItemParams;
      const name = checkName(p?.name ?? '');
      /* 2 层硬限与后端同口径：父必须是顶层事项，否则 `ITEM_DEPTH_EXCEEDED`（[0.14] 换码：
         「挂错层级」不是「时间不对」，不再借 `INVALID_DURATION`）。
         mock 比后端宽松的话，浏览器里点出来的树会在真机上建不出来。 */
      const parent = p?.parentId != null ? s.items.find((i) => i.id === p.parentId) : undefined;
      if (p?.parentId != null && (!parent || parent.depth !== 0)) {
        fail('ITEM_DEPTH_EXCEEDED', '子事项不能再挂子事项（层级上限 2 层）');
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
        parentId: p?.parentId ?? null,
        depth: p?.parentId != null ? 1 : 0,
        categoryKey: p?.categoryKey?.trim() || null,
      };
      s.items.push(item);
      return item;
    },
    update_item: (a) => {
      const p = a as UpdateItemParams;
      const item = s.items.find((i) => i.id === p.id);
      if (!item) fail('ITEM_NOT_FOUND', '事项不存在');
      if (p.patch.name !== undefined) item.name = checkName(p.patch.name);
      if (p.patch.color !== undefined) item.color = p.patch.color;
      if (p.patch.categoryKey !== undefined) item.categoryKey = p.patch.categoryKey;
      if (p.patch.parentId !== undefined) {
        if (p.patch.parentId != null) {
          const parent = s.items.find((i) => i.id === p.patch.parentId);
          if (!parent || parent.depth !== 0) {
            fail('ITEM_DEPTH_EXCEEDED', '子事项不能再挂子事项（层级上限 2 层）');
          }
          if (s.items.some((i) => i.parentId === item.id)) {
            fail('ITEM_DEPTH_EXCEEDED', '有子事项的事项不能挂到别人下面');
          }
        }
        item.parentId = p.patch.parentId;
        item.depth = p.patch.parentId == null ? 0 : 1;
      }
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

    /* ---- [0.13.x] 事项 ↔ 应用绑定 ---- */
    list_item_apps: (a) => {
      const itemId = (a as ItemIdParams).id;
      return s.itemApps.filter((b) => b.itemId === itemId).sort((x, y) => x.appKey.localeCompare(y.appKey));
    },
    list_items_for_app: (a) => {
      const appKey = String(a?.appKey ?? '').trim();
      return s.itemApps.filter((b) => b.appKey === appKey).sort((x, y) => x.itemId - y.itemId);
    },
    bind_item_app: (a) => {
      const input = (a as { input: ItemAppBindParams }).input;
      if (!s.items.some((i) => i.id === input.itemId)) fail('ITEM_NOT_FOUND', '事项不存在');
      const appKey = input.appKey.trim();
      if (!appKey) fail('ITEM_NAME_EMPTY', '应用键不能为空');
      const track = input.track ?? 1;
      if (track !== 0 && track !== 1) fail('INVALID_DURATION', 'track 只能是 0 或 1');
      const existing = s.itemApps.find((b) => b.itemId === input.itemId && b.appKey === appKey);
      if (existing) {
        existing.track = track;
        return existing;
      }
      const binding: ItemAppBinding = { itemId: input.itemId, appKey, track };
      s.itemApps.push(binding);
      return binding;
    },
    unbind_item_app: (a) => {
      const p = a as ItemAppKeyParams;
      const index = s.itemApps.findIndex((b) => b.itemId === p.itemId && b.appKey === p.appKey);
      if (index < 0) return false;
      s.itemApps.splice(index, 1);
      return true;
    },
    /* [0.13] 进程监视注册：浏览器 dev 没有进程可盯，契约存在即可，不做任何行为 */
    set_bound_process_watch: () => undefined,

    /* ---- [0.14] 分类目录（哑管道）：浏览器 dev 从 items 里现有的 categoryKey 凑一份定义，
       让「事项分类选用」在降级环境里走得出真流程；无覆盖 / 无删除 / 无应用或网页 override。 */
    list_category_catalog: (): CategoryCatalogRows => ({
      definitions: [...new Set(s.items.map((i) => i.categoryKey).filter((k): k is string => !!k))]
        .sort()
        .map((key) => ({ key: `__custom_category::custom:${encodeURIComponent(key)}`, value: '' })),
      deleted: [],
      labelOverrides: [],
      colorOverrides: [],
      appOverrides: [],
      webOverrides: [],
    }),
  };
}
