/**
 * 主界面设置 · G1 单张手柄卡（[0.12.1] T04 · 本轮唯一全新 UI）
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
 * 双击代价提示（§6.4）：只要该形态**有双击绑定**且**任一单击槽非空**，单击就必须等
 * 250ms 判双击。不写出来，用户只会觉得「点了有时候没反应」。
 */
import { RotateCcw } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import {
  HANDLE_ACTIONS,
  HANDLE_FORM_LABELS,
  HANDLE_SLOTS,
  HANDLE_SLOT_LABELS,
  type HandleForm,
  type HandleFormBinding,
  type HandleSlot,
} from "../../../lib/handleCatalog";

const STROKE = 1.6;

/** 「无」的哨兵值：空串不会与任何动作 id 撞（id 都形如 `note.current`）。 */
const NONE = "";

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

/** 选项**每次渲染现算**（见文件头判据 2）：注入一条动作 → 重渲 → 必须出现。 */
function buildOptions(): HandleSelectOption[] {
  return [
    { value: NONE, label: "无" },
    ...HANDLE_ACTIONS.map((action) => ({
      value: action.id,
      label: action.irreversible ? `${action.label} · 不可逆` : action.label,
    })),
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
  const options = buildOptions();

  const setSlot = (slot: HandleSlot, value: string) => {
    onChange({
      ...binding,
      slots: { ...binding.slots, [slot]: value === NONE ? null : value },
    });
  };

  const doubleBound = binding.slots.leftDouble != null || binding.slots.rightDouble != null;
  const singleBound = binding.slots.left != null || binding.slots.right != null;

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
              onChange={(value) => setSlot(slot, value)}
            />
          </div>
        ))}
      </div>

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
    </div>
  );
}
