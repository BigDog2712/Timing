/**
 * TickBar 领域类型（对外唯一入口 / re-export 门面）
 * -----------------------------------------------------------------------------
 * Document ID : domain.ts
 * Status      : Frozen for Phase 3（v0.3 起仅作门面，实现在 ./domain/*）
 * Owner       : 高见远（首席架构师）
 * Upstream    : docs/phase2/IPC-CONTRACT-v2.md（DTO 与命令契约唯一依据）
 *
 * ## 为什么拆成多文件
 *
 * 原文件 552 行，是**全前端所有类型的单点**，破 AGENTS.md 的「单文件 ≤300 行」，
 * 且任何类型的改动都会和别人的改动打架（ADR-017 / T12）。现在按域切分：
 *
 * | 文件 | 内容 |
 * |---|---|
 * | `./domain/constants` | 基础数值类型（EpochMs / Seconds）与全部常量 |
 * | `./domain/models` | 枚举、实体、统计、事件载荷 |
 * | `./domain/ipc` | `IPC_EVENTS` + `IpcApi`（契约面） |
 * | `./domain-params` | 命令入参 / Patch（历史上就独立） |
 * | `./domain-v020` | V0.2.0 资源类型（Note / Todo / Theme / Reminder） |
 *
 * 对外 **import 面完全不变**：所有消费方仍写 `from '../types/domain'`。
 *
 * ## 约定
 *  - 字段名一律 camelCase，与 Rust DTO（`#[serde(rename_all = "camelCase")]`）一一对应；
 *  - 时间戳 epoch 毫秒（number）；时长秒（number，向下取整）；
 *  - 本项目无网络请求，全部数据经 Tauri IPC（`src/services/ipc.ts`）。
 */

export * from './domain/constants';
export * from './domain/models';
export * from './domain/ipc';
export * from './domain/plugin';
export * from './domain/pluginPanel';
export * from './domain/mdSync';
export * from './domain-params';
export * from './domain-v020';
