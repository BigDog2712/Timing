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
import type { CreateItemParams, Item, ItemIdParams, UpdateItemParams } from '../types/domain';
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
      if (p.patch.name !== undefined) item.name = checkName(p.patch.name);
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
  };
}
