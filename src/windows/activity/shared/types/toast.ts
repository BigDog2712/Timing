export type QuietToastTone = "success" | "warning" | "error" | "info";

export interface QuietToastItem {
  id: number;
  message: string;
  tone: QuietToastTone;
}

/**
 * 分析窗的提示条出口（`AppShell` 的 `pushToast` 一路由 props 透传下来）。
 *
 * 为什么是个类型而不是一个 Context：提示栈只有一个（`AppShell` 里的 `QuietToastStack`），
 * 但它是 shell 层的东西 —— `features/**` 不能 import `shell/**`（L10），所以只能靠 props 传。
 * 定在 `shared/types` 是为了让传递链上每一层用**同一个**签名，改签名时编译期一次报全。
 */
export type ToastPush = (message: string, tone?: QuietToastTone) => void;
