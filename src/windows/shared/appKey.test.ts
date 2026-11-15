/**
 * `normalizeAppKey` 的判据（[0.13] 「切到绑定事项的应用就自动接管计时」的底座）。
 *
 * 分两层：
 *   ① 行为用例 —— 钉住归一结果（去引号 / 去空白 / ASCII 小写 / 含 `:` 不补 `.exe` / 补 `.exe`）；
 *   ② **source test** —— 直接读 Rust 那份唯一实现，逐条比对关键分支。
 *      ②才是重点：这份 TS 是"镜像"，Rust 才是生成列的真源。两边口径漂了不会报错，
 *      只会让「我在设置里绑了 Chrome、切过去却不计时」这种零日志的失效发生。
 */
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { normalizeAppKey } from "./appKey";

describe("normalizeAppKey · 行为", () => {
  it("ak01_去首尾空白与小写_并补_exe", () => {
    expect(normalizeAppKey("  Code  ")).toBe("code.exe");
  });

  it("ak02_带引号的进程路径先去引号", () => {
    expect(normalizeAppKey('  "Code.EXE" ')).toBe("code.exe");
  });

  it("ak03_已经以_exe_结尾时不重复补", () => {
    expect(normalizeAppKey("chrome.exe")).toBe("chrome.exe");
    expect(normalizeAppKey("CHROME.EXE")).toBe("chrome.exe");
  });

  it("ak04_含冒号的完整键原样返回_不补_exe", () => {
    expect(normalizeAppKey("activity:anonymous")).toBe("activity:anonymous");
    expect(normalizeAppKey("com.example.app")).toBe("com.example.app.exe");
  });

  it("ak05_空串与纯空白与纯引号都是_null", () => {
    expect(normalizeAppKey("")).toBeNull();
    expect(normalizeAppKey("   ")).toBeNull();
    expect(normalizeAppKey('""')).toBeNull();
  });

  it("ak06_只小写ASCII_非拉丁字符原样保留", () => {
    /* `toLowerCase()` 会把西里尔大写改成小写，Rust 的 `to_ascii_lowercase` 不会 ——
       这里必须与 Rust 同款，否则同一个进程在两边算出不同的键 */
    expect(normalizeAppKey("Таймер")).toBe("Таймер.exe");
    expect(normalizeAppKey("记事本")).toBe("记事本.exe");
  });
});

describe("normalizeAppKey · 与 Rust 实现逐字一致（source test）", () => {
  const rustPath = "../../../src-tauri/src/models/activity/activity_read_model.rs";

  it("ak07_归一函数仍在_documented_位置_且分支与前端一致", () => {
    const source = readFileSync(new URL(rustPath, import.meta.url), "utf8");
    /* 函数存在性：改名字/搬家会让下面所有断言变成"扫不到"的假绿，所以先钉位置 */
    expect(source).toContain("pub fn normalize_app_key(exe_name: &str) -> Option<String> {");
    /* 五个分支逐条对照 */
    expect(source).toContain(".trim()");
    expect(source).toContain(".trim_matches('\"')");
    expect(source).toContain(".to_ascii_lowercase()");
    expect(source).toContain("if normalized.is_empty() {");
    expect(source).toContain("normalized.contains(':') || normalized.ends_with(\".exe\")");
    expect(source).toContain("format!(\"{normalized}.exe\")");
  });
});
