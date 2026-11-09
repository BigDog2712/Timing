//! 覆盖率检查点（仅专用 coverage 编译器 wrapper 打开 `patina_coverage` feature）。
//!
//! 上游 Patina 把它写在它自己的 crate root；本 crate 的 root 是 Timing 的 `lib.rs`
//! （「仅装配，无业务」），归一后落在 `platform` 叶子层——与 `platform/log.rs` 并列：
//! 同属构建 / 诊断钩子，且不 import 任何 crate 内模块，不引入依赖方向。
//!
//! 与 `Cargo.toml` 的 `patina_coverage = []` 配对：不声明该 feature 会得到
//! `unexpected cfg` 警告，本项目 clippy 是 `-D warnings`，所以 feature 只声明不启用。

#[cfg(feature = "patina_coverage")]
pub(crate) fn flush_coverage() {
    unsafe extern "C" {
        fn __llvm_profile_write_file() -> i32;
    }
    if unsafe { __llvm_profile_write_file() } != 0 {
        // L6：全域禁 `eprintln!`（Release 的 GUI 进程里无处可见）。归一后必须走宿主日志。
        crate::log_error!("native coverage checkpoint failed");
    }
}
