/**
 * Timing — 渲染异常兜底（主窗 / 分析窗 / mini 窗**共用**，第三棵子树）
 * -----------------------------------------------------------------------------
 * 为什么这层必须存在：React 19 在渲染期抛错时的行为是**卸载整棵根树**。
 * 分析窗（`patina`）一直没有错误边界，于是「计时分布卡没有数据」那类渲染异常的直接
 * 表现是：`#root` 变空 → 露出 WebView 的深色底（用户说的「全黑」），并且标题栏与
 * 导航随树一起消失（用户说的「无法返回」）。Rust 侧一行日志都不会有 —— 错误发生在
 * WebView 里，从不经过 IPC。
 *
 * 为什么下沉到 `src/windows/shared/`：药丸窗（`timing/components/ui/AppErrorBoundary.tsx`）
 * 与分析窗都要用同一份实现，而 L9 禁止两窗互相 import、L10 又禁止 `windows/shared`
 * 反向依赖任一窗。所以这里**只依赖 react**：
 *   · 文案由调用方注入（`copy`，缺省是药丸窗的中文 —— 药丸窗本来就用中文字面量）；
 *   · 「回到主界面」的回调也由调用方注入（不传就不渲染这颗键，见 `onBackHome`）。
 * 分析窗因此可以喂四语言文案（`shell/components/appBoundaryCopy.ts`），
 * 而药丸窗的 `entry/main.tsx` 一个字符都不用改。
 *
 * 边界的两条纪律：
 *   1. 兜底里必须有**能点的键**（重新加载 / 回到主界面）—— 没有出口的兜底等于换了个黑屏；
 *   2. 边界只包「可能崩的那一层」：分析窗里导航栏在边界**外面**（见 `AppViewOutlet`），
 *      单页崩了还能换页。
 *
 * 这里不做上报：前端没有日志通道，要落盘得新增 IPC 命令（改契约），留作后续决定。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

/** 兜底界面需要的三段文案（由各窗自己给，见文件头注释）。 */
export interface AppErrorBoundaryCopy {
  /** 一句话说清「这块坏了」 */
  title: string;
  /** 「重新加载」键 */
  reload: string;
  /** 「回到主界面」键（只有调用方给了 `onBackHome` 才会渲染） */
  backHome: string;
}

/**
 * 药丸窗的默认文案：它的 UI 本来就是中文字面量（`ItemsPrefsForm` 等同一口径），
 * 所以这里给中文缺省值而不是去引分析窗的四语言表（L10 禁止）。
 */
export const PILL_ERROR_BOUNDARY_COPY: AppErrorBoundaryCopy = {
  title: "界面出错了",
  reload: "重新加载",
  backHome: "回到主界面",
};

interface Props {
  children: ReactNode;
  /** 缺省 = `PILL_ERROR_BOUNDARY_COPY` */
  copy?: AppErrorBoundaryCopy;
  /** 给了才渲染「回到主界面」；分析窗用它切回 dashboard（不传则只留「重新加载」） */
  onBackHome?: () => void;
  /** 观测钩子（测试与将来的上报通道用），不影响兜底行为 */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface State {
  message: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: describeBoundaryError(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    /* release 下 stderr 不可见（`panic=abort` 的产物没有控制台），这行只是 devtools 兜底。 */
    console.error("[app] 渲染异常", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  /** 「重新加载」：整窗重来。**不清 state 后重渲染** —— 渲染期异常多半是确定性的，
   *  原地重渲染只会把同一块再崩一次，用户看到的是一次「闪一下还是坏的」。 */
  private reload = (): void => {
    window.location.reload();
  };

  /** 「回到主界面」：先清掉错误态（否则切完页兜底还在），再由调用方切视图。 */
  private goHome = (): void => {
    this.setState({ message: null });
    this.props.onBackHome?.();
  };

  override render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;
    const copy = this.props.copy ?? PILL_ERROR_BOUNDARY_COPY;
    return (
      <div className="fatal" role="alert" data-app-error-boundary>
        <div className="fatal__title">{copy.title}</div>
        <div className="fatal__detail">{message}</div>
        {this.props.onBackHome ? (
          <button type="button" className="fatal__action" onClick={this.goHome}>
            {copy.backHome}
          </button>
        ) : null}
        <button type="button" className="fatal__action" onClick={this.reload}>
          {copy.reload}
        </button>
      </div>
    );
  }
}

/**
 * 把任意抛出物压成一行可读文本。
 * 截断到 120 字符：兜底面板高度有限，一条 4 KB 的栈会把两颗键顶出可视区
 * （用户看到的就是「兜底里没有按钮」= 又一种「回不去」）。
 */
export function describeBoundaryError(raw: unknown): string {
  if (raw instanceof Error) return raw.message || raw.name;
  const text = typeof raw === "string" ? raw : String(raw);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
