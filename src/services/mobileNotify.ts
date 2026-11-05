/**
 * Timing — 移动端通知权限（POST_NOTIFICATIONS）
 * -----------------------------------------------------------------------------
 * 为什么前端要管这件事：倒计时 / 提醒的**发送**仍在 Rust（`infra/notify.rs`），
 * 但 Android 13+ 的运行时授权只能由前端在用户动作里发起（系统弹窗必须绑定一次点击）。
 * 所以口径是：
 *   1. 用户第一次点「开始倒计时」时申请权限（有上下文，不会被当成骚扰）；
 *   2. 授予 → 一切照旧，到点由系统通知兜底；
 *   3. 拒绝 → **不静默失败**：整壳常驻一条降级说明，到点改走应用内提示条
 *      （`useAppBootstrap` 已经订阅 `countdown-finished` 并弹 notice，这条通路不依赖通知权限）。
 *
 * 非 Tauri / 桌面：直接返回 granted，不触发任何插件调用（桌面授权归 Rust 管）。
 */
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { IS_MOBILE } from '../lib/platform';
import { isTauri } from './ipc';
import { useMobileUiStore } from '../stores/mobileUiStore';

export type NotifyPermission = 'granted' | 'denied' | 'unsupported';

/** 同一次会话内只问一次：系统弹窗被拒后再次 requestPermission 多数平台不再弹 */
let cached: NotifyPermission | null = null;

export function cachedNotifyPermission(): NotifyPermission | null {
  return cached;
}

/**
 * 申请（或复用）通知权限。调用点必须在用户点击里（系统要求有手势上下文）。
 * 返回 `denied` 时同时点亮整壳的降级说明。
 *
 * @param force [V0.11.2] 无视缓存，先向系统查现状。设置页「申请」按钮必须传 true：
 *   用户被拒后去系统设置里手动放开，回到应用还得能认回来；自动申请路径（点开始倒计时）
 *   仍走缓存，避免反复弹窗。
 */
export async function ensureNotifyPermission(force = false): Promise<NotifyPermission> {
  if (!IS_MOBILE) return 'granted';
  if (cached && !force) return cached;
  if (!isTauri()) {
    cached = 'unsupported';
    return cached;
  }
  try {
    if (await isPermissionGranted()) {
      cached = 'granted';
      useMobileUiStore.getState().setNotifyIssue(null);
      return cached;
    }
    const result = await requestPermission();
    cached = result === 'granted' ? 'granted' : 'denied';
  } catch {
    /* 插件缺失 / capability 未放行：当作不可用，降级为应用内提示，不抛给调用方 */
    cached = 'unsupported';
  }
  useMobileUiStore.getState().setNotifyIssue(cached === 'granted' ? null : cached);
  return cached;
}

/** 给设置页「通知权限」行用的一句话状态 */
export function notifyPermissionText(): string {
  if (cached == null) return '尚未申请';
  if (cached === 'granted') return '已允许';
  if (cached === 'denied') return '已拒绝，到点只在应用内提示';
  return '当前环境不支持系统通知';
}
