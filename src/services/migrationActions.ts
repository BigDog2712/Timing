/**
 * Timing — 数据迁移动作（设置页「通用」页签的数据入口）
 * -----------------------------------------------------------------------------
 * 分层（ARCHITECTURE R1 / check:layers L1）：组件 → **本文件** → `ipc.ts`。
 * 组件里直接 `ipc.getMigrationInfo()` 会被 L1 判红——那不是风格洁癖，而是
 * 「命令名只在一处出现」这条规则的机械落实。
 *
 * 与 `services/api.ts` 的关系：`api.ts` 按**领域**暴露业务能力（事项 / 记录 / 待办…），
 * 迁移是**一次性运维信息**，不具备领域动作语义，故单开一个小文件，避免把
 * `api.ts`（已 200+ 行）继续撑大。
 *
 * 失败一律上抛 `IpcError`（由 `ipc.ts` 的 `call()` 规范化）：调用方用
 * `errorText(err)` 决定文案，不在本层吞错。
 */
import { ipc } from './ipc';
import type { MigrationInfo } from '../types/domain';

export const migrationActions = {
  /** 读取迁移可见性信息（纯查询，幂等、无副作用） */
  load(): Promise<MigrationInfo> {
    return ipc.getMigrationInfo();
  },

  /**
   * 打开旧数据目录。
   * 注意：入参为空——目标路径由后端用「权威 app_data_dir 的父目录 + 旧 identifier」
   * 现算，**不采用** `MigrationInfo.legacyDir` 的回传值（后者是明文 JSON 里的字符串，
   * 改一行就能让它打开任意目录，见 ARCHITECTURE §7 N13）。
   */
  openLegacyDir(): Promise<void> {
    return ipc.openLegacyDir();
  },
};
