/**
 * 事项名的校验（[本轮]，从 `TimelineManage` 拆出来）。
 *
 * 拆出来的理由只有一条：`TimelineManage.tsx` 贴着单文件 300 行硬限，而校验规则
 * 附带的那几段注释是**判据本身**（口径必须写清：哪些是后端也会拒、哪些只是弹层自己拦），
 * 删注释换行数是本末倒置。放在 `services/` 下也方便单测直接钉"哪一种无效"。
 */

/**
 * 事项名长度上限，与后端 `models::constants::ITEM_NAME_MAX_LEN` 同值 60
 * （`src-tauri/src/models/constants.rs:27`；`src/lib/constants.ts` 里另有一份主窗的）。
 * 前端只拦"明显无效"的那一层，最终判据仍在 Rust（超长 → `ITEM_NAME_TOO_LONG`）。
 */
export const ITEM_NAME_MAX_LEN = 60;

/**
 * 名字不合法的两种情形。
 * 导出成字面量联合（而不是直接返回文案）是为了让测试钉"哪一种"，
 * 而不是钉某一句中文 —— 文案在四语言里各有一份，钉文案会把测试绑死在 zh 上。
 *
 * **不包含**「意图没发出去」：那是事件桥的返回值为 false 时，调用点直接赋
 * `copy.timelineSaveFailed`，根本不经过这个联合。旧版曾把 `notSent` 塞进来当"同一个
 * 提示位"，但它没有任何生产者 —— 结果是两个 `describe` 函数各留一条永远走不到的
 * fallback 分支（QA 2026-11-12 用 grep 生产者才发现）。别再放回来。
 */
export type ItemNameIssue = "empty" | "tooLong";

/**
 * 名字校验（纯函数）。
 *
 * 口径**照 Rust `services::item`，不自己发明更严的规则**：
 *   · 只做两件事 —— `trim` 后非空、`chars().count() <= 60`；
 *   · **不查重**（ADR-021）：事项靠 `id` 区分，名字只是展示，`create` / `update` 都允许同名。
 *     上一版弹层曾额外拦一次同名，那是为「全表摊开给用户看」服务的；管理弹层现在只显示
 *     常用 + 近期两组，比同名既拦不准也没意义，所以那一层连同 `duplicate` 一起删了。
 *   · 长度按**码点**数（`Array.from(name).length`），与 Rust 的 `chars().count()` 对齐；
 *     用 `name.length` 会把一个 emoji 算成 2，前端就比后端更严了 —— 那是自己发明的规则。
 */
export function checkItemName(raw: string): ItemNameIssue | null {
  const name = raw.trim();
  if (!name) return "empty";
  if (Array.from(name).length > ITEM_NAME_MAX_LEN) return "tooLong";
  return null;
}
