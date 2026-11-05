/**
 * TickBar — Android 返回键接管（先关 Sheet / 恢复面板，再退 Tab，再退后台）
 * -----------------------------------------------------------------------------
 * Android 的返回键在 WebView 里表现为 **history.back()**：没有历史条目就直接退出 Activity。
 * Tauri 2 没有为「返回键」提供 JS 事件，所以这里用一条**临时历史条目**把返回键接管下来：
 *
 *   覆盖层打开 → pushState（多一条历史）→ 用户按返回 → popstate → 执行 onBack
 *   覆盖层由界面关闭 → cleanup 里再 back() 把那条临时条目退掉，避免连按返回时空转一次
 *
 * 这也是「返回键不杀进程」的实现：条目永远比 Activity 多一条，第一次返回只关 UI。
 *
 * `onBack` 可替换：崩溃恢复面板是**不可关闭**的模态，它传入的回调是「再压一条历史」
 * ——按返回既不会丢弃用户还没做的决定，也不会退出应用。
 */
import { useEffect } from 'react';
import { useMobileUiStore } from '../stores/mobileUiStore';

const defaultBack = (): void => {
  useMobileUiStore.getState().closeSheet();
};

export function useMobileBackSheet(open: boolean, onBack: () => void = defaultBack): void {
  useEffect(() => {
    if (!open) return;
    let consumedByPop = false;
    window.history.pushState({ timingOverlay: true }, '');
    const onPop = () => {
      consumedByPop = true;
      onBack();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      /* 由界面关闭（点遮罩 / 完成按钮）时，历史里那条临时条目要一起退掉；
         已经由返回键消费掉的话再 back() 就会把用户弹出应用。 */
      if (!consumedByPop) window.history.back();
    };
  }, [open, onBack]);
}
