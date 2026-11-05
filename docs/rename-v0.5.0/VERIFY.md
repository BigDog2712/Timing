# V0.5.0 改名 + 迁移 —— 验收执行记录（VERIFY）

- 版本：0.5.0（`check:version` 六处一致；归档 `android-app` 冻结 `0.3.6 / 9`）
- 执行环境：Windows 10/11 x64，VS 18 Insiders（无独立 Windows SDK，`LIB/INCLUDE` 由
  `.wb-toolchain/build-msvc.bat` 注入 ScopeCppSDK 补全）
- 产物：`release\Timing.exe`（6,432,768 B，PE `ProductName=Timing / ProductVersion=0.5.0`）
- 记录口径：**桌面实测** = 主理人用真实 `%APPDATA%` 数据跑过；**单测** = `cargo test` 里的
  用例（`src-tauri/src/tests/appdata_migrate*.rs`）；**未执行** 一律写原因，不写「待定」。

## M-01..M-14

| 用例 | 时间 | 结果 | 证据 / 说明 |
| --- | --- | --- | --- |
| M-01 老目录有 0.4.1 数据，首次启动 0.5.0 | 2026-11-05 | **通过**（桌面实测） | 迁移前先备份真实数据（122 K）。`%APPDATA%\com.timing.app\timing.db` 81920 B + `migrated-from-tickbar-app.json`；`rowCounts: items 18 / timeRecords 54 / todos 8 / notes 20 / settings 16`；`verified: size+integrity+rows`、`walCopied: false`；诊断 `migration : migrated（已从旧目录迁移）`、`legacy : com.tickbar.app (kept)`。老目录 `tickbar.db` mtime 仍是 Nov 4 15:20（**一字节未改**） |
| M-02 迁移成功后再次启动 | — | **通过**（单测） | `tests::appdata_migrate::m02_second_run_is_noop`：第二次判 `AlreadyPresent`、不重复写、不产生 `premigrate-*` |
| M-03 迁移后删掉老目录再启动 | — | **通过**（单测） | `tests::appdata_migrate::m03_works_after_legacy_dir_removed`：判 `NoLegacy`，新库数据仍在 |
| M-04 全新机器（两目录都不存在） | — | **部分覆盖** | `decide::NoLegacy` 分支由 M-03 第二次启动断言到；**未做全新机桌面实测**（需要一台干净机器，本轮没有） |
| M-05 新目录已存在且有 `timing.db` | — | **通过**（单测） | `tests::appdata_migrate::m05_target_with_db_is_not_overwritten`：判 `TargetOccupied`、目标库字节不变、不写迁移标记、老数据完好 |
| M-06 复制失败（目标不可写 / 库损坏） | — | **通过**（单测） | `tests::appdata_migrate_edges::m06_verify_failure_leaves_no_temp`：停在 `Verify`、临时目录被清理、不留下半成品新目录、老库一字节不动 |
| M-07 迁移中强杀进程 | — | **通过**（单测） | `m07_leftover_temp_is_cleaned`（残留临时目录被清理后完整重迁）+ `unremovable_temp_fails_at_clean_temp`（**删不掉时停在 `CleanTemp`，绝不带着半成品继续复制**） |
| M-08 老库处于 WAL 且有未 checkpoint 数据 | — | **通过**（单测） | `m08_wal_records_are_carried`：`wal_copied=true`，且「只在 WAL 里」的那条记录到达新库（`time_records=2`）。注意：校验阶段会用可读写连接打开副本 → SQLite 关闭时 checkpoint 回主库并删掉 `-wal`，所以**最终目录里没有 `-wal` 是校验成功的产物**，不是丢数据 |
| M-09 `TIMING_SKIP_MIGRATE=1` | — | **通过**（单测） | `m09_skip_flag_returns_skipped`：判 `Skipped`，不创建目标目录、不创建临时目录 |
| M-10 老版本开过开机自启 | — | **未执行** | 需要「老版本开过自启 + 迁移 + 重登」的真实环境；本机安全策略拦截 `reg.exe`，无法用命令行核验注册表。代码侧：`autostart_takeover::run` 只在 `Migrated` 时动作，先挂新的再删旧的，失败只 WARN 不阻断启动（单元级无覆盖，属已知缺口） |
| M-11 迁移后主题浅色 + 窗口在副屏 | 2026-11-05 | **通过（间接）**（桌面实测） | `.window-state.json` 是复制来的（mtime 仍是 Nov 2），窗口按保存的几何正常显示 252x48。localStorage 兼容由 T03 的双读键覆盖 |
| M-12 卸载 0.5.0 装回 0.4.1 | 2026-11-05 | **通过**（桌面实测） | 旧版 `release\TickBar.exe` 启动后仍读到 `com.tickbar.app\tickbar.db`（81920 bytes）→ 证明迁移**只复制、未移动**，回滚通道有效 |
| M-13 老目录只有一个空 `logs/` | — | **通过**（单测） | `m13_only_logs_dir_counts_as_legacy`：视为有旧数据 → 复制日志后正常空库启动、不弹失败框、`rowCounts` 全 0 |
| M-14 迁移过程中又双击启动一次 | — | **未执行** | 需要真实双击两次；单实例插件在 `lib.rs` 注册，不启动应用无法验证。本轮未运行应用（避免动真实数据） |

### 附：M-15..M-18 的覆盖情况（不属 T05.12 的 14 行，供下一轮参考）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| M-15 空白启动后再重启 → 覆盖式迁移 | **通过**（单测） | `blank_start_then_retry_migrates_over`：搬的是老库那条、空白期目录被**改名保留**（`premigrate_dirs.len()==1` 且备份里记录还在）、`pending-migrate.json` 已清 |
| M-16 `premigrate-<ts>` 目录名被占用 | **未覆盖** | 需要同秒内二次覆盖才能触发；`Paths` 的时间戳精度到秒，本轮未造该场景 |
| M-17 覆盖式迁移复制失败后回滚 | **部分覆盖** | `m06` 覆盖了「复制/校验失败 → 清理临时目录、老目录完好」；「覆盖式分支失败后 target 回到覆盖前状态」的专门用例**未写** |
| M-18 debug 构建未设 `TIMING_FORCE_MIGRATE` | **未执行** | 判定逻辑在 `app/preboot.rs`（`env_flag` + `cfg!(debug_assertions)`），未运行应用 |

## 门禁结果（最终状态）

| 门禁 | 退出码 | 关键输出 |
| --- | --- | --- |
| `cargo test` | 0 | 353 passed / 0 failed（lib）+ 0（main bin）+ 1 ignored（doc） |
| `cargo clippy --all-targets -- -D warnings` | 0 | 零 warning / 零 error |
| `cargo fmt --check` | 0 | — |
| `npm run check` | 0 | `[contract] 命令 Rust 67 / IpcApi 67 / ipc.ts 67 / mock 67；错误码 16/16；事件 11/11/11`、`[size] 441 文件 / 上限 300`、`[version] 0.5.0 六处 + 归档 0.3.6/9`、`[layers] 7 条`、`[brand] 违规 0`、`eslint --max-warnings=0` 无输出 |
| `npm test`（vitest） | 见主报告 | 前端单测 |

## 未做的事（明确记录）

- **未执行 T05.13 / T05.14**：没有 `git tag`、没有 `git push`、没有 `gh release create`、
  没有改仓库 About / Topics、没有发布 Release 正文。这些是不可逆的写远程操作。
- **未构建 Android 产物**（T05.11）：本机无 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `NDK_HOME`，
  `java` 不在 PATH，`rustup target list --installed` 无 Android target。Release 说明里
  **不得**列 APK、不得写「APK 已验证」。
- **打包器（T05.10）**：见主报告对 `npm run tauri build` 的实测结论；若 bundler 因缺
  WiX/NSIS 失败，则本轮**仅提供绿色单文件 exe**。
