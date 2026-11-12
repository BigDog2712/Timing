/**
 * 主界面设置 · G1「悬浮条与手柄」面板（[0.12.1] T04 · [0.12.1 归一] 真源搬到设置表）
 * -----------------------------------------------------------------------------
 * 三张卡（圆点 / 半手柄 / 手柄）由 `HANDLE_FORMS` 的顺序生成 —— 顺序即药丸上的顺序，
 * 不要在 JSX 里手写三遍。
 *
 * **写路径（0.12.1 归一后）**：`savePillPrefs({ handles })` → 宿主设置表落库 → 成功后才动界面与
 * 本窗缓存 → `nudgePillPrefs()` 发一个无载荷信号让悬浮条自己去读库。
 * 顺序不能反：先改界面后落库的话，写失败时界面会撒谎（用户以为存上了，重启就没了）。
 *
 * 为什么不再「写完广播载荷」：真源已经是宿主设置表，两窗各读各的 localStorage 的时代结束了
 * （见 `platform/desktop/pillPrefsGateway.ts` 的文件头）。本窗那份 localStorage 只剩
 * 「首帧缓存 + 同窗重渲染」两个用途，**不参与任何判定**。
 *
 * 没有「保存」按钮：手柄绑定是一次性动作配置，不是表单草稿。改完即落库。
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_HANDLE_BINDINGS,
  HANDLE_FORMS,
  type HandleBindings,
  type HandleForm,
  type HandleFormBinding,
} from "../../../../timing/lib/handleCatalog";
import { loadHandleBindings, saveHandleBindings } from "../../../../timing/lib/handleBindings";
import {
  loadPillPrefs,
  nudgePillPrefs,
  savePillPrefs,
} from "../../../platform/desktop/pillPrefsGateway";
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
  const [error, setError] = useState<string | null>(null);
  /** 用户已经动过控件 → 进门那次读库的结果不许再盖回去（见下面的挂载效应）。 */
  const touched = useRef(false);

  /**
   * 挂载时去**真源**读一次。
   *
   * 为什么要读：本卡显示的是本窗缓存，而本窗（分析窗）与悬浮条不是同一个 WebView 数据目录，
   * 缓存可能是旧的。更要紧的是写：`commit` 发的是「整份 handles」，若首帧是过期缓存，
   * 用户点一次开关就会把另外两个形态写成旧值（= 把别的窗口改过的配置抹掉）。
   * 读失败 / 库里没有 → 什么都不做，继续用本窗缓存（迁移由主窗 `main.tsx` 负责）。
   */
  useEffect(() => {
    let alive = true;
    void loadPillPrefs()
      .then((prefs) => {
        if (!alive || !prefs || touched.current) return;
        saveHandleBindings(prefs.handles);
        setBindings(loadHandleBindings());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 唯一写入口：**先落库，成功后再改界面**。
   *
   * 失败只在本卡内显示一行红字：不 throw 到 React 边界（那会让整个设置页消失），
   * 也不用 toast（设置页有既定的红字口径）。
   */
  const commit = async (form: HandleForm, next: HandleFormBinding) => {
    touched.current = true;
    const merged: HandleBindings = { ...bindings, [form]: next };
    try {
      await savePillPrefs({ handles: merged });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试");
      return;
    }
    setError(null);
    /* 本窗缓存：同窗立即重渲染，也是下次冷启动首帧的来源（不是真源） */
    saveHandleBindings(merged);
    /* 无载荷信号：悬浮条收到后自己去 `get_settings` 读，不靠这条通道传值 */
    nudgePillPrefs();
    setBindings(loadHandleBindings());
  };

  const resetForm = (form: HandleForm) => {
    void commit(form, DEFAULT_HANDLE_BINDINGS[form]);
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
            onChange={(next) => void commit(form, next)}
            onReset={() => resetForm(form)}
          />
        ))}
      </div>
      {error && (
        <p className="inline-error mt-3" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
