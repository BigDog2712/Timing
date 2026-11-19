/**
 * AI 网关的**错误透出**（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 这条用例来自线上：`获取可用模型` 失败后，卡底只显示「操作失败，请重试」，服务商给的原因
 * 一个字都没到界面上。原因是 `hostAiGateway.call` 直接 `invoke`，把宿主抛的
 * `{ code, message }` 对象原样丢给了只认 `Error` 的 `errorText`。
 *
 * 钉两条：宿主的中文 message 必须到达调用方；错误码不能被吞（调用方要按码分支）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { aiConfigGet, aiListModels, aiSuggestTags } from "./hostAiGateway.ts";
import { errorText } from "../../features/settings/services/hostApi.ts";

const HOST_ERROR = {
  code: "AI_BAD_REQUEST",
  message:
    "模型「deepseek-v4.1-flash」不被服务商接受，可用：deepseek-flash、deepseek-v4-pro。" +
    "请到「设置 → AI」用「获取可用模型」重选",
};

beforeEach(() => {
  invokeMock.mockReset();
  /* 网关只在桌面宿主里发命令；jsdom 里手动挂上宿主注入对象。 */
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("AI 网关的错误透出", () => {
  it("ai01_宿主的 message 要原样到达界面_不能退化成兜底文案", async () => {
    invokeMock.mockRejectedValueOnce(HOST_ERROR);
    const caught = await aiListModels({ baseUrl: "https://api.deepseek.com" }).catch(
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(Error);
    expect(errorText(caught)).toContain("deepseek-v4.1-flash");
    expect(errorText(caught)).not.toBe("操作失败，请重试");
  });

  it("ai02_收成 Error 的同时错误码留在 error.code 上", async () => {
    invokeMock.mockRejectedValueOnce(HOST_ERROR);
    const caught = (await aiConfigGet().catch((error: unknown) => error)) as Error & {
      code?: string;
    };
    /* `instanceof Error` 这一句是重点：裸对象上也有 `.code`，只断言 code 拦不住回退。 */
    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBe("AI_BAD_REQUEST");
  });

  it("ai03_字符串拒绝值也能读出来", async () => {
    invokeMock.mockRejectedValueOnce("AI_NOT_CONFIGURED: AI 未启用");
    const caught = await aiSuggestTags({ mode: "app", targets: [], candidates: [] }).catch(
      (error: unknown) => error,
    );
    expect(errorText(caught)).toBe("AI_NOT_CONFIGURED: AI 未启用");
  });

  it("ai04_没有宿主注入对象时说人话_而不是浮出 invoke 内部错误", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const caught = await aiConfigGet().catch((error: unknown) => error);
    expect(errorText(caught)).toContain("不在桌面宿主里");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
