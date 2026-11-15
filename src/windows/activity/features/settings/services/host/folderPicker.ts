/**
 * 分析窗侧的原生文件夹选择（[0.12.1] T04b）
 * -----------------------------------------------------------------------------
 * 宿主那份在 `services/folderPicker.ts`（import `services/ipc` 的 `isTauri`），分析窗读不到。
 * 这里用 `@tauri-apps/plugin-dialog` 的 `open` 直接实现，行为一致：
 *  **用户取消 / 权限不足一律返回 null**，调用方保留原输入值，不把它当错误。
 *
 * 权限：需要在 `capabilities/patina.json` 里授予 `dialog:allow-open`（与宿主 `default.json`
 * 同一条），否则取消以外的任何点击都会被 ACL 静默拒掉。
 */
import { open } from "@tauri-apps/plugin-dialog";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 选一个目录；不可用或取消时返回 `null`。 */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title,
      defaultPath: defaultPath?.trim() ? defaultPath : undefined,
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    /* 用户取消 / 权限不足都按「没选」处理；调用方保留原输入值。 */
    return null;
  }
}
