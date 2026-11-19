/**
 * 分析窗 → 宿主命令的**错误收口**（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 宿主 `AppError` 序列化成 `{ code, message }`（`src-tauri/src/error.rs`），Tauri 把这个
 * **对象**原样当作 Promise 的拒绝值抛给前端 —— 不是 `Error` 实例，也没有 `.stack`。
 *
 * 于是每个消费端都得自己认这个形状。主窗有 `normalizeError`（`services/ipcError.ts`），
 * 分析窗搬不过来（L9 双窗隔离），结果四个网关各写各的：
 * `hostSyncGateway` 与 `hostPluginsGateway` 认了，`hostSettingsGateway` 与
 * `hostAiGateway` 直接 `invoke` —— 后者把对象原样抛给 `errorText`，而 `errorText` 只认
 * `Error` 和字符串，于是**任何后端错误都退化成「操作失败，请重试」**。
 *
 * 这不是假设：0.12.5 上线当天，「获取可用模型」失败后界面上只剩这六个字的兜底文案，
 * 真正的原因（密钥同源规则 / 服务商 400 / 响应格式）全部丢失，等于把排查成本转嫁给用户。
 *
 * 所以收口放在**传输边界**，而不是在每个调用方补一个 `instanceof` 判断：网关 throw 出来
 * 的一律是带 `message` 的 `Error`，`errorText` / `String(err)` / `err.message` 三种写法
 * 都能拿到人话。新增网关**必须**走 `callHost`，别再复制一份。
 */

/** 规范化后的宿主命令失败。`code` 保留业务错误码（`AI_BAD_REQUEST` 这类），供需要分支的调用方用。 */
export interface HostCommandError extends Error {
  code?: string;
}

/**
 * 把一个拒绝值转成 `Error`。
 *
 * @param raw       `invoke` 的拒绝值，形状不可控（对象 / 字符串 / 其它）
 * @param fallback  连 `message` 都取不到时的兜底话术——每个域自己那句更具体的话
 */
export function toHostError(raw: unknown, fallback = "宿主命令执行失败"): HostCommandError {
  if (typeof raw === "object" && raw !== null) {
    const payload = raw as { code?: unknown; message?: unknown };
    const message =
      typeof payload.message === "string" && payload.message.trim().length > 0
        ? payload.message
        : fallback;
    /* `cause` 带上原始 payload：`preserve-caught-error` 要的就是它，
       排查「为什么这条命令失败」时要能看到宿主给的 code，而不是只剩一句人话。 */
    const error: HostCommandError = new Error(message, { cause: raw });
    if (typeof payload.code === "string") error.code = payload.code;
    return error;
  }
  if (typeof raw === "string" && raw.trim().length > 0) return new Error(raw, { cause: raw });
  return new Error(fallback, { cause: raw });
}

/** 已经是 `Error` 就原样返回，避免 `Error(Error)` 把 message 拼成 `Error: xxx`。 */
export function asHostError(raw: unknown, fallback?: string): HostCommandError {
  return raw instanceof Error ? raw : toHostError(raw, fallback);
}
