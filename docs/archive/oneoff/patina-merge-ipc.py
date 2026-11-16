# 历史工具：为 V0.12.0 融合期编写，归一后目录结构已变，不再可直接运行；保留仅为复现当时的生成方式。
"""把 Patina 的 118 条命令并进宿主的应用级命令表。

为什么要并：Tauri 2 的 `invoke_handler` 是**替换语义**（Builder 上只有一个槽，
后设的覆盖先设的），而 `tauri::ipc::Invoke` 既不 `Copy` 也不 `Clone`，
拼不出「先试 A 再试 B」的闭包（E0382）。

那用插件注册呢？也不行。插件命令走 `plugin:<name>|...` 的独立 ACL 命名空间，
`capabilities/*.json` 里挂的应用级权限集（`main-window-commands`）对插件命令**完全不生效**。
后果是前端每条 IPC 都被 ACL 拒绝、React 在启动阶段就崩，而窗口侧只看到
「页面加载完了但永不 ready」——既没有 Rust panic，也没有 console 报错，极难定位。

所以两条链必须落在同一张应用级命令表里，且仍受 `permissions/window-commands.toml` 管辖。

行数账：79 + 118 = 197 条，加上注释约 250 行，仍在单文件 300 行门禁内。
Patina 整块 `#[cfg(desktop)]`（它依赖 WebView2 / Win32，Android 编不进来），
用 `macro_rules!` 把宿主那一长串只写一遍，避免桌面/移动两份清单彼此漂移。
"""

import io
import re

ROOT = r"D:/101-Workshop/261109-Timing/src-tauri"
TABLE = f"{ROOT}/src/ipc_commands.rs"
BOOTSTRAP = f"{ROOT}/src/patina/app/bootstrap.rs"

src = io.open(TABLE, encoding="utf-8").read()

m = re.search(r"tauri::generate_handler!\[\n(.*?)\n    \]", src, re.S)
assert m, "找不到宿主 generate_handler 块"
host_body = "\n".join(
    ("            " + ln.strip()) if ln.strip() else ""
    for ln in m.group(1).splitlines()
)

boot = io.open(BOOTSTRAP, encoding="utf-8").read()
m2 = re.search(
    r"pub fn invoke_handlers\(\).*?tauri::generate_handler!\[\n(.*?)\n    \]", boot, re.S
)
assert m2, "找不到 Patina generate_handler 块"
patina = [
    "crate::patina::" + line.strip().rstrip(",")
    for line in m2.group(1).splitlines()
    if re.match(r"^\s+commands::[a-z_0-9:]+,\s*$", line)
]
assert len(patina) == 118, f"Patina 命令应为 118 条，实际 {len(patina)}"

host = [ln for ln in host_body.splitlines() if re.match(r"^\s+crate::commands::", ln)]
assert len(host) == 79, f"宿主命令应为 79 条，实际 {len(host)}"

head = '''//! 应用级 IPC 命令表：宿主 79 条 + Patina 118 条（后者仅桌面）。
//!
//! **为什么只有一张表**：Tauri 的 `invoke_handler` 是替换语义，`Invoke` 又不 `Clone`，
//! 「宿主表 + Patina 表串成闭包」编不过（E0382）；改用插件注册更糟——插件命令走
//! `plugin:<name>|...` 的 ACL 命名空间，`permissions/window-commands.toml` 里的应用级
//! 白名单对它不生效，前端每条 IPC 都被拒且**没有任何日志**，表现为「页面加载完、
//! 窗口永不 ready」。
//!
//! 所以两边必须共用这一张表。Patina 整块 `#[cfg(desktop)]`（依赖 WebView2 / Win32），
//! 用 `macro_rules!` 让宿主那一长串只写一遍，避免桌面/移动两份清单彼此漂移。
//!
//! 改这里任何一行，都要同步 `src/services/ipc.ts` / `src/types/domain/ipc.ts` /
//! `src/mocks/browserMockPlugins.ts` 与 `docs/phase2/IPC-CONTRACT-v2.md`（四面契约）。

use tauri::Wry;

/// 命令表模板。`$extra` 是平台专属命令（目前只有 Patina），拼在宿主命令之前——
/// 两边命令名已核对互不重复，先后顺序不影响结果。
macro_rules! define_invoke_handler {
    ($($extra:path,)*) => {
        pub fn invoke_handler() -> impl Fn(tauri::ipc::Invoke<Wry>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![
                $($extra,)*
'''

tail = '''            ]
        }
    };
}

#[cfg(desktop)]
define_invoke_handler![
'''

block = "".join(f"    {cmd},\n" for cmd in patina)

out = head + host_body + "\n" + tail + block + "];\n\n#[cfg(not(desktop))]\ndefine_invoke_handler![];\n"

io.open(TABLE, "w", encoding="utf-8", newline="\n").write(out)
print(f"写回：宿主 {len(host)} + Patina {len(patina)} = {len(host) + len(patina)} 条")
print(f"行数：{len(out.splitlines())}")
