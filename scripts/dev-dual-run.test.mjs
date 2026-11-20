/**
 * 调试版与安装版「双开」的判据（开发工具链哨兵）
 * -----------------------------------------------------------------------------
 * 安装版常驻时再起 `tauri dev`，默认会被单实例插件顶掉：插件按 `identifier` 建
 * 互斥量（Windows）并向前台实例转发参数，后起的进程**静默退出**，没有报错 ——
 * 看到的只是"dev 起不来"。窗口几何文件、WebView2 profile、install_id 也都按
 * 同一个 identifier 落盘，两个进程会互相覆盖。
 *
 * 所以 `dev-desktop.cmd` 必须把 `tauri.dev.conf.json` 合并进 dev 构建，而那份
 * 配置的 identifier 必须和出包用的 `tauri.conf.json` **不同**。这里钉住这两件事。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("dev 与安装版双开", () => {
  it("dev 配置的 identifier 与出包 identifier 不同", () => {
    const release = JSON.parse(read("src-tauri/tauri.conf.json"));
    const dev = JSON.parse(read("src-tauri/tauri.dev.conf.json"));
    assert.ok(dev.identifier, "tauri.dev.conf.json 缺 identifier");
    assert.notEqual(
      dev.identifier,
      release.identifier,
      "dev 与出包共用 identifier：单实例插件会把后起的 dev 进程静默顶掉，窗口几何 / WebView2 profile 也会互相覆盖",
    );
  });

  it("dev-desktop.cmd 把 dev 配置传给 tauri dev", () => {
    const cmd = read("scripts/dev-desktop.cmd");
    assert.match(cmd, /run tauri dev -- --config "src-tauri\\tauri\.dev\.conf\.json"/);
  });
});