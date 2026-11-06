# 真机联调（Android）

> 目标：手机上出的问题，能在电脑上**看见**，不用靠截图猜。
> 起因：V0.11.9 ~ V0.11.10 的「同步读不回」，代码、单测、门禁全绿，但真机上是黑盒，
> 来回猜了三轮。V0.11.11 起把日志接到了 logcat。

## 一、一次配好

1. 手机：设置 → 关于手机 → 连点「版本号」7 次打开开发者模式；
   再到 设置 → 系统 → 开发者选项 → 打开 **USB 调试**。
2. 数据线连电脑（**必须能传数据**，很多线只能充电）；手机弹窗选「允许」，
   勾上「始终允许使用这台计算机进行调试」。
3. 电脑上验证：

   ```bash
   adb devices
   # 期待：<序列号>   device
   # 若是 unauthorized → 手机上再点一次允许；若是空列表 → 换线/换口
   ```

   `adb` 在 `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`。

> 没有数据线？Android 11 以上支持无线调试：开发者选项 → 无线调试 → 使用配对码配对，
> 然后 `adb pair 手机IP:配对端口`、`adb connect 手机IP:调试端口`。同一 WiFi 即可。

## 二、装包 + 看日志

```bash
# 装（覆盖安装，不用先卸载）
adb install -r release/Timing-android-<版本>-release-arm64-debugsigned.apk

# 看日志：清屏后实时跟随，同时写入 release/logs/android-latest.log
npm run android:log

# 只想导最近 300 行发人看
npm run android:log -- --dump
```

在手机上做一遍出问题的操作，日志会实时滚在电脑上。`Ctrl+C` 结束。

## 三、该看哪几行

同步相关（`tag = Timing`）：

| 日志 | 含义 |
| --- | --- |
| `md mirror in: 请求 N 个路径，取到 M 个 [...]` | M 为 0 = vault 里按这个名字找不到文件（路径对不上 / 日记不叫这个名） |
| `md sync 事项计时: <路径> exists=… dir=… imported=… exported=…` | `dir` 是 `import` 说明从文件读回了数据；`imported=0` 说明文件没变或解析为空 |
| `md mirror out: 写回 N 个文件` | N 为 0 = 没有任何改动需要落盘 |
| `mirrorIn: 请求=[...] 取到=[...]` | Kotlin 侧同一件事（SAF 里到底找到没找到） |

其它：

- `AndroidRuntime: FATAL EXCEPTION` —— Kotlin 崩溃；
- `libc: Fatal signal` —— Rust 侧 abort / 段错误；
- `Timing … PANIC` —— Rust panic（`panic = "abort"` 下的唯一现场）。

## 四、能验什么、验不了什么

| 事项 | 真机 | 官方 AVD | 第三方模拟器（雷电等） |
| --- | --- | --- | --- |
| SAF 目录授权、跨重启存活 | ✅ 唯一可信 | ⚠️ 标准 DocumentsUI，接近真机 | ❌ system_server 被改过 |
| 悬浮窗显示 / 位置 / 点击 | ✅ | ✅ | ⚠️ 窗口层级不同 |
| 厂商 ROM 杀后台、前台服务存活 | ✅ 唯一可信 | ❌ | ❌ |
| 耗电、流畅度 | ✅ | ❌ | ❌ |
| UI / 交互 / 布局 | ✅ | ✅ 够用 | ✅ 够用 |

结论：**判定功能通不通，用真机；只是想改界面不想插线，模拟器够**。

## 五、构建侧

- 现有产物只打 `arm64-v8a`。第三方模拟器（x86 实例）装不上，报
  `INSTALL_FAILED_NO_MATCHING_ABIS`。
- 要在模拟器里跑，需另编一版：

  ```bash
  npx tauri android build --apk --target x86_64
  ```

  Rust 目标 `x86_64-linux-android` 已装。注意 Rust 的 `.so` 不跑转译层，模拟器原生执行。
- 包是 release + 调试证书签名：`debuggable=false`，`adb run-as` 读不到应用私有目录，
  所以数据库和日志文件取不出来——**这就是日志必须走 logcat 的原因**。
