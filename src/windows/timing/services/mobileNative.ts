/**
 * Timing — 移动端原生能力的前端门面（V0.12.0；[V0.11.22] 加备份两条、删 SAF 两条）
 * -----------------------------------------------------------------------------
 * 组件不直接碰传输层（`check:layers` L1），所以把这批命令收在这里。
 *
 * 名字用「手机端」而不是「同步」：悬浮条只有原生侧能做，桌面上调它一律回 `IO_ERROR`。
 * 前端据此区分「这端没有」与「这端有但没授权」。
 *
 * ## 两个删除点（[V0.11.22]）
 *
 * - `safStatus` / `safPick`：本地日记目录那条同步通路这一轮下线，界面已无入口。
 *   **命令仍在契约面上**（`ipc.mdSafStatus` / `mdSafPick`，78 条之一），
 *   只是不再有前端调用者——留一条没人调的门面方法比留一个没人的界面更容易误用。
 * - `secret` 三分语义保持不变：`undefined` = 不动已存密文，`''` = 清空，原串 = 写入。
 */
import { ipc } from './ipc';
import type {
  MdBackupExport,
  MdBackupItem,
  MdBackupRestoreResult,
  MdSyncConfig,
  MdSyncReport,
  MdSyncTestResult,
  MdSyncViewCloud,
  OverlayStatus,
  OverlayStyle,
} from '../types/domain';

export const mobileNative = {
  overlayStatus: (): Promise<OverlayStatus> => ipc.overlayStatus(),
  setOverlay: (enabled: boolean, style?: OverlayStyle): Promise<OverlayStatus> =>
    ipc.overlaySet({ enabled, style }),
  syncView: (): Promise<MdSyncViewCloud> => ipc.mdSyncGet(),
  /**
   * `secret` 三分语义由后端解释：`''` = 清空密码，`'...'` = 写入，`undefined` = 不动。
   * 前端**原样转发**，绝不自己拼一个空串——那会把用户已存的密码清掉。
   */
  syncSave: (config: MdSyncConfig, secret?: string | null): Promise<MdSyncViewCloud> =>
    ipc.mdSyncSave({ config, secret }),
  syncTest: (config: MdSyncConfig, secret?: string | null): Promise<MdSyncTestResult> =>
    ipc.mdSyncTest({ config, secret }),
  syncRun: (): Promise<MdSyncReport> => ipc.mdSyncRun(),
  /** 备份列表：与桌面同一份 `backups/md`（按留底时间倒序）。 */
  backupList: (): Promise<MdBackupItem[]> => ipc.mdBackupList(),
  /**
   * 恢复一份备份（覆盖写）。`target` 传 `null`：归属由备份文件名解析，
   * 手机端只放行 `webdav__`（判据在后端 `services::md_backup::restorable_on_mobile`）。
   */
  backupRestore: (name: string): Promise<MdBackupRestoreResult> =>
    ipc.mdBackupRestore({ name, target: null }),
  /**
   * 导出一份备份到用户挑的位置（[V0.11.23]）。手机专属：桌面上这条命令回
   * `IO_ERROR`「仅手机端可用」。**用户取消 → `saved: false`，不是错误**。
   */
  backupExport: (name: string): Promise<MdBackupExport> => ipc.mdBackupExport({ name }),
};
