/**
 * 主界面设置 · G1 单张手柄卡（[0.12.1] T04 · [0.13] 加自定义绑定）
 * -----------------------------------------------------------------------------
 * 一张卡 = 一个形态（圆点 / 半手柄 / 手柄），卡头是形态名 + 启用开关，卡内 5 行下拉
 * （顺序 = `HANDLE_SLOTS`），卡脚「恢复默认」。
 *
 * 三条不可商量的判据（PRD A-01 / A-02 / A-07）：
 *  1. **槽位恒定 5 个**：`HANDLE_SLOTS.map` 而不是「有几个配几个」，否则关掉某个形态
 *     再打开会出现「少一行」的错觉；
 *  2. **选项唯一数据源是 `HANDLE_ACTIONS`**：每次渲染现算，不缓存成模块常量——扩展点
 *     （插件 / 将来的动作）加进来必须立刻出现在选择器里，这是 A-02 的可测形状；
 *  3. **关闭 = 降墨，不是禁用**：用户仍要能配绑定（先配好再打开），所以控件全都可用，
 *     只有整卡视觉后退一档（`data-enabled="false"`，见 `settings-handles.css`）。
 *
 * [0.13] 下拉多了两类**用户自定义**入口（`启动应用…` / `发送快捷键…`）。它们不是目录里的
 * 动作：选中后不写入，而是先开采集界面（文件选择器 / 录制框），成功才写。
 * 所以取消时下拉会**自己弹回原值** —— 受控 `value` 一直来自 `binding`，这不靠额外状态。
 *
 * 双击代价提示（§6.4）：只要该形态**有双击绑定**且**任一单击槽非空**，单击就必须等
 * 250ms 判双击。不写出来，用户只会觉得「点了有时候没反应」。
 */
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { pickCustomLaunchTarget } from "../../../platform/desktop/hostSettingsGateway";
import SettingsHotkeyRecorder from "./SettingsHotkeyRecorder";
import {
  HANDLE_ACTIONS,
  HANDLE_FORM_LABELS,
  HANDLE_SLOTS,
  HANDLE_SLOT_LABELS,
  type HandleForm,
  type HandleFormBinding,
  type HandleSlot,
} from "../../../../shared/handleCatalog";
import {
  describeCustomBinding,
  parseCustomBinding,
  serializeCustomBinding,
} from "../../../../shared/handleCustomBinding";

const STROKE = 1.6;

/** 「无」的哨兵值：空串不会与任何动作 id 撞（id 都形如 `note.current`）。 */
const NONE = "";

/** 两个采集入口的哨兵值。选中它们**不写入**，只打开采集界面（见文件头）。 */
const LAUNCH_SENTINEL = "custom:launch";
const HOTKEY_SENTINEL = "custom:hotkey";

/**
 * 双击判定窗（毫秒）。**与 `src/lib/constants.ts::DBLCLICK_MS` 同值**，复制而非 import：
 * 那个文件属主窗，L9 禁跨窗 import。改一处必须两处同改（本值只出现在这句提示里）。
 */
const DOUBLE_CLICK_HINT_MS = 250;

interface HandleSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** 本卡里已经存在的自定义绑定：不列出来的话，下拉会显示成「无」（明明有绑定）。 */
function customOptions(binding: HandleFormBinding): HandleSelectOption[] {
  const seen = new Set<string>();
  const out: HandleSelectOption[] = [];
  for (const slot of HANDLE_SLOTS) {
    const raw = binding.slots[slot];
    if (raw == null || seen.has(raw)) continue;
    const parsed = parseCustomBinding(raw);
    if (!parsed) continue;
    seen.add(raw);
    out.push({ value: raw, label: describeCustomBinding(parsed) });
  }
  return out;
}

/** 选项**每次渲染现算**（见文件头判据 2）：注入一条动作 → 重渲 → 必须出现。 */
function buildOptions(binding: HandleFormBinding): HandleSelectOption[] {
  return [
    { value: NONE, label: "无" },
    ...HANDLE_ACTIONS.map((action) => ({
      value: action.id,
      label: action.irreversible ? `${action.label} · 不可逆` : action.label,
    })),
    ...customOptions(binding),
    { value: LAUNCH_SENTINEL, label: "启动应用…" },
    { value: HOTKEY_SENTINEL, label: "发送快捷键…" },
  ];
}

interface SettingsHandleCardProps {
  form: HandleForm;
  binding: HandleFormBinding;
  onChange: (next: HandleFormBinding) => void;
  onReset: () => void;
}

export default function SettingsHandleCard({
  form,
  binding,
  onChange,
  onReset,
}: SettingsHandleCardProps) {
  const formLabel = HANDLE_FORM_LABELS[form];
  const options = buildOptions(binding);
  /** 正在录制的槽位（`null` = 录制框关着） */
  const [recording, setRecording] = useState<HandleSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const writeSlot = (slot: HandleSlot, value: string | null) => {
    onChange({ ...binding, slots: { ...binding.slots, [slot]: value } });
  };

  /**
   * 选文件 → 写入 `launch:` 绑定。
   *
   * [R1] 选路径这件事**交给后端**（`pickLaunchTarget`）：它弹原生对话框、把用户选中的
   * 路径写进授权名单，再把规范化后的路径返回来。前端自己用 `plugin-dialog` 选也能拿到
   * 字符串，但那个字符串后端不认识 —— 名单里没有它，按下去就是 `CUSTOM_ACTION_DENIED`，
   * 用户会以为是「选了个不能启动的程序」。
   *
   * 取消（`null`）与失败走两个不同出口：取消什么都不做，失败必须在卡里说一句 ——
   * 否则用户点了「启动应用…」只看到下拉弹回原值，会以为是自己没点中。
   */
  const pickLaunchTarget = async (slot: HandleSlot) => {
    setError(null);
    let picked: string | null = null;
    try {
      picked = await pickCustomLaunchTarget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开文件选择器失败");
      return;
    }
    if (!picked) return;
    writeSlot(slot, serializeCustomBinding("launch", picked));
  };

  const handleSelect = (slot: HandleSlot, value: string) => {
    if (value === LAUNCH_SENTINEL) {
      void pickLaunchTarget(slot);
      return;
    }
    if (value === HOTKEY_SENTINEL) {
      setRecording(slot);
      return;
    }
    writeSlot(slot, value === NONE ? null : value);
  };

  const doubleBound = binding.slots.leftDouble != null || binding.slots.rightDouble != null;
  const singleBound = binding.slots.left != null || binding.slots.right != null;
  const recordingInitial = recording ? (parseCustomBinding(binding.slots[recording])?.payload ?? null) : null;

  return (
    <div className="settings-handle-card" data-enabled={binding.enabled ? "true" : "false"}>
      <div className="settings-handle-card__head">
        <h3 className="settings-handle-card__title">{formLabel}</h3>
        <QuietSwitch
          checked={binding.enabled}
          ariaLabel={`启用${formLabel}`}
          onChange={(next) => onChange({ ...binding, enabled: next })}
        />
      </div>

      <div className="settings-handle-card__rows">
        {HANDLE_SLOTS.map((slot) => (
          <div className="settings-handle-card__row" key={slot}>
            <span className="settings-handle-card__label">{HANDLE_SLOT_LABELS[slot]}</span>
            <QuietSelect
              ariaLabel={`${formLabel} · ${HANDLE_SLOT_LABELS[slot]}`}
              value={binding.slots[slot] ?? NONE}
              options={options}
              density="compact"
              onChange={(value) => handleSelect(slot, value)}
            />
          </div>
        ))}
      </div>

      {error ? (
        <p className="settings-handle-card__hint" role="alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {doubleBound && singleBound ? (
        <p className="settings-handle-card__hint" role="note">
          {`双击生效时单击会延迟 ${DOUBLE_CLICK_HINT_MS}ms`}
        </p>
      ) : null}

      <div className="settings-handle-card__foot">
        <QuietButton size="compact" onClick={onReset}>
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw size={13} strokeWidth={STROKE} aria-hidden />
            恢复默认
          </span>
        </QuietButton>
      </div>

      {/* 录制框挂在卡的根节点上（不是塞进某一行）：一行在 `display:none` 的形态里时，
          弹层仍要能出现在 body 上——`QuietDialog` 走 portal，但组件必须先被渲染。 */}
      <SettingsHotkeyRecorder
        open={recording != null}
        initial={recordingInitial}
        onCancel={() => setRecording(null)}
        onConfirm={(text) => {
          const slot = recording;
          setRecording(null);
          if (slot) writeSlot(slot, serializeCustomBinding("hotkey", text));
        }}
      />
    </div>
  );
}
