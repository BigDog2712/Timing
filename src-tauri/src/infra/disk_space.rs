//! 磁盘剩余空间（V0.11.15，设计 §3.7）：零新依赖。
//!
//! `windows-sys 0.61` 本来就在依赖里（`secret_dpapi` 在用），这里只多开一个
//! `Win32_Storage_FileSystem` feature → **不新增编译单元**、`Cargo.lock` 不变。
//!
//! ## `None` 的含义是「这条预检在本平台不生效」，不是「0 字节」
//!
//! 桌面发布只有 Windows；mac / Linux 是开发构建。返回 `None` 时上层**不显示**那一行
//! 说明——少一项说明比显示一个假数字好（设计 §3.7 末句）。

use std::path::Path;

/// 目标路径所在卷的可用字节数。路径不存在时返回 `None`（调用方应先用已存在的祖先目录）。
#[cfg(windows)]
pub fn free_bytes(path: &Path) -> Option<u64> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut available: u64 = 0;
    /* 后两个参数传空：我们只要「当前用户还能用多少」，与卷总容量无关。
    空指针是 API 明确允许的（`lpTotalNumberOfBytes` / `lpTotalNumberOfFreeBytes` 可省）。 */
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(available)
}

/// 非 Windows：这条预检不生效（见模块头）。
#[cfg(not(windows))]
pub fn free_bytes(_path: &Path) -> Option<u64> {
    None
}
