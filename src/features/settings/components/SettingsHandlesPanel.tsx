/**
 * 主界面设置 · G1「悬浮条与手柄」面板（[0.12.1] T04）
 * -----------------------------------------------------------------------------
 * 三张卡（圆点 / 半手柄 / 手柄）由 `HANDLE_FORMS` 的顺序生成 —— 顺序即药丸上的顺序，
 * 不要在 JSX 里手写三遍。
 *
 * 读写全走 `src/lib/handleBindings.ts`：
 *  · `loadHandleBindings()` 读坏**永不 throw**、也**不写盘**（用户手改坏的原值不被覆盖）；
 *  · `saveHandleBindings()` 先归一化再落盘，所以这里可以放心传「用户刚点出来的对象」。
 *
 * 没有「保存」按钮：手柄绑定是一次性动作配置，不是表单草稿。改完即落盘，药丸在
 * `focus` / `pointerenter` / `visibilitychange` 上重读（`lib/appearanceSync.ts`）。
 * 这也避开了「点保存才生效」与「关掉设置页丢配置」两种相反预期。
 */
import { useState } from "react";
import {
  DEFAULT_HANDLE_BINDINGS,
  HANDLE_FORMS,
  type HandleBindings,
  type HandleForm,
  type HandleFormBinding,
} from "../../../lib/handleCatalog";
import { loadHandleBindings, saveHandleBindings } from "../../../lib/handleBindings";
import SettingsPanelHeader from "./SettingsPanelHeader";
import SettingsHandleCard from "./SettingsHandleCard";
import { MousePointerClick } from "lucide-react";

const STROKE = 1.6;

interface SettingsHandlesPanelProps {
  /** 锚点 id（G1 的 `#s-pill-handles`） */
  id?: string;
}

export default function SettingsHandlesPanel({ id }: SettingsHandlesPanelProps) {
  const [bindings, setBindings] = useState<HandleBindings>(() => loadHandleBindings());

  /** 唯一写入口：先落盘（归一化在库里）再把结果回填，界面与磁盘永远一致。 */
  const commit = (form: HandleForm, next: HandleFormBinding) => {
    const merged: HandleBindings = { ...bindings, [form]: next };
    saveHandleBindings(merged);
    setBindings(loadHandleBindings());
  };

  const resetForm = (form: HandleForm) => {
    commit(form, DEFAULT_HANDLE_BINDINGS[form]);
  };

  return (
    <section className="qp-panel p-5 md:p-6" id={id}>
      <SettingsPanelHeader
        icon={<MousePointerClick size={16} strokeWidth={STROKE} className="text-[var(--qp-accent-default)]" />}
        title="悬浮条与手柄"
      />
      <p className="mt-3 qp-text-caption text-[var(--qp-text-tertiary)]">
        每个形态可以单独启用；同一形态里「左键 / 右键」是单击，「左双击 / 右双击」是同键双击。
        双击与单击落在同一颗键上时，单击要等一次双击判定窗才派发 —— 这是双击能生效的代价。
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {HANDLE_FORMS.map((form) => (
          <SettingsHandleCard
            key={form}
            form={form}
            binding={bindings[form]}
            onChange={(next) => commit(form, next)}
            onReset={() => resetForm(form)}
          />
        ))}
      </div>
    </section>
  );
}
