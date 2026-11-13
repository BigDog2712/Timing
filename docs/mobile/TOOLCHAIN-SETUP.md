# Android 构建工具链（本机实测）

> 用途：记录 Timing 安卓端构建环境的实际安装结果、验证状态，以及两种构建路径。
> 更新于 2026-11-05，环境：Windows 11 + 非管理员账户。

## 1. 已安装组件

| 组件 | 版本 | 路径 |
|------|------|------|
| JDK | Zulu 17.0.21+`LTS`（`17.70.113`） | `%USERPROFILE%\.wb-toolchain\jdk-17` |
| Android cmdline-tools | 19.0 | `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest` |
| platform-tools | 37.0.1（adb 1.0.41） | `%LOCALAPPDATA%\Android\Sdk\platform-tools` |
| platforms | android-35、android-36 | `%LOCALAPPDATA%\Android\Sdk\platforms` |
| build-tools | 36.0.0 | `%LOCALAPPDATA%\Android\Sdk\build-tools\36.0.0` |
| NDK | 27.2.12479018（clang 18.0.3，target android24） | `%LOCALAPPDATA%\Android\Sdk\ndk\27.2.12479018` |
| Gradle | 9.6.1（wrapper 缓存已就绪） | `%USERPROFILE%\.gradle\wrapper\dists` |

Rust 侧（rustc 1.99.0）已装 4 个 Android target：
`aarch64-linux-android`、`armv7-linux-androideabi`、`i686-linux-android`、`x86_64-linux-android`。

`compileSdk=36` / `targetSdk=35` / `minSdk=24` 与 `app/build.gradle.kts` 一致。

## 2. 环境变量（已写入「用户」作用域，无需管理员）

```
JAVA_HOME        = %USERPROFILE%\.wb-toolchain\jdk-17
ANDROID_HOME     = %USERPROFILE%\AppData\Local\Android\Sdk
ANDROID_SDK_ROOT = %USERPROFILE%\AppData\Local\Android\Sdk
NDK_HOME         = %USERPROFILE%\AppData\Local\Android\Sdk\ndk\27.2.12479018
PATH            += ...\Android\Sdk\platform-tools;...\Android\Sdk\cmdline-tools\latest\bin
```

> 新开的终端才读得到这些变量；当前已打开的窗口需要重启。

另：`src-tauri/gen/android/local.properties` 已写入 `sdk.dir`（该文件被 `.gitignore` 忽略，不入库）。

## 3. 两种构建路径

### A. 官方路径 `npx tauri android build`（需一次「开发者模式」）

Tauri 会把 Rust 产物 **符号链接** 到 `jniLibs/`，Windows 上创建符号链接必须开启开发者模式，
否则报 `Creation symbolic link is not allowed for this system`。

开启方式（任选其一，均需管理员）：

- 设置 → 系统 → 开发者选项 → 「开发人员模式」打开
- 管理员 PowerShell：
  `reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1`

开启后即可直接用官方命令（支持 `--split-per-abi`、`--aab` 等全部参数）。

### B. 零权限路径 `node scripts/android-apk.mjs`（当前可用）

脚本把「符号链接」换成「复制」，其余步骤与官方一致（前端构建 → cargo 交叉编译 → Gradle 打包）：

```bash
node scripts/android-apk.mjs                      # release，arm64-v8a
node scripts/android-apk.mjs --abi armeabi-v7a    # 指定 ABI（一次一个）
node scripts/android-apk.mjs --debug              # debug 变体
```

产物：`src-tauri/gen/android/app/build/outputs/apk/<flavor>/<variant>/*.apk`

注意：

- release APK **未签名**（与 tauri CLI 行为一致），装真机前需 `apksigner` 或配置签名。
- 多 ABI 需按 ABI 逐个执行；本轮只验证了 `arm64-v8a`（覆盖绝大多数现代设备）。
- 脚本会自动从 `ANDROID_HOME` / `local.properties` / NDK 目录探测路径，并给
  `libsqlite3-sys` 的 `sqlite3.c` 注入 NDK clang（`CC_<target>`/`AR_<target>`），
  这一步缺了会在编译期报找不到 `stdio.h`。

## 4. 实测验证（2026-11-05）

| 项 | 结果 |
|----|------|
| Rust 交叉编译（arm64，bundled sqlite） | ✅ 通过，`libtiming_lib.so` 7.1 MB |
| Gradle `assembleArm64Release` | ✅ 通过（R8 混淆正常） |
| APK 产物 | ✅ `app-arm64-release-unsigned.apk` 8.7 MB |
| 包信息（aapt2 badging） | ✅ `com.timing.app` / versionCode 5000 / versionName 0.5.0 / minSdk 24 / targetSdk 35 / compileSdk 36 |
| APK 内含 native 库 | ✅ `lib/arm64-v8a/libtiming_lib.so` |
| 真机安装 | ⚠️ 未验证——当前无连接设备、未装模拟器（`adb devices` 为空） |

## 5. 踩坑记录

| 现象 | 原因 | 处理 |
|------|------|------|
| `rustup target add` 报 404/403，地址是清华镜像 | rustup 取到的 channel 清单被代理改写成 tuna 源，而该源缺 1.99.0 的 Android std | 直接从 `static.rust-lang.org` 下载 4 个 `rust-std-1.99.0-*.tar.xz`，解压进 `~/.rustup/toolchains/stable-x86_64-pc-windows-msvc/lib/rustlib/<target>`，并补写 `lib/rustlib/components` 与 `multirust-config.toml` |
| `tauri android build` 在 symlink 处失败 | Windows 未开开发者模式 | 见 §3-B 脚本路径 |
| `local.properties` 缺失 | 从未在本机跑过安卓构建 | 写入 `sdk.dir`（已 gitignore） |
| jniLibs 残留改名前的旧库名 `.so` | 品牌改名前的历史产物（被 gitignore，未入库） | 已删除；运行期加载的是 `timing_lib`（见 `generated/Rust.kt`） |
| `cargo check --target aarch64-linux-android` 报 `failed to find tool "clang.exe": program not found` | target 装好了，缺的是 NDK 的 clang 不在 `PATH`（`scripts/android-apk.mjs` 会自己注入，手敲 cargo 不会） | 跑之前注入三项：`export PATH="$NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin:$PATH"`、`CC_aarch64_linux_android=aarch64-linux-android24-clang.cmd`、`AR_aarch64_linux_android=llvm-ar.exe`、`CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=aarch64-linux-android24-clang.cmd`。**注意别把这一步和「0 error」混为一谈**：编过只说明能编，要证明 `#[cfg(mobile)]` 的代码真的进了包，得往那段里插一个故意写错的标识符，看安卓红、桌面绿（v0.11.14 验收就这么做的） |
