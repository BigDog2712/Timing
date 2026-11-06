/**
 * Timing — 移动端原生能力的前端门面（V0.12.0）
 * -----------------------------------------------------------------------------
 * 组件不直接碰传输层（`check:layers` L1），所以把这四条命令 + 同步域的三条收在这里。
 *
 * 名字用「手机端」而不是「同步」：SAF 目录与悬浮条是同一件事——都只有原生侧能做，
 * 桌面上调它们一律回 `IO_ERROR`。前端据此区分「这端没有」与「这端有但没授权」。
 */
import { ipc } from './ipc';
import type {
  MdSyncConfig,
  MdSyncReport,
  MdSyncView,
  OverlayStatus,
  OverlayStyle,
  SafStatus,
} from '../types/domain';

export const mobileNative = {
  safStatus: (): Promise<SafStatus> => ipc.mdSafStatus(),
  safPick: (): Promise<SafStatus> => ipc.mdSafPick(),
  overlayStatus: (): Promise<OverlayStatus> => ipc.overlayStatus(),
  setOverlay: (enabled: boolean, style?: OverlayStyle): Promise<OverlayStatus> =>
    ipc.overlaySet({ enabled, style }),
  syncView: (): Promise<MdSyncView> => ipc.mdSyncGet(),
  syncSave: (config: MdSyncConfig): Promise<MdSyncView> => ipc.mdSyncSave({ config }),
  syncRun: (): Promise<MdSyncReport> => ipc.mdSyncRun(),
};
