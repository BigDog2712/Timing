# 历史工具：为 V0.12.0 融合期编写，归一后目录结构已变，不再可直接运行；保留仅为复现当时的生成方式。
"""生成合并后的 IPC 命令表（宿主 79 条 + Patina 118 条）。

为什么合并：Tauri 2 的 `invoke_handler` 只能设一次（替换语义），而 `Invoke` 不可克隆，
拼不出「两个 handler 串行」的闭包。用插件注册也不行——插件命令走 `plugin:<name>|...`
的 ACL 命名空间，`permissions/window-commands.toml` 里的应用级白名单对插件命令不生效，
结果是前端每条 IPC 都被拒（表现为「页面白屏 + 永不 ready」，且没有任何报错日志）。

所以两条命令链必须落在**同一张应用级命令表**里。行数超过单文件 300 行门禁时，
按平台切成两份文件（桌面 197 条 / 移动 79 条），各自仍在一个 `generate_handler!` 内。
"""

import io
import re

ROOT = r"D:/101-Workshop/261109-Timing/src-tauri"
HOST_TABLE = f"{ROOT}/src/ipc_commands.rs"
PATINA_BOOTSTRAP = f"{ROOT}/src/patina/app/bootstrap.rs"

host = [
    line.strip().rstrip(",")
    for line in io.open(HOST_TABLE, encoding="utf-8")
    if re.match(r"^\s+crate::commands::", line)
]
patina = [
    "crate::patina::" + line.strip().rstrip(",")
    for line in io.open(PATINA_BOOTSTRAP, encoding="utf-8")
    if re.match(r"^\s+commands::[a-z_0-9:]+,\s*$", line)
]

HEADER = """//! {title}
//!
//! **命令表只能有一份**：Tauri 的 `invoke_handler` 是替换语义，`Invoke` 又不 Clone，
//! 所以「宿主 + Patina 各一张表」串不起来（用插件注册也走不通：插件命令走
//! `plugin:<name>|...` 的 ACL 命名空间，`permissions/window-commands.toml` 里的
//! 应用级白名单对它不生效，前端每条 IPC 都会被拒且没有日志）。
//!
//! 这份文件因此是**生成物**：宿主命令来自 `src/commands/**`，Patina 命令来自
//! `src/patina/commands/**`。新增命令时两边都要补，并同步 `src/services/ipc.ts` /
//! `src/types/domain/ipc.ts` / `src/mocks/browserMockPlugins.ts` / IPC-CONTRACT-v2。
//! 改完跑 `node scripts/check-contract.mjs`。
"""


def table(name: str, commands: list[str], title: str, note: str) -> str:
    body = "\n".join(f"        {cmd}," for cmd in commands)
    return (
        HEADER.format(title=title)
        + "\nuse tauri::Wry;\n\n"
        + note
        + f"pub fn {name}() -> impl Fn(tauri::ipc::Invoke<Wry>) -> bool + Send + Sync + 'static {{\n"
        + "    tauri::generate_handler![\n"
        + body
        + "\n    ]\n}\n"
    )


desktop_note = (
    "/// 桌面命令表：宿主 {} 条 + Patina {} 条。\n"
    "/// 两边命令名已核对无重复；新增时先 `grep` 一次，重名会静默落到先注册的那份。\n"
).format(len(host), len(patina))

mobile_note = (
    "/// 移动端命令表：只有宿主那 {} 条。Patina 子系统整块 `#[cfg(desktop)]`，\n"
    "/// 它依赖 WebView2 / Win32，Android 编不进来。\n"
).format(len(host))

io.open(f"{ROOT}/src/ipc_commands.rs", "w", encoding="utf-8", newline="\n").write(
    table("invoke_handler", host + patina, "桌面 IPC 命令表（宿主 + Patina 合并）。", desktop_note)
)
io.open(f"{ROOT}/src/ipc_commands_mobile.rs", "w", encoding="utf-8", newline="\n").write(
    table("invoke_handler", host, "移动端 IPC 命令表（仅宿主）。", mobile_note)
)

print(f"桌面 {len(host)} + {len(patina)} = {len(host) + len(patina)} 条")
print(f"移动 {len(host)} 条")
