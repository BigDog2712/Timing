/**
 * [0.13 fix] 「存量绑定补镜像」的**接线**判据（P0：不重绑、不开界面也要生效）。
 *
 * ## 为什么这条必须存在
 *
 * 报障人（「我启动了燕云，但没开始计时」）的绑定是**修之前**建的，只存在于分析窗的配置表
 * 里；他这次是直接开游戏，既没开应用卡、也没开事项编辑面板。修完之后如果只靠"打开界面时
 * 补一次"，对他等于没修。所以补镜像必须挂在**启动期**（`app/bootstrap.rs` 调
 * `services::item_app_mirror::mirror_on_boot`），而这条接线**没有任何行为测试能覆盖**
 * ——`bootstrap` 是 Tauri 的 setup 回调，本仓没有它的 harness。删掉那一行，全套测试仍然全绿。
 *
 * 所以这里用 source test 钉接线（与 `mainToolsPendingOrder.source.test.ts` 同一个手法）：
 * 名字改了、桌面分支被摘了、或者有人"顺手"把窄口径换成那条会重灌分类的旧回填，都会红。
 * `app_item_mirror_tests.rs` 管行为（补得对、只增不减、单事项键优先），本文件只管"有没有接上"。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";

/** 路径必须经变量：`new URL("字面量", import.meta.url)` 会被 Vite 改写成 http 地址。 */
function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const BOOTSTRAP_REL = "../../../../src-tauri/src/app/bootstrap.rs";
const SERVICE_REL = "../../../../src-tauri/src/services/item_app_mirror.rs";

describe("存量绑定补镜像的接线", () => {
  it("wp01_bootstrap_在桌面分支里调了启动补镜像", () => {
    const bootstrap = read(BOOTSTRAP_REL);
    /* 桌面独占不是风格偏好：函数里用到的 `normalize_app_key` 在 `models::insight`，
       而那个模块是 `#[cfg(desktop)]` —— 摘掉 cfg 手机端直接编译不过。 */
    expect(bootstrap).toContain(
      "#[cfg(desktop)]\n    services::item_app_mirror::mirror_on_boot(&app, &pool);",
    );
  });

  /* 两个库是这个 bug 最贵的那个坑：配置表在分析窗库（patina.db），`item_app` 在业务库
     （timing.db）。把 `mirror` 收回单池（只传一个 `&SqlitePool`）正是第一版实现干的事，
     症状是「恒空 + 全绿」。这里钉住"入口必须收两个池、且分析窗库要等就绪"。 */
  it("wp03_补镜像读分析窗库写业务库_两池不许合并", () => {
    const service = read(SERVICE_REL);
    expect(service).toContain("pub async fn mirror(business: &SqlitePool, kv: &SqlitePool)");
    expect(service).toContain("settings_repo::get_all(kv)");
    expect(service).toContain("item_app::bind(business");
    expect(service).toContain(
      "pub fn mirror_on_boot<R: tauri::Runtime>(app: &tauri::AppHandle<R>, business: &SqlitePool)",
    );
    expect(service).toContain("wait_for_sqlite_pool(&app)");
  });

  it("wp02_只认两种配置键前缀_且不复用那条会重灌分类的旧回填", () => {
    const service = read(SERVICE_REL);
    expect(service).toContain('"__app_item_binding::"');
    expect(service).toContain('"__app_override::"');
    /* 窄口径：`legacy_bindings::backfill` 会顺带把配置表里的分类数组重新灌进活动库
       `app_category`，把用户刚在映射视图里调过的顺序覆盖回去。要真的是"只补绑定"。 */
    expect(service).not.toContain("legacy_bindings::backfill(");
  });
});
