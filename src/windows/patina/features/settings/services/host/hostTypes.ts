/**
 * 分析窗宿主 DTO —— **转发壳**（[0.12.1 L10] 下沉到 `shared/dto/hostTypes`）
 * -----------------------------------------------------------------------------
 * 真源：`src/windows/patina/shared/dto/hostTypes.ts`。
 *
 * 为什么是转发而不是直接改 14 处 import：这些形状被 `platform/desktop/*Gateway`（传输层）
 * 与 `features/settings/**`（业务层）同时使用，而分层规则 L10 禁止 `platform` 反向 import
 * `features`。把定义放进 `shared` 之后两侧都能引，方向统一朝下；本文件只保留一条
 * `export *`，让既有 14 处相对路径与重命名零改动（减少一次大面积路径改写带来的风险）。
 *
 * 新增类型请写进 `shared/dto/hostTypes.ts`，不要写回本文件 —— 否则 platform 侧又会引到
 * features 里的定义，L10 立即变红。
 */
export * from '../../../../../shared/dto/hostTypes';
