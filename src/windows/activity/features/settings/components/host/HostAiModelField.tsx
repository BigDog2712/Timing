/**
 * 设置页 · AI「模型」字段（[0.12.3]）
 * -----------------------------------------------------------------------------
 * 模型名不该靠记：服务商兼容 `GET /models` 时就点「获取可用模型」拉目录。
 *  1. 只读目录，不保存配置；拉取后把目录作为原生选择列表，原值仍有效时保留，
 *     未知服务商模型仍可手动输入，是否落库由用户按「保存」决定。
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
        onNotice(`已获取 ${list.length} 个模型${keep ? "" : `，已填入 ${list[0]}`}`);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setLoading(false));
  };

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
          value={models.includes(value) ? value : "__manual__"}
          disabled={disabled}
          aria-busy={loading}
          onChange={(event) => {
            if (event.target.value !== "__manual__") onChange(event.target.value);
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
      {models.length > 0 && !models.includes(value) ? (
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
    </div>
  );
}