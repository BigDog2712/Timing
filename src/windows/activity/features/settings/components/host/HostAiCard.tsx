/**
 * 设置页 · AI 卡（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 配置落 `settings.ai.config`，密钥落 DPAPI/Keystore。交互口径：
 *  1. 「保存并测试」「生成今日汇总」都先保存眼前草稿，测/汇总的不是库里上一份配置。
 *  2. 密钥输入框从空开始，留空 = 不改，点「清除密钥」才清空；明文永不回填。
 *  3. `path === null` 表示只预览未落盘，必须显式说出来，否则用户会去日记里找。
 */
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import QuietSwitch from "../../../../shared/components/QuietSwitch";
import type {
  AiConfig,
  AiConfigView,
  AiDailySummary,
  AiTestResult,
} from "../../../../shared/types/ai.ts";
import { aiApi, errorText } from "../../services/hostApi";
import HostAiModelField from "./HostAiModelField";
import SettingsPanelHeader from "../SettingsPanelHeader";
import { SettingsPreferenceRow } from "../SettingsPreferenceLayout";

const STROKE = 1.6;

function message(error: unknown): string {
  return errorText(error);
}

/**
 * 草稿与库里那份是否等价。
 *
 * 为什么要比字段而不是比 `JSON.stringify`：`patch` 只覆盖键、不重排键，眼下两者顺序确实一致，
 * 但「眼下一致」是靠实现细节维系的——哪天有人给 `AiConfig` 加字段或换了 patch 的写法，
 * 顺序一变就会**永远显示未保存**（或者更糟：改了却显示已保存）。逐个字段比，多一行，不赌。
 */
function sameConfig(a: AiConfig | null, b: AiConfig | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.enabled === b.enabled
    && a.baseUrl === b.baseUrl
    && a.model === b.model
    && a.dailyEnabled === b.dailyEnabled
    && a.itemTagsEnabled === b.itemTagsEnabled
    && a.appTagsEnabled === b.appTagsEnabled
    && a.dailyHeading === b.dailyHeading
    && a.maxTagsPerTarget === b.maxTagsPerTarget
  );
}

export default function HostAiCard() {
  const [view, setView] = useState<AiConfigView | null>(null);
  const [draft, setDraft] = useState<AiConfig | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "daily" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [summary, setSummary] = useState<AiDailySummary | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await aiApi.get();
      setView(next);
      setDraft(next.config);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = (partial: Partial<AiConfig>) => {
    setDraft((current) => (current ? { ...current, ...partial } : current));
    setNotice(null);
  };

  const persist = async (): Promise<AiConfigView | null> => {
    if (!draft) return null;
    const next = await aiApi.save(draft, keyTouched ? keyDraft : undefined);
    setView(next);
    setDraft(next.config);
    setKeyDraft("");
    setKeyTouched(false);
    return next;
  };

  const handleSave = () => {
    setBusy("save");
    setError(null);
    setNotice(null);
    void persist()
      .then(() => setNotice("已保存"))
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(null));
  };

  const handleTest = () => {
    setBusy("test");
    setError(null);
    setNotice(null);
    setTest(null);
    void persist()
      .then(() => aiApi.test())
      .then((result) => setTest(result))
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(null));
  };

  const handleDaily = () => {
    setBusy("daily");
    setError(null);
    setNotice(null);
    setSummary(null);
    /* 与「保存并测试」同口径：汇总必须按眼前这份配置（含 dailyEnabled / 标题）生成，
       否则用户刚打开「写入日记」却没保存，会拿到一份令人困惑的“仅预览”。 */
    void persist()
      .then((saved) => (saved ? aiApi.dailySummary() : null))
      .then((result) => {
        if (result) setSummary(result);
      })
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(null));
  };

  const disabled = busy !== null;
  const config = draft;
  /* 「改了但没保存」必须自己说出来。这一卡的开关与输入都只改草稿（与「同步与备份」同口径），
     可那边每个折叠块标题旁有「未保存」标记，这边什么都没有——用户拨开「启用 AI」、
     看着开关是开的就走了，库里仍是关的，回到数据页点「AI 自动打标签」只会得到一句
     「AI 总开关还没打开」。开关那一行单独再提示一次：卡片很长，底部按钮在视野外。 */
  const dirty = keyTouched || !sameConfig(view?.config ?? null, draft);
  const enabledPending = view !== null && config !== null && view.config.enabled !== config.enabled;

  return (
    /* `settings-host-sync` 只是 settings-bits.css 里的宿主变量桥：给 `sync__*` 字段补 --line/--ink；无同步逻辑。 */
    <section className="at-panel p-5 md:p-6 settings-host-sync">
      <SettingsPanelHeader
        icon={<Sparkles size={16} strokeWidth={STROKE} className="text-[var(--at-accent-default)]" />}
        /* 与导航锚点标题（`settingsGroups.ts` 的 `s-ai`）逐字一致 =「AI 与标签」——
           锚点 `title` 必须等于卡片标题，要改就两处同批改。
           「标签」**不是空挂**：本卡第二个内容块「建议范围」（下方 `h3`）管的就是 AI 的
           标签建议，`启用 AI` 的 hint 也写着「关着时标签建议…会拒绝执行」。判断一个词是否
           空挂，标准是**卡内有没有对应实体**，不是仓里有没有同名目录。 */
        title="AI 与标签"
      />
      <div className="mt-4 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <SettingsPreferenceRow title="启用 AI" hint="关着时标签建议与今日汇总都会拒绝执行，配置仍可保存与测试">
            <QuietSwitch
              checked={config?.enabled ?? false}
              disabled={disabled || !config}
              ariaLabel="启用 AI"
              onChange={(enabled) => patch({ enabled })}
            />
          </SettingsPreferenceRow>
          {enabledPending ? (
            <p className="at-text-caption text-[var(--at-text-secondary)]" role="status">
              开关已拨到「{config?.enabled ? "开" : "关"}」，按卡片底部的「保存」后才会生效
            </p>
          ) : null}
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="at-text-body at-weight-emphasis text-[var(--at-text-primary)]">连接</h3>
          <div className="grid max-w-[640px] gap-3 sm:grid-cols-2">
            <label className="sync__field">
              <span className="sync__label">Base URL</span>
              <input
                className="sync-cloud__input"
                value={config?.baseUrl ?? ""}
                disabled={disabled || !config}
                spellCheck={false}
                placeholder="https://api.deepseek.com/v1"
                onChange={(event) => patch({ baseUrl: event.target.value })}
              />
            </label>
            <HostAiModelField
              key={config?.baseUrl ?? ""}
              baseUrl={config?.baseUrl ?? ""}
              apiKey={keyTouched ? keyDraft : null}
              value={config?.model ?? ""}
              disabled={disabled || !config}
              onChange={(model) => patch({ model })}
              onNotice={setNotice}
              onError={setError}
            />
          </div>
          <p className="sync-cloud__hint">
            兼容 OpenAI 协议：DeepSeek / Kimi / Ollama / LM Studio 填各自的 /v1 地址；更换域名后需重新填写 API Key。
          </p>
          <label className="sync__field max-w-[640px]">
            <span className="sync__label">API Key</span>
            <div className="sync__row">
              <input
                className="sync-cloud__input"
                type="password"
                autoComplete="new-password"
                value={keyDraft}
                disabled={disabled || !config}
                spellCheck={false}
                placeholder={view?.hasKey ? "已保存，留空表示不修改" : "粘贴服务商的控制台密钥"}
                onChange={(event) => { setKeyDraft(event.target.value); setKeyTouched(true); }}
              />
              <button
                type="button"
                className="btn btn--ghost sync__pick"
                disabled={disabled || !view?.hasKey}
                title="删除已保存的密钥"
                onClick={() => { setKeyDraft(""); setKeyTouched(true); setNotice("保存后清除密钥"); }}
              >
                清除密钥
              </button>
            </div>
          </label>
          <p className="sync-cloud__hint">
            {view && !view.secretAvailable ? "当前平台没有可用的凭据存储，密钥不会落盘。" : "密钥保存在系统凭据里，页面不会回显明文。"}
          </p>
        </section>

        <section className="flex flex-col gap-3 border-t border-[var(--at-border-subtle)] pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="at-text-body at-weight-emphasis text-[var(--at-text-primary)]">建议范围</h3>
              <p className="sync-cloud__hint">AI 先匹配你已有的标签；实在没有合适的，才会按「生活 / 工作 / 学习 / 娱乐 / 复盘」下最多两级新建。</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 at-text-caption">
                <QuietSwitch
                  checked={config?.itemTagsEnabled ?? true}
                  disabled={disabled || !config}
                  ariaLabel="为事项建议标签"
                  onChange={(itemTagsEnabled) => patch({ itemTagsEnabled })}
                />
                事项
              </label>
              <label className="flex items-center gap-2 at-text-caption">
                <QuietSwitch
                  checked={config?.appTagsEnabled ?? true}
                  disabled={disabled || !config}
                  ariaLabel="为应用建议分类"
                  onChange={(appTagsEnabled) => patch({ appTagsEnabled })}
                />
                应用
              </label>
            </div>
          </div>
          <label className="sync__field max-w-[120px]">
            <span className="sync__label">单条建议上限</span>
            <input
              className="sync-cloud__input"
              type="number"
              min={1}
              max={8}
              value={config?.maxTagsPerTarget ?? 3}
              disabled={disabled || !config}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(next)) patch({ maxTagsPerTarget: next });
              }}
            />
          </label>
        </section>

        <section className="flex flex-col gap-3 border-t border-[var(--at-border-subtle)] pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="at-text-body at-weight-emphasis text-[var(--at-text-primary)]">今日汇总</h3>
              <p className="sync-cloud__hint">把当日计时与应用使用交给模型写成一段日记；需先启用 AI 并保存密钥，关闭写入时只预览。</p>
            </div>
            <label className="flex items-center gap-2 at-text-caption">
              <QuietSwitch
                checked={config?.dailyEnabled ?? false}
                disabled={disabled || !config}
                ariaLabel="允许把今日汇总写入日记"
                onChange={(dailyEnabled) => patch({ dailyEnabled })}
              />
              写入日记文件
            </label>
          </div>
          <label className="sync__field max-w-[640px]">
            <span className="sync__label">区块标题</span>
            <input
              className="sync-cloud__input"
              value={config?.dailyHeading ?? ""}
              disabled={disabled || !config}
              spellCheck={false}
              placeholder="#### AI 今日汇总"
              onChange={(event) => patch({ dailyHeading: event.target.value })}
            />
          </label>
          </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--at-border-subtle)] pt-4">
          <button type="button" className="btn btn--primary" disabled={disabled || !config} onClick={handleSave}>
            {busy === "save" ? "保存中…" : "保存"}
          </button>
          <button type="button" className="btn btn--ghost" disabled={disabled || !config} onClick={handleTest}>
            {busy === "test" ? "测试中…" : "保存并测试"}
          </button>
          <button type="button" className="btn btn--ghost" disabled={disabled || !config} onClick={handleDaily}>
            {busy === "daily" ? "生成中…" : "生成今日汇总"}
          </button>
          {dirty ? <span className="data__dirty">未保存</span> : null}
          {notice ? <span className="at-text-caption text-[var(--at-text-secondary)]" role="status">{notice}</span> : null}
        </div>

        {test ? (
          <p
            className="at-text-caption"
            style={{ color: test.ok ? "var(--at-success, #4CC38A)" : "var(--at-danger)" }}
            role="status"
          >
            {test.message}（{test.latencyMs} ms）
          </p>
        ) : null}
        {error ? (
          <p className="at-text-caption text-[var(--at-danger)]" role="alert">{error}</p>
        ) : null}

        {summary ? (
          <div className="rounded border border-[var(--at-border-subtle)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="at-text-caption text-[var(--at-text-secondary)]">{summary.date}</span>
              <span className="at-text-caption text-[var(--at-text-tertiary)]">
                {summary.path ? `已写入 ${summary.path}` : "仅预览，未写入日记"}
              </span>
            </div>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap at-text-caption text-[var(--at-text-primary)]">
              {summary.markdown}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}