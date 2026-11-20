/**
 * 新建事项 / 新建待办时的「绑定应用」下拉（可选）。
 *
 * 药丸快捷新建是从「最近 8 个前台应用」里点选；分析窗拿不到那份 store，
 * 改用应用目录（`useClassificationAppCatalog`），归一后去重 —— 与事项编辑里的
 * 绑定应用栏同一套键口径（`resolveAppItemBindingExe`）。
 */
import { useMemo } from "react";

import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import { useLocale } from "../../../shared/i18n/index.ts";
import { useClassificationAppCatalog } from "../../classification/hooks/useClassificationAppCatalog.ts";
import { ITEM_EDITOR_COPY } from "../copyItemEditor.ts";
import { resolveAppItemBindingExe } from "../services/appItemBinding.ts";

interface Props {
  enabled: boolean;
  value: string | null;
  onChange: (appKey: string | null) => void;
  disabled?: boolean;
}

export default function ItemAppSelect({ enabled, value, onChange, disabled = false }: Props) {
  const copy = ITEM_EDITOR_COPY[useLocale()];
  const catalog = useClassificationAppCatalog({ enabled });

  const options = useMemo(() => {
    const names = new Map<string, string>();
    for (const candidate of catalog.candidates) {
      const key = resolveAppItemBindingExe(candidate.exeName);
      if (!key || names.has(key)) continue;
      const label = candidate.appName.trim() || candidate.exeName.trim();
      names.set(key, label || key);
    }
    return [
      { value: "", label: copy.pickApp },
      ...[...names].sort((left, right) => left[1].localeCompare(right[1])).map(([key, label]) => ({
        value: key,
        label,
      })),
    ];
  }, [catalog.candidates, copy.pickApp]);

  return (
    <QuietSelect
      value={value ?? ""}
      options={options}
      onChange={(next) => onChange(next || null)}
      ariaLabel={copy.appsLabel}
      density="compact"
      disabled={disabled || options.length <= 1}
      className="at-item-app-select"
    />
  );
}
