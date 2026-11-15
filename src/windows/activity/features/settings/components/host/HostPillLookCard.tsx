/**
 * 主界面设置 · 药丸外观卡（[0.12.1] T04 · [0.12.1 归一] 真源搬到设置表）
 * -----------------------------------------------------------------------------
 * 三项：文字不透明度 / 背景不透明度 / 常驻形态。口径照宿主 `components/settings/AppearanceCard.tsx`
 * （同一套文案与同一套下限），但读写**只走** `src/lib/pillAppearance.ts`：
 *  - 不 import `stores/appearanceStore`（zustand + 副作用，L9 双窗隔离）；
 *  - 也不在本地重写 clamp —— 归一化只有一处（`normalizeAppearance`）。
 *
 * **写路径（0.12.1 归一后）**：`savePillPrefs({ appearance })` → 宿主设置表落库 → 成功后才改界面
 * 与本窗缓存 → `nudgePillPrefs()` 发一个无载荷信号。顺序不能反：先改界面后落库，写失败时
 * 界面会撒谎（关掉设置页再回来就变回去了，用户还以为是自己的错觉）。
 *
 * 本窗那份 localStorage 只剩「首帧缓存 + 同窗重渲染」，**不参与任何判定**。
 */
import { Droplet, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QuietStepperSlider from "../../../../shared/components/QuietStepperSlider";
import {
  FLOAT_FORM_OPTIONS,
  TEXT_OPACITY_MIN,
  normalizeAppearance,
  readPillAppearance,
  writePillAppearance,
  type Appearance,
} from "../../../../../shared/pillAppearance";
import SettingsPanelHeader from "../SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "../SettingsPreferenceLayout";
import {
  loadPillPrefs,
  nudgePillPrefs,
  savePillPrefs,
} from "../../../../../shared/pillPrefsGateway";

const STROKE = 1.6;
const MIN_PERCENT = Math.round(TEXT_OPACITY_MIN * 100);

interface HostPillLookCardProps {
  /** 锚点 id（G1 的 `#s-pill-look`） */
  id?: string;
}

export default function HostPillLookCard({ id }: HostPillLookCardProps) {
  const [appearance, setAppearance] = useState<Appearance>(() => readPillAppearance());
  const [error, setError] = useState<string | null>(null);
  /** 用户已经动过控件 → 进门那次读库的结果不许再盖回去。 */
  const touched = useRef(false);

  /**
   * 挂载时去**真源**读一次。
   *
   * 为什么要读：本卡显示本窗缓存，而本窗（分析窗）与悬浮条不是同一个 WebView 数据目录，
   * 缓存可能是旧的；而 `patch` 发的是**整份外观**，用过期缓存打底就会把别的窗口改过的
   * 另两项覆盖回去。读失败 / 库里没有 → 什么都不做（迁移由主窗 `main.tsx` 负责）。
   */
  useEffect(() => {
    let alive = true;
    void loadPillPrefs()
      .then((prefs) => {
        if (!alive || !prefs || touched.current) return;
        writePillAppearance(prefs.appearance);
        setAppearance(readPillAppearance());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 唯一写入口：**先算完整值 → 落库 → 成功后才改界面**。
   *
   * `normalizeAppearance` 是纯函数（在 `base` 上叠 patch），所以「算」与「写」可以分开：
   * 算出的完整三项既是发给 Rust 的载荷，也是落库返回后本地要显示的值 —— 两边同源。
   */
  const apply = async (merged: Appearance) => {
    try {
      await savePillPrefs({ appearance: merged });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试");
      return;
    }
    setError(null);
    /* 本窗缓存：同窗立即跟随，也是下次冷启动首帧的来源（不是真源） */
    writePillAppearance(merged);
    setAppearance(merged);
    /* 无载荷信号：悬浮条收到后自己去 `get_settings` 读，不靠这条通道传值 */
    nudgePillPrefs();
  };

  const patch = (next: Partial<Appearance>) => {
    touched.current = true;
    void apply(normalizeAppearance(next, appearance));
  };

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
        {error && (
          <p className="inline-error mt-3" role="alert">
            {error}
          </p>
        )}
        <p className="mt-3 flex items-center gap-1.5 qp-text-caption text-[var(--qp-text-tertiary)]">
          <Type size={12} strokeWidth={STROKE} aria-hidden />
          改完回到悬浮条即时生效（最长延迟 = 一次焦点切换）。
        </p>
      </div>
    </section>
  );
}
