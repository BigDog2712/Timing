/**
 * Timing — 原生文件夹选择（V0.4.0）
 * -----------------------------------------------------------------------------
 * 只在 Tauri 里调用；纯浏览器 dev 返回 null，调用方回退到手动输入路径。
 * 放 services 层是为了让组件不直接 import 插件包（与 ipc.ts 同一纪律）。
 */
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from './ipc';

export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title,
      defaultPath: defaultPath?.trim() ? defaultPath : undefined,
    });
    return typeof selected === 'string' ? selected : null;
  } catch {
    /* 用户取消 / 权限不足都按「没选」处理；调用方保留原输入值。 */
    return null;
  }
}
