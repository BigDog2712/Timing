# 归档声明（V0.5.0）

> 本文件是机械断言的锚点：`scripts/archived-versions.json` 记录本工程的冻结版本，
> `npm run check:version` 会断言 `app/build.gradle.kts` 的 `versionCode` / `versionName`
> 仍等于冻结值。**改这两个数字会让门禁变红**——这是故意的。

## 结论

| 项 | 值 |
| --- | --- |
| 状态 | **已归档**（不发布、不跟进版本、不再修 bug） |
| 冻结版本 | `versionCode = 9` / `versionName = "0.3.6"` |
| 冻结时的包名 | `com.tickbar.droid` |
| 冻结提交 | V0.5.0 改名前的最后一版（`git log -- android-app`） |
| 主线 | `src-tauri/gen/android`（Tauri mobile，与桌面同一份前端源码） |

## 为什么归档

两套安卓工程并存会产出**两个不同包名的 APK**，用户可同时装两个 App、数据分裂；
而 `android-app/` 是独立 Kotlin 工程（自带一套状态机、时钟落库、Obsidian 同步实现），
与桌面版共享的是**数据格式**而不是代码，长期维护成本翻倍。

V0.5.0 起收敛到 Tauri mobile 单线：同一份 `src/`、同一份契约、零分叉。

## 为什么保留代码

1. 悬浮层（`TYPE_APPLICATION_OVERLAY`）与前台服务的实现只有这里有——将来 Tauri 侧要
   做悬浮条时，这是唯一可参考的可运行实现；
2. 冻结在 `0.3.6` 的这套代码与 `docs/sync/OBSIDIAN-SYNC.md` 的数据格式契约一一对应，
   删掉会让那份文档失去可验证的实现；
3. `release/TickBar-android-0.3.6.apk` 是历史产物，归档代码让它可以被重新构建核对。

## 本工程**不要**做的事

- 不要把版本号改成当前桌面版（`0.5.0`）：它永不发布，追版本号没有收益，还会让
  `check:version` 的冻结断言失去意义；
- 不要在这里实现新功能：新需求进 `src-tauri/gen/android` 那条线；
- 不要在 `src-tauri` 的代码里 `use` 本目录里的任何东西（两套工程零代码依赖）。

## 重新启用的前置条件

若某天必须重启本工程（例如 Tauri 侧确定不做悬浮层），需要**重新评估后再动手**：

1. 重新决定包名（新包名 = 新应用，老用户数据不可迁，见 `docs/rename-v0.5.0/PRD.md` §5）；
2. 更新 `scripts/archived-versions.json` 与本节冻结值（同一次提交里改，否则门禁红）；
3. 重新走一遍 `assembleDebug` + 真机验证（本机无 Android SDK/NDK/Java，见
   `docs/rename-v0.5.0/ARCHITECTURE.md` §7 N10）。
