/**
 * 手柄「发送快捷键」录制框（[0.13]）
 * -----------------------------------------------------------------------------
 * 一个槽位选「发送快捷键…」时打开：按下组合键 → 预览 → 「使用」。
 *
 * ## 三条口径
 *
 *  1. **录制期间吞掉一切按键**（`capture` + `preventDefault`）。不吞的话，用户想录
 *     `Ctrl+W` 会顺手把设置页（或它的宿主）关掉，或者触发浏览器/WebView 的快捷键。
 *     单独按 `Esc` 仍然是「取消」——它是这套界面的既定出口，且 `Esc` 不带修饰键时
 *     本来就不构成合法组合（见 `shared/hotkey.ts` 的「必须有修饰键」）。
 *  2. **不即时确认**：命中后先显示预览，要再点一次「使用」。录制时按错的成本是
 *     「点一下取消」，而不是「一条错误的注入配置」。
 *  3. **合法性判据只在 `shared/hotkey.ts`**：本文件只负责把 `specFromKeyboardEvent`
 *     的 `null`（修饰键本身 / 白名单外的键 / 没有修饰键）翻译成一句「继续按」。
 */
import { useEffect, useState } from "react";

import QuietButton from "../../../shared/components/QuietButton";
import QuietDialog from "../../../shared/components/QuietDialog";
import { formatHotkey, specFromKeyboardEvent } from "../../../../shared/hotkey";
import type { HotkeySpec } from "../../../../shared/hotkey";

interface SettingsHotkeyRecorderProps {
  open: boolean;
  /** 当前槽位上已有的组合键（重录时先亮出来，避免"看起来没有旧值"） */
  initial: string | null;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}

export default function SettingsHotkeyRecorder({
  open,
  initial,
  onCancel,
  onConfirm,
}: SettingsHotkeyRecorderProps) {
  const [spec, setSpec] = useState<HotkeySpec | null>(null);

  /* 每次打开都从空开始：上一次录到一半的组合键不该被下一次继承 */
  useEffect(() => {
    if (open) setSpec(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        onCancel();
        return;
      }
      const next = specFromKeyboardEvent(event);
      if (next) setSpec(next);
    };
    /* 捕获阶段：先于页面上任何一行 keydown 处理（包括 QuietDialog 自己的 Esc 关闭） */
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onCancel]);

  const preview = spec ? formatHotkey(spec) : null;

  return (
    <QuietDialog
      open={open}
      title="录制快捷键"
      description="按下一个组合键（至少带 Ctrl / Alt / Shift / Meta 之一）。单独一个字母会把按键打进别的窗口，所以不被接受。"
      onClose={onCancel}
      closeOnBackdrop={false}
      actions={
        <>
          <QuietButton size="compact" onClick={onCancel}>
            取消
          </QuietButton>
          <QuietButton
            size="compact"
            tone="primary"
            disabled={preview == null}
            onClick={() => {
              if (preview) onConfirm(preview);
            }}
          >
            使用
          </QuietButton>
        </>
      }
    >
      <div className="settings-handle-hotkey" data-empty={preview ? "false" : "true"}>
        {preview ?? "请按下组合键…"}
      </div>
      {initial ? (
        <p className="settings-handle-hotkey__hint">当前：{initial}</p>
      ) : null}
    </QuietDialog>
  );
}
