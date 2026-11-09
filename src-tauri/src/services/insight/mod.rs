//! 分析窗的服务层：`data`（持久化）与 `engine`（调度 / 运行时）。
//! 二者互相依赖（`data → engine` 16 次、`engine → data` 32 次），因此同放一层，
//! 不拆进 `repositories/` 与 `jobs/`（那会造出跨层环，见
//! `docs/refactor/patina-structural-merge.md` §1.2）。

pub mod data;
pub mod engine;
