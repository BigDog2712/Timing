/**
 * 主界面设置 · 药丸外观卡（[0.12.1] T04：`timing.appearance.v1` 的新写入点）
 * -----------------------------------------------------------------------------
 * 三项：文字不透明度 / 背景不透明度 / 常驻形态。口径照宿主 `components/settings/AppearanceCard.tsx`
 * （同一套文案与同一套下限），但读写**只走** `src/lib/pillAppearance.ts`：
 *  - 不 import `stores/appearanceStore`（zustand + 副作用，L9 双窗隔离）；
 *  - 也不在本地重写 clamp —— 两处写同一个键必须只有一条写路径（归一化在库里）。
 *
 * 写完立刻「看得见」的方式：本窗只落 localStorage；药丸窗口在 `focus` / `pointerenter` /
 * `visibilitychange` 上幂等重读（`lib/appearanceSync.ts`），最长延迟 = 一次焦点切换。
 * 不做轮询、不加事件 —— 这是本轮验收口径（X-01）。
 */
import { Droplet, Type } from "lucide-react";
import { useState } from "react";
import QuietStepperSlider from "../../../../shared/components/QuietStepperSlider";
import {
  FLOAT_FORM_OPTIONS,
  TEXT_OPACITY_MIN,
  readPillAppearance,
  writePillAppearance,
  type Appearance,
} from "../../../../lib/pillAppearance";
import SettingsPanelHeader from "../SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "../SettingsPreferenceLayout";

const STROKE = 1.6;
const MIN_PERCENT = Math.round(TEXT_OPACITY_MIN * 100);

interface HostPillLookCardProps {
  /** 锚点 id（G1 的 `#s-pill-look`） */
  id?: string;
}

export default function HostPillLookCard({ id }: HostPillLookCardProps) {
  const [appearance, setAppearance] = useState<Appearance>(() => readPillAppearance());

  /** 唯一的写入口：库里归一化 → 落盘 → 把结果回填到本地状态。 */
  const patch = (next: Partial<Appearance>) => setAppearance(writePillAppearance(next));

  const opacitySlider = (
    which: "textOpacity" | "bgOpacity",
    label: string,
  ) => {
    const percent = Math.round(appearance[which] * 100);
    return (
      <SettingsPreferenceRow title={label} hint="只影响悬浮条，不影响本页">
        <div className="settings-preference-slider">
          <QuietStepperSlider
            ariaLabel={label}
            value={percent}
            min={which === "textOpacity" ? MIN_PERCENT : 0}
            max={100}
            step={1}
            integerButtons
            displayValue={`${percent}%`}
            decreaseAriaLabel={`降低${label}`}
            increaseAriaLabel={`提高${label}`}
            onChange={(next) => patch({ [which]: next / 100 } as Partial<Appearance>)}
          />
        </div>
      </SettingsPreferenceRow>
    );
  };

  return (
    <section className="qp-panel p-5 md:p-6" id={id}>
      <SettingsPanelHeader
        icon={<Droplet size={16} strokeWidth={STROKE} className="text-[var(--qp-accent-default)]" />}
        title="悬浮条外观"
      />
      <div className="mt-4">
        <SettingsPreferenceGroup title="显示">
          <SettingsPreferenceRow title="常驻形态" hint="启动时是悬浮条还是收起成小圆点">
            <div className="flex flex-wrap gap-2" role="group" aria-label="常驻形态">
              {FLOAT_FORM_OPTIONS.map((option) => {
                const on = appearance.floatForm === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ floatForm: option.id })}
                    className={`rounded-[8px] border px-3 py-1.5 qp-text-body ${
                      on
                        ? "border-[var(--qp-accent-default)] text-[var(--qp-text-primary)]"
                        : "border-[var(--qp-border-subtle)] text-[var(--qp-text-secondary)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </SettingsPreferenceRow>
          {opacitySlider("textOpacity", "文字不透明度")}
          {opacitySlider("bgOpacity", "背景不透明度")}
        </SettingsPreferenceGroup>
        <p className="mt-3 flex items-center gap-1.5 qp-text-caption text-[var(--qp-text-tertiary)]">
          <Type size={12} strokeWidth={STROKE} aria-hidden />
          改完回到悬浮条即时生效（最长延迟 = 一次焦点切换）。
        </p>
      </div>
    </section>
  );
}
