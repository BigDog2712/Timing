# 第三方组件与来源声明

Timing 0.12.0 起把 **Patina**（自动使用追踪 / 番茄 / 使用上限提醒）作为**第二入口**
并入同一个安装包：同一个进程、同一个托盘、两扇窗口（宿主悬浮条 + Patina 分析窗），
数据也分成两个库并排在同一个数据根下。下面是随之而来的许可义务与来源说明。

改动过的部分一并列在这里 —— MIT 要求保留版权声明与许可全文，也要求不暗示原作者
为本项目的改动背书。

---

## Patina（vendored，已修改）

| 项 | 值 |
| --- | --- |
| 上游 | https://github.com/Ceceliaee/patina |
| 许可 | MIT，Copyright (c) 2026 Ceceliaee |
| 落点 | `src/patina/`（前端，约 402 文件 / 5.7 万行）、`src-tauri/src/patina/`（Rust，约 285 文件 / 9.4 万行） |
| 形态 | 源码级 vendored（不是 npm 依赖、不是 git submodule），随 Timing 一起编译 |

**本项目的改动**（这些改动不是上游代码，问题不应报给上游）：

1. 窗口 label 改名 `main` → `patina`；新增多入口 `patina.html`（Vite `rollupOptions.input`），
   前端入口 `src/patina/main.tsx`。
2. 命令表并入宿主：Patina 的 117 条命令从「插件注册」改为并入 `src-tauri/src/ipc_commands.rs`
   的单张 `generate_handler!`，权限在 `src-tauri/permissions/window-commands.toml`
   + `capabilities/patina.json` 里按 label 授权（Tauri 的插件命令走独立 ACL 命名空间，
   与窗口白名单不通用）。**连带后果**：Tauri 只要存在任何 app 级 permission 就不再默认放行
   应用命令，所以宿主自己的 80 条也必须有清单 —— `src-tauri/permissions/host-commands.toml`
   + `capabilities/default.json` / `capabilities/mobile.json` 的引用。`mini` 窗口并入
   `capabilities/patina.json`（标题栏可开），提醒弹窗走 `patina-tool-notification.json`。
3. 托盘摘除：`src-tauri/src/patina/app/tray.rs` 的 `PATINA_OWN_TRAY = false`，
   托盘入口统一归宿主（宿主托盘「时间统计…」+ 设置页「通用 → 时间统计」）。
4. 更新器摘除：不注册 `tauri-plugin-updater`、启动不做更新自检、capability 不含
   `updater:default`。上游更新端点指向 Patina 自己的仓库，留着会把 Timing 更新成 Patina。
5. 数据落点：`<数据根>/patina/data/patina.db`（与 `timing.db` 并排），首启可从
   `%APPDATA%\Patina\patina.db` 导入一次（`VACUUM INTO`）。
6. 宿主侧接线：`src-tauri/src/app/patina_bridge.rs`、`src-tauri/src/ipc_commands.rs`、
   `src-tauri/src/lib.rs` 的 setup / on_window_event / run 事件串联。
7. 质量门禁适配：`eslint.config.js` 对 `src/patina/**` 关掉三条上游风格规则；
   行数/分层/契约门禁对 vendored 子树单列口径（见 `scripts/check-size.mjs` 等）。
8. **改动登记机制**：`scripts/vendored-baseline.json` 固化融合完成态（commit `7bc7bd7`）
   的逐文件哈希，`scripts/vendored-allowlist.json` 记录此后每一次对 Patina 源码的改动
   （`path` + `change` + `reason` + `owner`）。`npm run check:vendored` 让未登记的改动
   直接失败——目的是保住「能 diff 上游、按需同步」的能力，不是为了限制改动。
   上面第 1–7 条就是基线之前的那批改动，故不在登记表里重复。

### MIT 许可全文（Patina）

```
MIT License

Copyright (c) 2026 Ceceliaee

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 随融合新引入的直接依赖

| 组件 | 许可 | 用途 |
| --- | --- | --- |
| Tailwind CSS v4（`tailwindcss` / `@tailwindcss/vite`） | MIT | 只在 Patina 窗口用；`@source "./"` 限定在 `src/patina/`，不扫宿主组件 |
| `@tauri-apps/plugin-opener` + `tauri-plugin-opener` | MIT OR Apache-2.0 | Patina 打开外部链接（上游用它，宿主原本没有） |

## 其余依赖

Timing 原本的第三方依赖（React、Tauri、Rusqlite、chrono 等）许可与版本以
`package-lock.json` / `src-tauri/Cargo.lock` 为准；本项目不复制它们的源码，
按各自的许可条款以依赖形式使用。
