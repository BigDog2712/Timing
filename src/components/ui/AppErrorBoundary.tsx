/**
 * Timing — 渲染异常兜底（V0.4.1）
 * -----------------------------------------------------------------------------
 * 为什么必须有：主窗是一个 384×360 的**全透明**窗口，小条是它唯一的可见内容
 * （ADR-020 无画布）。React 在渲染期抛错时，React 18+ 的行为是卸载整棵树——
 * 用户看到的是「药丸凭空消失」，而 Rust 侧日志一行都不会有（错误发生在 WebView
 * 里，从不经过 IPC）。这类故障目前只能靠用户口述「它不见了」来复现。
 *
 * 两层防线：
 *   1. `AppErrorBoundary`：拦渲染期异常，**留住一个能点的界面**（可重新加载），
 *      而不是把窗口变成一块看不见的透明区域；
 *   2. `installGlobalErrorHooks`：拦渲染之外的异常（事件回调里的 async 抛错、
 *      Promise 未处理拒绝），走既有的 NoticeBar 提示，不静默吞掉。
 *
 * 边界：这里只做「保住界面 + 让错误可见」，**不做上报**。前端没有日志通道，
 * 要落盘得新增一条 IPC 命令（改契约），留作后续版本的决定。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useUiStore } from '../../stores/uiStore';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: describe(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 开发者能在 devtools 看到完整栈；release 下 stderr 不可见，这行只是兜底记录。
    console.error('[timing] 渲染异常', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <div className="fatal__title">界面出错了</div>
        <div className="fatal__detail">{this.state.message}</div>
        <button
          type="button"
          className="fatal__action"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>
    );
  }
}

/** 安装全局异常钩子（`main.tsx` 调用一次）。 */
export function installGlobalErrorHooks(): void {
  window.addEventListener('error', (event) => {
    report(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    report(event.reason);
  });
}

/** 渲染之外的异常：提示条可见 + devtools 可见，不阻断交互。 */
function report(raw: unknown): void {
  const message = describe(raw);
  console.error('[timing] 未捕获异常', raw);
  useUiStore.getState().setNotice({ text: `界面异常：${message}`, tone: 'danger' });
}

/** 把任意抛出物压成一行可读文本（超长截断，避免提示条被撑开）。 */
function describe(raw: unknown): string {
  if (raw instanceof Error) return raw.message || raw.name;
  const text = typeof raw === 'string' ? raw : String(raw);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
