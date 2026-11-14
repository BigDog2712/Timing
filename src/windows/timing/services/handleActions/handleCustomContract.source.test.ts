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
 *  3. **按键条数上限**：前端最多产出 4 修饰 + 1 主键，后端 `MAX_KEYS` 必须容得下。
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
    expect(source).toContain("pub async fn run_handle_custom_action(action: HandleCustomAction)");
    /* 判别键 `kind` + 拒绝多余字段：载荷直接决定「跑哪个程序」，含混不清时宁可拒绝执行 */
    expect(source).toContain('#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]');
    expect(source).toMatch(/Launch\s*\{\s*path:\s*String\s*\}/);
    expect(source).toMatch(/Hotkey\s*\{\s*vks:\s*Vec<u16>\s*\}/);
  });

  it('hc02_命令已登记进唯一的命令表', () => {
    const source = readRust(`${SRC}ipc_commands.rs`);
    expect(source).toContain("crate::commands::system_cmd::run_handle_custom_action");
  });

  it('hc03_槽位长度上限容得下_Windows_路径', () => {
    /* 64 是「按动作 id 定的」，会把 launch 绑定截成空（见文件头第 2 条）。
       Windows 的 MAX_PATH 是 260，这里要求至少放下一条完整路径。 */
    const source = readRust(`${SRC}models/pill_prefs.rs`);
    const match = source.match(/const ACTION_ID_MAX_LEN: usize = (\d+);/);
    expect(match, 'pill_prefs.rs 里应有 ACTION_ID_MAX_LEN').toBeTruthy();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(260);
  });

  it('hc04_后端的按键条数上限容得下前端产出的序列', () => {
    /* 前端最多 4 个修饰键 + 1 个主键；上限比它小的话，最"豪华"的组合会直接被拒 */
    const source = readRust(`${SRC}infra/hotkey_send.rs`);
    const match = source.match(/pub const MAX_KEYS: usize = (\d+);/);
    expect(match, 'hotkey_send.rs 里应有 MAX_KEYS').toBeTruthy();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(5);
  });

  it('hc05_快捷键发送前会抢回前台_否则按键会打给自己', () => {
    /* 药丸点下去会激活自己的窗口；不抢回前台时 SendInput 的目标就是 Timing 自己，
       症状是「点了没反应」，两端日志干净。 */
    const source = readRust(`${SRC}infra/hotkey_send.rs`);
    expect(source).toContain('SetForegroundWindow');
    expect(source).toContain('remember_foreign_foreground');
  });
});
