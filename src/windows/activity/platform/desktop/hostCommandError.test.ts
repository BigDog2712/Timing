/**
 * 宿主命令错误收口（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 钉的是**形状**，不是文案：宿主 `AppError` 序列化成 `{ code, message }`，Tauri 把这个
 * 对象原样当拒绝值抛下来。不认这个形状，界面上就只剩兜底话术——0.12.5 上线当天
 * 「获取可用模型」失败后只显示「操作失败，请重试」，真正的原因全丢了。
 */
import { describe, expect, it } from "vitest";

import { asHostError, toHostError } from "./hostCommandError.ts";

describe("宿主命令错误收口", () => {
  it("err01_对象形状取 message 并把 code 挂回去", () => {
    const error = toHostError({
      code: "AI_BAD_REQUEST",
      message: "模型「deepseek-v4.1-flash」不被服务商接受，可用：deepseek-flash、deepseek-v4-pro",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("deepseek-v4.1-flash");
    expect(error.code).toBe("AI_BAD_REQUEST");
    /* cause 留住原始 payload：排查时要能看到宿主给的完整形状。 */
    expect((error as Error & { cause?: unknown }).cause).toMatchObject({ code: "AI_BAD_REQUEST" });
  });

  it("err02_没有 message 才用兜底话术", () => {
    expect(toHostError({ code: "IO_ERROR" }, "插件目录读取失败").message).toBe("插件目录读取失败");
    expect(toHostError({ code: "IO_ERROR" }, "插件目录读取失败").code).toBe("IO_ERROR");
    expect(toHostError({ message: "   " }, "兜底").message).toBe("兜底");
  });

  it("err03_字符串与其它类型都收成 Error", () => {
    expect(toHostError("missing required key request").message).toBe("missing required key request");
    expect(toHostError(undefined, "兜底").message).toBe("兜底");
    expect(toHostError(null, "兜底").message).toBe("兜底");
    expect(toHostError(42, "兜底").message).toBe("兜底");
  });

  it("err04_已经是 Error 就原样返回_不会被套第二层", () => {
    const original = new Error("当前不在桌面宿主里");
    expect(asHostError(original)).toBe(original);
    /* `toHostError` 单用也能保住 message（Error 的 `message` 本身就是字符串属性），
       但会**换一个实例**，`cause` 与调用栈都断了——网关里因此一律走 `asHostError`。 */
    expect(toHostError(original).message).toBe("当前不在桌面宿主里");
    expect(toHostError(original)).not.toBe(original);
  });
});
