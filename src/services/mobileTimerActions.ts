/**
 * TickBar — 移动端计时动作（桌面 hooks 未覆盖的几条）
 * -----------------------------------------------------------------------------
 * 为什么单独一层而不是塞进 `useTimerActions`：
 *   - `useTimerActions` 是桌面药丸/事项窗共用的入口，它的每个动作都带着桌面的
 *     右键/键盘语义；把「带 mode 的换事项」和「待办直接开计」加进去，
 *     桌面侧就会多出两个零调用点的方法（AGENTS.md 的「不留死代码」）。
 *   - 这里只做「多步时序编排 + 失败提示」，数据仍全部经 `services/api.ts` 门面。
 *
 * 返回值口径：`switchTo` / `startTodo` / `createAndSwitch` 都返回**成功与否**。
 * 调用方拿它决定「待办删不删」这类后继动作——提示由本层统一弹，调用方不必再判断错误类型。
 */
import type { SwitchMode } from '../types/domain';
import { errorText, itemApi, timerApi, todoApi } from './api';
import { useItemStore } from '../stores/itemStore';
import { useTimerStore } from '../stores/timerStore';
import { useTodoStore } from '../stores/todoStore';
import { useUiStore } from '../stores/uiStore';

function notify(err: unknown): void {
  useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
}

/** 一条待办的最小身份（手机端调用方手上只有 store 里的那一行） */
export interface TodoStartTarget {
  id: number;
  title: string;
}

/**
 * 「这条待办已经在计时了」之后的收尾：软删待办 + 重拉待办区。
 * 不重拉的话那一行会留在屏幕上骗人（PRD P0-6 的验收点）。
 */
async function removeTodo(todoId: number): Promise<boolean> {
  try {
    await todoApi.remove(todoId);
    await useTodoStore
      .getState()
      .reload()
      .catch(() => undefined);
    return true;
  } catch (err) {
    notify(err);
    return false;
  }
}

export const mobileTimerActions = {
  /**
   * 点一行就开始计这一条。
   * 空闲 → `start_timer`；计时中 → 按 mode 切换：
   *   - `end_and_start`（结束并新开）：后端 `timer::switch` 只接受**非运行中**会话，
   *     所以运行中必须先暂停冻结累计，换完再继续——用户看到的是「时长不断、事项变了」；
   *   - `just_switch`（仅改归属）：后端允许运行中直接改，不动秒表。
   */
  async switchTo(itemId: number, mode: SwitchMode): Promise<boolean> {
    const status = useTimerStore.getState().state.status;
    try {
      if (status === 'idle') {
        await timerApi.start(itemId);
      } else {
        const wasRunning = status === 'running';
        const needPause = wasRunning && mode === 'end_and_start';
        if (needPause) await timerApi.pause();
        const next = await timerApi.switchItem(itemId, mode);
        /* 换完再「继续」：新段是否在跑由后端决定（end_and_start 会新开一条 running）。
           只在后端确实留下暂停态时补 resume，避免撞 TIMER_ALREADY_RUNNING。 */
        if (wasRunning && next.status === 'paused') await timerApi.resume();
      }
      await useTimerStore.getState().refresh();
      return true;
    } catch (err) {
      notify(err);
      await useTimerStore.getState().refresh().catch(() => undefined);
      return false;
    }
  },

  /**
   * 待办 → 计时（手机上「点这一条就开始计这一条」的唯一入口）。
   *
   * 空闲态：整条链路交给后端 `todo_start` —— 它按标题匹配事项（同名复用、无则新建）
   * 并**当场软删待办**。前端不该把这套逻辑写第二遍，否则两份匹配规则迟早不一致。
   *
   * 计时中：后端 `todo_start` 的第一道守卫就是 `TIMER_ALREADY_RUNNING`（这正是用户
   * 「点开始没反应」的根源），所以改走「先换事项、**成功了**才软删待办」：
   * 顺序反了就会出现「待办没了、时间也没记到这条上」。失败时待办原样留着。
   */
  async startTodo(target: TodoStartTarget, mode: SwitchMode = 'end_and_start'): Promise<boolean> {
    if (useTimerStore.getState().state.status === 'idle') {
      try {
        await todoApi.start(target.id);
        /* 后端可能刚为这条待办建了同名事项：选择器与汇总条要立刻能用到它 */
        await useItemStore
          .getState()
          .reload()
          .catch(() => undefined);
        await useTodoStore
          .getState()
          .reload()
          .catch(() => undefined);
        await useTimerStore.getState().refresh();
        return true;
      } catch (err) {
        notify(err);
        await useTimerStore.getState().refresh().catch(() => undefined);
        return false;
      }
    }

    /* 与后端 `item::find_by_name`（repositories/item.rs:22-33）**三条口径全对齐**：
         ① `name = ? COLLATE BINARY` → JS `===`（同码点相等，不做大小写/空白归一）
         ② `deleted_at IS NULL`      → 只排除软删，**归档也算命中**，所以必须带 includeArchived
         ③ `ORDER BY id ASC LIMIT 1` → 同名多条取**最小 id**，不是 store 的展示顺序
       为什么不复用 `useItemStore.items`：那是「给选择器看的列表」（不含归档、按
       is_pinned/sort_order 排），拿它匹配会让 idle 路径（走后端）与非 idle 路径
       （走这里）选出不同的事项，正好破坏 todo_start.rs 写明的「避免同名两个事项」。
       这份带归档的列表**只用于本次匹配、不写回 store**：归档事项不该出现在选择器里。 */
    /* 读不到事项列表就不能安全匹配：宁可报错也不新建一条可能重名的（P2-3 孤儿） */
    const all = await itemApi.list({ includeArchived: true }).catch((err: unknown) => {
      notify(err);
      return null;
    });
    if (all == null) return false;
    const currentItemId = useTimerStore.getState().state.session?.itemId ?? null;
    const same =
      all.filter((item) => item.name === target.title).sort((a, b) => a.id - b.id)[0] ?? null;

    /* 这条待办对应的事项**正是**当前计时事项：切给自己毫无意义（后端也会拒），
       用户点它的意思只能是「这件事我已经在计了」→ 只把待办收走，不动秒表。 */
    if (same != null && same.id === currentItemId) return removeTodo(target.id);

    const switched =
      same != null
        ? await mobileTimerActions.switchTo(same.id, mode)
        : await mobileTimerActions.createAndSwitch(target.title, mode);
    if (!switched) return false;
    return removeTodo(target.id);
  },

  /** 新建事项并立刻切（或开始）过去：一步「新事项 + 开计」是手机上的高频路径 */
  async createAndSwitch(name: string, mode: SwitchMode): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      useUiStore.getState().setNotice({ text: '事项名称不能为空', tone: 'danger' });
      return false;
    }
    try {
      const item = await itemApi.create({ name: trimmed });
      await useItemStore.getState().reload();
      /* 事项已建好但切换可能失败：返回值就是「切过去了没有」，交给调用方决定删不删待办 */
      return await mobileTimerActions.switchTo(item.id, mode);
    } catch (err) {
      notify(err);
      return false;
    }
  },
};
