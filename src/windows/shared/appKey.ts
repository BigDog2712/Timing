/**
 * 前台窗口的 `exe_name` → 活动库的 `app_key`（Windows 归一形态）。
 *
 * ## 为什么必须与 Rust 逐字一致
 *
 * `app_key` 是活动库的**生成列**（`sessions.app_key`）、也是 `app_category` / `item_app`
 * 两张表的主键之一。Rust 侧唯一实现是
 * `models::activity::activity_read_model::normalize_app_key`；前端若自己"顺手 lowercase 一下"
 * 就绑不上库里的行 —— 症状是「我在设置里明明绑了 Chrome，切过去就是不计时」，两端日志干净。
 *
 * 所以这里只有一份实现，并且 `appKey.test.ts` 用 source test 把 Rust 那侧的关键分支逐条
 * 钉住（文件里改了口径、这里没跟上，测试就红）。
 *
 * ## 规则（与 Rust 一字不差）
 *
 * 1. `trim` → 去掉首尾的双引号（`"C:\...\Code.exe"` 这种带引号的进程路径）→ 再去一次 `trim`；
 * 2. 全小写（`to_ascii_lowercase`，只动 ASCII，不碰非拉丁字符）；
 * 3. 空串 → `null`（没有可用的键，调用方直接跳过）；
 * 4. 含 `:`（`activity:anonymous`、安卓包名 `com.x.y`）或已以 `.exe` 结尾 → **原样**返回；
 * — 再补 `.exe` 会造出 `activity:anonymous.exe` 这种对不上生成列的值（迁移 28 ③）；
 * 5. 其余补 `.exe`（`Code` → `code.exe`）。
 *
 * 放在 `src/windows/shared/`：主窗（药丸）要用它查 `item_app`，分析窗的分类页也要用它，
 * 而 L9 禁止两窗互相 import —— 共享载体只有这一个位置。
 */
/** 只小写 ASCII（`to_ascii_lowercase` 的等价物）：`toLowerCase()` 会把西里尔字母也改掉，
 *  而 Rust 那侧不会 —— 一份"看起来一样"的实现足以让两边算出不同的键。 */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

export function normalizeAppKey(exeName: string): string | null {
  const normalized = asciiLower(exeName
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim());
  if (!normalized) return null;
  if (normalized.includes(":") || normalized.endsWith(".exe")) return normalized;
  return `${normalized}.exe`;
}
