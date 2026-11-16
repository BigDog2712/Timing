/**
 * 手柄自定义绑定的**两端契约**（[0.13]）
 * -----------------------------------------------------------------------------
 * 这条链横跨 TypeScript 与 Rust，而三处接缝都属于「对不上也不会报错」的类型：
 *
 *  1. **命令名 / 载荷形状**：前端发 `runHandleCustomAction({ action: {...} })`，
 *     Rust 是 `run_handle_custom_action(action: HandleCustomAction)` + `deny_unknown_fields`。
 *     摊平或改名 → 参数反序列化失败 → 用户点了只看到一条「命令不存在」。
 *  2. **槽位长度上限**：`models/pill_prefs.rs` 的 `ACTION_ID_MAX_LEN` 原先按「目录里最长
 *     14 字符」定成 64。`launch:C:\Program Files\…\x.exe` 轻松超过 → 后端**静默截成 None**
 *     → 用户选好程序、保存成功、那颗键回到「无」，库里干净得像什么都没发生。
 *  3. **按键条数上限**：前端最多产出 3 个修饰 + 1 个主键（`Win` 已下架，见 hc04），
 *     后端 `MAX_KEYS` 必须**正好**是这个数 —— 多一格就是给「一串任意按键」留的门。
 *  4. **执行前必须过授权**：`launch` 的路径只能来自后端原生对话框（R1）。两端口径分叉时
 *     的症状是「选好了、也说保存了，按下去说未授权」，或者更糟：**根本没校验**。
 *
 * 这些都用**读源码**的断言钉住（本仓称之为 source test）：改 Rust 而前端没跟上时，
 * 红的是这一条，而不是用户在真机上的一脸茫然。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

/** 路径必须**经变量**：`new URL("字面量", import.meta.url)` 会被 Vite 静态改写成 http 地址 */
function readRust(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8") as string;
}

const SRC = "../../../../../src-tauri/src/";

describe('手柄自定义动作 · 两端契约', () => {
  it('hc01_命令名与载荷结构在_Rust_侧逐字存在', () => {
    const source = readRust(`${SRC}commands/system_cmd.rs`);
    /* [R1] 签名多了 Tauri 注入的 `State<'_, AppState>`（授权名单要查库），所以不再钉整行
       字面量 —— 钉「命令名 + 载荷类型仍然叫 HandleCustomAction + 返回 AppResult<()>」，
       这三样才是两端契约，参数顺序是框架细节。 */
    expect(source).toContain("pub async fn run_handle_custom_action(");
    expect(source).toContain("action: HandleCustomAction");
    /* 判别键 `kind` + 拒绝多余字段：载荷直接决定「跑哪个程序」，含混不清时宁可拒绝执行 */
    expect(source).toContain('#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]');
    expect(source).toMatch(/Launch\s*\{\s*path:\s*String\s*\}/);
    expect(source).toMatch(/Hotkey\s*\{\s*vks:\s*Vec<u16>\s*\}/);
  });

  it('hc02_命令已登记进唯一的命令表', () => {
    const source = readRust(`${SRC}ipc_commands.rs`);
    expect(source).toContain("crate::commands::system_cmd::run_handle_custom_action");
    /* [R1] 授权入口（弹对话框 + 写名单）是单独一条命令，两者都不许漏登记 */
    expect(source).toContain("crate::commands::system_cmd::pick_custom_launch_target");
  });

  it('hc03_槽位长度上限容得下_Windows_路径', () => {
    /* 64 是「按动作 id 定的」，会把 launch 绑定截成空（见文件头第 2 条）。
       Windows 的 MAX_PATH 是 260，这里要求至少放下一条完整路径。 */
    const source = readRust(`${SRC}models/pill_prefs.rs`);
    const match = source.match(/const ACTION_ID_MAX_LEN: usize = (\d+);/);
    expect(match, 'pill_prefs.rs 里应有 ACTION_ID_MAX_LEN').toBeTruthy();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(260);
  });

  it('hc04_后端的按键上限正好是三修饰加一主键_且禁止_Win', () => {
    /* [R1] 原来断言 `>= 5`（`Ctrl+Alt+Shift+Win+F12`），等于要求后端能给宏留余量。
       现在两端一致收成 4：前端 `hotkeyToVirtualKeys` 最多产出 3 修饰 + 1 主键，
       多出来的每一格都只能装「一串任意按键」。 */
    const source = readRust(`${SRC}infra/hotkey_send.rs`);
    const match = source.match(/pub const MAX_KEYS: usize = (\d+);/);
    expect(match, 'hotkey_send.rs 里应有 MAX_KEYS').toBeTruthy();
    expect(Number(match?.[1])).toBe(4);
    /* 闸门本身：`Win+R` 是本功能唯一的完整 RCE 路径，后端**必须**自己挡一遍
       （前端那份只是提示，绕过它只需要一次直接调用）。 */
    expect(source).toContain('VK_WIN_KEYS');
    expect(source).toContain('pub fn validate(');
  });

  it('hc06_启动应用执行前必须查授权名单', () => {
    /* [R1] 这一条守的是「全仓最该先收」的那个口子：`Launch { path }` 直接 `spawn` 任意路径。
       两端分叉的两种症状都要能提前发现 —— 少了下游那道 `is_authorized`（等于没名单），
       或者错误码退回到 `IO_ERROR`（用户会去查系统权限，而真正原因是他没授权）。 */
    const source = readRust(`${SRC}commands/system_cmd.rs`);
    expect(source).toContain('services::handle_launch::is_authorized');
    expect(source).toContain('AppError::custom_action_denied');
    /* 授权名单本体：规范化 + 只认绝对路径（相对路径会跟着工作目录漂） */
    const gate = readRust(`${SRC}services/handle_launch.rs`);
    expect(gate).toContain('canonicalize');
    expect(gate).toContain('is_absolute');
  });

  it('hc07_设置页的选路径走宿主对话框而不是前端自己弹', () => {
    /* [R1] 这条是 hc06 的另一半。后端有名单、但如果设置页还在用
       `@tauri-apps/plugin-dialog` 自己选路径，用户会得到「选成功、保存成功、按下去说
       未授权」——因为那个字符串从来没经过后端，名单里没有它。
       判据同时钉住两头：不许再用前端对话框，必须调宿主的那条授权入口。 */
    const source = readRust('../../../activity/features/settings/components/SettingsHandleCard.tsx');
    /* 只查 import 语句（注释里会提到这个包名，因为要解释「为什么不用它」） */
    expect(source).not.toContain('from "@tauri-apps/plugin-dialog"');
    expect(source).not.toContain("from '@tauri-apps/plugin-dialog'");
    expect(source).toContain('pickCustomLaunchTarget');
  });

  it('hc05_快捷键发送前会抢回前台_否则按键会打给自己', () => {
    /* 药丸点下去会激活自己的窗口；不抢回前台时 SendInput 的目标就是 Timing 自己，
       症状是「点了没反应」，两端日志干净。 */
    const source = readRust(`${SRC}infra/hotkey_send.rs`);
    expect(source).toContain('SetForegroundWindow');
    expect(source).toContain('remember_foreign_foreground');
  });
});
