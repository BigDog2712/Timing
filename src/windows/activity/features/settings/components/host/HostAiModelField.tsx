/**
 * 设置页 · AI「模型」字段（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 模型名不该靠记：服务商兼容 `GET /models` 时就点「获取可用模型」拉目录。
 *  1. 只读目录，不保存配置；拉取后把目录作为原生选择列表，原值仍有效时保留，
 *     未知服务商模型仍可手动输入，是否落库由用户按「保存」决定。
 *     **目录不是全集**（自建网关常只列一部分）：选「手动输入…」随时能跳出去自己填，
 *     只是会提示一句「不在列表里，可能被拒」——提示不是拦截。
 *  2. Base URL 换了就重新取——旧地址的模型名对新服务商没有意义（父组件用 key 重置列表）。
 *  3. 草稿密钥随请求带上；没填就用宿主的已存密钥（宿主只认同源，换域名会要求重填）。
 */
import { useState } from "react";
import { aiApi, errorText } from "../../services/hostApi";

interface HostAiModelFieldProps {
  baseUrl: string;
  value: string;
  apiKey: string | null;
  disabled: boolean;
  onChange: (model: string) => void;
  onNotice: (text: string | null) => void;
  onError: (text: string | null) => void;
}

export default function HostAiModelField({
  baseUrl,
  value,
  apiKey,
  disabled,
  onChange,
  onNotice,
  onError,
}: HostAiModelFieldProps) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  /* 目录外的型号要不要手填，只能由用户说了算：`GET /models` 有的网关只列一部分，
     列出来的清单**不能**当成全集。 */
  const [manual, setManual] = useState(false);

  const fetchModels = () => {
    const url = baseUrl.trim();
    if (!url) {
      onError("先填写 Base URL 再获取模型");
      return;
    }
    setLoading(true);
    onError(null);
    onNotice(null);
    void aiApi
      .listModels({ baseUrl: url, apiKey })
      .then((list) => {
        setModels(list);
        if (list.length === 0) {
          onNotice("服务商没有返回模型，请手动填写");
          return;
        }
        const keep = list.includes(value);
        if (!keep) onChange(list[0]);
        setManual(false);
        onNotice(`已获取 ${list.length} 个模型${keep ? "" : `，已填入 ${list[0]}`}`);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setLoading(false));
  };

  /* 值不在目录里（含刚拉完目录还没改选）也走手填：否则选择框会显示成一个
     并不等于实际值的选项，用户以为已经选中了目录里的型号。 */
  const showManual = models.length > 0 && (manual || !models.includes(value));

  return (
    <div className="sync__field">
      <div className="flex items-center justify-between gap-2">
        <label className="sync__label" htmlFor="ai-model">模型</label>
        <button
          type="button"
          className="at-text-caption text-[var(--at-accent-default)] disabled:text-[var(--at-text-disabled)]"
          disabled={disabled || loading}
          onClick={fetchModels}
        >
          {loading ? "获取中…" : "获取可用模型"}
        </button>
      </div>
      {models.length > 0 ? (
        <select
          id="ai-model"
          className="sync-cloud__input"
          value={showManual ? "__manual__" : value}
          disabled={disabled}
          aria-busy={loading}
          onChange={(event) => {
            /* 「手动输入…」以前是**死选项**：选中后 onChange 直接返回，输入框永远不出现，
               拉过一次目录就再也填不了目录外的型号。现在它把输入框打开。 */
            if (event.target.value === "__manual__") {
              setManual(true);
              return;
            }
            setManual(false);
            onChange(event.target.value);
          }}
        >
          <option value="__manual__">手动输入…</option>
          {models.map((model) => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      ) : (
        <input
          id="ai-model"
          className="sync-cloud__input"
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder="deepseek-chat"
          aria-busy={loading}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {showManual ? (
        <input
          className="sync-cloud__input mt-2"
          aria-label="手动输入模型名称"
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder="手动输入模型名称"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      {/* 目录已拉到、当前值却不在其中：这是唯一会「保存一个服务商不认的型号」的入口，
          提前说一句，比让用户点完按钮看 400 再回来猜要省事。 */}
      {showManual && value.trim() !== "" ? (
        <p className="at-text-caption text-[var(--at-text-tertiary)] mt-1" role="status">
          「{value.trim()}」不在服务商返回的列表里，保存后请求可能被拒绝
        </p>
      ) : null}
    </div>
  );
}