/**
 * 主界面设置 · 「悬浮条与把手」组的绑定面板（[0.12.1] T04 · [0.12.1 归一] 真源搬到设置表
 * · [B5b] 卡片标题对齐导航锚点 · [B5c] 折进高级区）
 * -----------------------------------------------------------------------------
 * **卡片标题 = 导航锚点标题**（「把手绑定」）：导航点的是哪个名字，滚过来看到的卡就得叫哪个
 * 名字。两者分家会让用户以为点错了（同页 `HostSyncPanel` 的卡头也是这么对齐的，
 * 见 `HostSyncPanel.test.tsx` 的 s01）。改组名/锚点名时这张卡的 `title` 要同批改。
 *
 * [B5c] 这张卡现在是**默认折叠**的 `FoldBlock`：把手绑定属于「设置一次就不再动」的高级项，
 * 常驻占据第一屏是在挤计时规则。折叠块自己就是卡片（`data__block` 提供边框与底色），
 * `id` 落在块根节点上 → 锚点 `#s-pill-handles` 在**可见头部**，不在 `hidden` 的折叠体里。
 * 点导航时由 `settingsFoldReveal` 先展开再滚（见 `SettingsGroupNav.jump()`）。
 *
 * 三张卡（圆点 / 半手柄 / 手柄）由 `HANDLE_FORMS` 的顺序生成 —— 顺序即药丸上的顺序，
 * 不要在 JSX 里手写三遍。⚠️「手柄」在这里是**形态名**（`full`），不是绑定名：
 * 绑定叫「把手」，见 `handleCatalog.ts` 的 `HANDLE_FORM_LABELS`。
 *
 * **写路径（0.12.1 归一后）**：`savePillPrefs({ handles })` → 宿主设置表落库 → 成功后才动界面与
 * 本窗缓存 → `nudgePillPrefs()` 发一个无载荷信号让悬浮条自己去读库。
 * 顺序不能反：先改界面后落库的话，写失败时界面会撒谎（用户以为存上了，重启就没了）。
 *
 * 为什么不再「写完广播载荷」：真源已经是宿主设置表，两窗各读各的 localStorage 的时代结束了
 * （见 `platform/desktop/pillPrefsGateway.ts` 的文件头）。本窗那份 localStorage 只剩
 * 「首帧缓存 + 同窗重渲染」两个用途，**不参与任何判定**。
 *
 * 没有「保存」按钮：把手绑定是一次性动作配置，不是表单草稿。改完即落库。
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_HANDLE_BINDINGS,
  HANDLE_FORMS,
  type HandleBindings,
  type HandleForm,
  type HandleFormBinding,
} from "../../../../shared/handleCatalog";
import { loadHandleBindings, saveHandleBindings } from "../../../../shared/handleBindings";
import {
  loadPillPrefs,
  nudgePillPrefs,
  savePillPrefs,
} from "../../../../shared/pillPrefsGateway";
import { FoldBlock } from "./host/FoldBlock";
import SettingsHandleCard from "./SettingsHandleCard";

interface SettingsHandlesPanelProps {
  /** 锚点 id（「悬浮条与把手」组的 `#s-pill-handles`），同时是折叠块根节点的 DOM id */
  id?: string;
}

export default function SettingsHandlesPanel({ id = "s-pill-handles" }: SettingsHandlesPanelProps) {
  const [bindings, setBindings] = useState<HandleBindings>(() => loadHandleBindings());
  const [error, setError] = useState<string | null>(null);
  /** 用户已经动过控件 → 进门那次读库的结果不许再盖回去（见下面的挂载效应）。 */
  const touched = useRef(false);
  const latestBindings = useRef(bindings);
  latestBindings.current = bindings;

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
    const merged: HandleBindings = { ...latestBindings.current, [form]: next };
    latestBindings.current = merged;
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
    /* [B5c] **卡片即折叠块**：`FoldBlock` 的 `id` 直接落在它的根节点上，所以
       `#s-pill-handles` = 折叠块的可见头部（不是 `hidden` 的折叠体）—— 导航点「把手绑定」
       滚到这里就能看见标题，折叠体展开由导航派发的信号触发（见 `services/settingsFoldReveal`）。
       默认折叠、不记忆（与数据卡六块同一口径）；标题与移动方式对齐导航锚点标题。 */
    <FoldBlock
      id={id}
      title="把手绑定"
      hint="三形态 × 5 槽，改完即生效"
      /* [B5c] 这张卡直接挂在页级 `<h1>设置` 下面（第 3 组没有 h2 外壳），而数据卡六块嵌在
         「数据与同步」的 `h2` 卡里。所以同一套 `FoldBlock` 壳在这里要用 `h2`，与
         `SettingsPanelHeader` 的 `h2` 平级 —— 否则 `h1 → h4` 跳两级，读屏大纲断档。 */
      /* [B5d] `standalone`：这张折叠块**自己就是那张卡**（与同页 `at-panel` 平级），
         所以走卡片材质（半径 14px / 底色 `--at-bg-panel` / 内边距 20–24px），
         而不是卡内折叠块的次级材质（10px / `--at-bg-elevated` / 12px）。 */
      titleAs="h2"
      standalone
    >
      <p className="at-text-caption text-[var(--at-text-tertiary)]">
        每个形态可以单独启用；同一形态里「左键 / 右键」是单击，「左双击 / 右双击」是同键双击。
        双击与单击落在同一颗键上时，单击要等一次双击判定窗才派发 —— 这是双击能生效的代价。
      </p>
      <div className="grid gap-2 md:grid-cols-3">
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
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </FoldBlock>
  );
}
