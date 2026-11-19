/**
 * Timing — 设置 · 「最短记录时长」这一行（[B5d] 从 `HostGeneralPanel` 搬来）
 * -----------------------------------------------------------------------------
 * 为什么搬：这一行决定**记录粒度**，是调计时规则时的高频项，却一直挂在第 5 组
 * 「通用与启动」的 `s-general` 卡里；而真正应用这条阈值的其它两项（合并间隔、空闲超时）
 * 在第 1 组「计时行为」。改成行级搬迁后三者同组，`s-general` 只剩「开机自启」一行
 * （它属"启动"语义，组名「通用与启动」仍贴题）。
 *
 * **搬迁是行级的**：锚点总数仍 12 个、`s-general` 仍存在、`SETTINGS_ANCHOR_IDS` 与
 * `TOP_LADDER` 阶梯都不用动 —— 只换这一行渲染在哪个卡片里。
 *
 * 语义（ADR-023）：低于此时长的手动结束、以及切换事项产生的分段都**不产生记录**。
 * 文案与 i18n：这一行从来没进 i18n 表（`HostGeneralPanel` 里就是中文字面量），
 * 本轮不为搬家新增 key —— 新增 key 会动生成物与验收里的文案表，而收益只是"看着一致"。
 *
 * 读写的三条规矩（原样搬过来，一条没改）：
 *   ① 值来自宿主参考设置 `get_reference_settings`，不是写死的 30；
 *   ② 失焦 / 回车才提交；空值或非数字一律回退到当前值（不写库）；越界钳到 5 / 300，
 *      其余按原样保存（不强制 5 的整数倍）；
 *   ③ 只提交 `minRecordSeconds` 一个键 —— 多带一个键就是把别的偏好一起覆盖掉。
 */
import { useEffect, useState } from "react";

import { errorText, settingsApi } from "../services/hostApi";
import { useSettingsStore } from "../services/host/settingsRuntimeStore";
import { SettingsPreferenceRow } from "./SettingsPreferenceLayout";

/** 与后端 `ReferenceSettings::default().min_record_seconds` 同值 */
const FALLBACK_MIN_RECORD_SEC = 30;
/** 可调范围（秒）：下限 5 秒已低于任何有意义的记录，上限 5 分钟 */
const MIN_RECORD_SEC_MIN = 5;
const MIN_RECORD_SEC_MAX = 300;

/** 越界钳制：输入框的 `min`/`max` 只影响 UA 校验，提交前必须自己钳一次 */
function clampSec(value: number): number {
  return Math.min(MIN_RECORD_SEC_MAX, Math.max(MIN_RECORD_SEC_MIN, value));
}

export default function SettingsMinRecordRow() {
  const referenceSettings = useSettingsStore((s) => s.referenceSettings);
  const [error, setError] = useState<string | null>(null);

  /* 首帧：参考设置没读到时自己拉一次（这一行搬出 `HostGeneralPanel` 后，
     不能再指望那张卡顺带把它读进来）。 */
  useEffect(() => {
    if (!referenceSettings) {
      void useSettingsStore.getState().reloadReference().catch(() => undefined);
    }
  }, [referenceSettings]);

  const minRecordSeconds = referenceSettings?.minRecordSeconds ?? FALLBACK_MIN_RECORD_SEC;

  /* 输入中的草稿（字符串）：受控 input 的值来自 store，直接绑数字会让「清空重打」
     和「打了一半的负号」被立刻纠正回去。草稿只负责编辑态，提交后交还 store。 */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(minRecordSeconds);

  /* 失焦 / 回车才提交：空值或非数字一律回退到当前值（不写库），
     越界钳到 5 / 300，其余按输入的原样保存（不强制 5 的整数倍）。 */
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (trimmed === "" || !Number.isFinite(parsed)) {
      setDraft(null);
      return;
    }
    const next = clampSec(parsed);
    setDraft(String(next));
    if (next === minRecordSeconds) {
      setDraft(null);
      return;
    }
    setError(null);
    void (async () => {
      try {
        const nextReference = await settingsApi.updateReference({ minRecordSeconds: next });
        useSettingsStore.getState().setReferenceSettings(nextReference);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setDraft(null);
      }
    })();
  };

  return (
    <>
      <SettingsPreferenceRow title="最短记录时长">
        <label className="num-field">
          <input
            className="num-field__input"
            type="number"
            inputMode="numeric"
            min={MIN_RECORD_SEC_MIN}
            max={MIN_RECORD_SEC_MAX}
            step={1}
            value={shown}
            aria-label="最短记录时长（秒）"
            title="输入秒数后回车或点别处生效"
            onChange={(e) => setDraft(e.target.value)}
            /* [V0.3.9] 不再「聚焦即全选」：进来调秒数时整段文字被反白高亮，看着像选中了别的东西 */
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget.value);
              }
            }}
          />
          <span className="num-field__unit">S</span>
        </label>
      </SettingsPreferenceRow>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
