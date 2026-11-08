/**
 * Timing — 移动端原生能力的前端门面（V0.12.0；[V0.11.21] 加云端那三条）
 * -----------------------------------------------------------------------------
 * 组件不直接碰传输层（`check:layers` L1），所以把这四条命令 + 同步域的三条收在这里。
 *
 * 名字用「手机端」而不是「同步」：SAF 目录与悬浮条是同一件事——都只有原生侧能做，
 * 桌面上调它们一律回 `IO_ERROR`。前端据此区分「这端没有」与「这端有但没授权」。
 *
 * [V0.11.21] `syncView` 的返回类型从 `MdSyncView` 改成 `MdSyncViewCloud`
 * （后端一直是 `#[serde(flatten)]` 平铺，多一个 `cloud` 键），`syncSave` 加 `secret`
 * 三分语义、`syncTest` 新增。三条命令在手机端与桌面**同名注册**，没有新契约。
 */
import { ipc } from './ipc';
import type {
  MdSyncConfig,
  MdSyncReport,
  MdSyncTestResult,
  MdSyncViewCloud,
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
};
