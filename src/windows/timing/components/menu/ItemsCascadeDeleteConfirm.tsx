/**
 * Timing — 删除有子事项的确认弹窗 ItemsCascadeDeleteConfirm（[0.14]）
 * -----------------------------------------------------------------------------
 * 后端 `delete_item` 自 [0.14] 起是**级联软删**：删父会一并移除全部直接子。
 * 有子时不能再走两步 arm（那条文案「再点一次删除」只说删除这一件，用户不知道
 * 子事项也会没了），改弹确认框把级联说清：「将同时移除其 N 个子事项」+ 子清单。
 * 无子事项时保持两步 arm 原样（不弹框 —— 为一句"删 1 件"多一次点击是倒退）。
 *
 * 计时中不硬拦（与现行口径一致：允许删除，活动会话保留原 item_id），文案提示即可。
 * 确认后走同一个 `itemApi.remove`（级联在后端事务里，前端不做第二次调用）。
 */
import { errorText } from '../../services/ipc';
import { itemApi } from '../../services/api';
import { useItemStore } from '../../stores/itemStore';
import { useUiStore } from '../../stores/uiStore';
import type { Item } from '../../types/domain';

interface ItemsCascadeDeleteConfirmProps {
  /** 要删的父事项（弹窗标题用它） */
  item: Item;
  /** 全量事项表（容器按 `parentId === item.id` 过滤出直接子） */
  items: Item[];
  onClose: () => void;
}

export function ItemsCascadeDeleteConfirm({ item, items, onClose }: ItemsCascadeDeleteConfirmProps) {
  const children = items.filter((candidate) => candidate.parentId === item.id);

  const confirm = () => {
    void (async () => {
      try {
        await itemApi.remove({ id: item.id });
        await useItemStore.getState().reload();
        onClose();
      } catch (err) {
        useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
        onClose();
      }
    })();
  };

  return (
    <>
      <div className="menu-scrim" onMouseDown={onClose} aria-hidden />
      <div className="menu cascade-delete" role="alertdialog" aria-label="删除事项确认">
        <div className="menu__group">删除「{item.name}」？</div>
        <p className="cascade-delete__hint">
          将同时移除其 {children.length} 个子事项，子事项的计时历史仍保留。
        </p>
        <ul className="cascade-delete__list">
          {children.map((child) => (
            <li key={child.id}>{child.name}</li>
          ))}
        </ul>
        <div className="cascade-delete__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--danger" onClick={confirm}>
            删除（含 {children.length} 个子事项）
          </button>
        </div>
      </div>
    </>
  );
}
