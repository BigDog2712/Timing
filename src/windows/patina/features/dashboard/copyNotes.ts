import type { Locale } from "../../shared/i18n/index.ts";

/**
 * 便利贴卡**新增的两颗删除文案**（四语言齐备）。
 *
 * 为什么不放 `copy.ts`：那个文件贴着单文件 300 行上限（`scripts/check-size.mjs` 逐文件棘轮），
 * 三行新文案就会把它顶出去。照 `copyAppBinding.ts` 的先例拆出来，再在 `copy.ts` 里用
 * 交叉类型 `DashboardCopy = DashboardCoreCopy & AppBindingCopy & NoteCopy` 拼回去 ——
 * 使用侧拿到的仍是**一张表**，调用点不用知道它拆过。
 *
 * 也**不**进 `src/shared/i18n/**`：那四个 locale 文件是按索引对齐的位置数组，
 * 手插一行会让其后全部文案错位（`generated/contract.ts` 还被 size 门禁冻着）。
 *
 * 只有"删除"与"确认删除"两句话没有现成键：`UI_TEXT.dialog.cancel`（取消）与
 * `UI_TEXT.dialog.confirmDanger`（危险动作的继续键）是通用的，直接复用，不在这里重写一遍。
 */
export interface NoteCopy {
  /** 弹层里的删除键（打开内联确认条的那一颗） */
  noteDelete: string;
  /** 内联确认条的一句话：说清"删的是哪一类东西"，不是干巴巴的"确定？" */
  noteDeleteConfirm: string;
  /** 删除**意图没发出去**（`emitHostIntent` 解析成 false）时的提示。
   *  不复用 `UI_TEXT.common.refreshFailed`：那句是"刷新失败"，而这里失败的是**一次删除动作**，
   *  用户正在等这一下，说成"刷新失败"会让人以为是列表没拉到。 */
  noteDeleteNotSent: string;
}

export const NOTE_COPY: Record<Locale, NoteCopy> = {
  "zh-CN": {
    noteDelete: "删除",
    noteDeleteConfirm: "删除这张便利贴？",
    noteDeleteNotSent: "删除没有发出去，便利贴还在，请再试一次。",
  },
  "en-US": {
    noteDelete: "Delete",
    noteDeleteConfirm: "Delete this note?",
    noteDeleteNotSent: "The delete request was not sent. The note is still here — please try again.",
  },
  "ru-RU": {
    noteDelete: "Удалить",
    noteDeleteConfirm: "Удалить эту заметку?",
    noteDeleteNotSent: "Запрос на удаление не отправлен. Заметка на месте — попробуйте ещё раз.",
  },
  es: {
    noteDelete: "Eliminar",
    noteDeleteConfirm: "¿Eliminar esta nota?",
    noteDeleteNotSent: "No se envió la solicitud de eliminación. La nota sigue aquí; inténtalo de nuevo.",
  },
};
