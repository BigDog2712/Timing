import { useMemo, useState, useLayoutEffect } from "react";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter.tsx";
import type { DataDestinationMode } from "../services/dataDestinationState.ts";
import type { DataTagReadModel } from "../services/dataTagReadModelTypes.ts";
import { filterDataTagOptionsForQuery } from "../services/dataTagReadModel.ts";

export interface DataTagAssociationPanelLabels {
  title: string;
  empty: string;
  applications: (count: number) => string;
  items: (count: number) => string;
  noApplications: string;
  noItems: string;
  duration: (milliseconds: number) => string;
  loading: string;
}

interface Props {
  model: DataTagReadModel | null;
  labels: DataTagAssociationPanelLabels;
  destinationMode: DataDestinationMode;
  availableDestinationModes: DataDestinationMode[];
  onDestinationModeChange: (mode: DataDestinationMode) => void;
}

export default function DataTagAssociationPanel({
  model,
  labels,
  destinationMode,
  availableDestinationModes,
  onDestinationModeChange,
}: Props) {
  const [query, setQuery] = useState("");
  const options = useMemo(
    () => model ? filterDataTagOptionsForQuery(model.tagOptions, query) : [],
    [model, query],
  );
  useLayoutEffect(() => {
    setQuery("");
  }, [model]);

  if (!model) {
    return (
      <section className="at-panel p-5" aria-label={labels.title}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="at-weight-emphasis text-[var(--at-text-primary)] at-text-section-title">{labels.title}</h3>
          <QuietSegmentedFilter
            value={destinationMode}
            options={availableDestinationModes.map((value) => ({ value, label: value === "app" ? "应用" : value === "tag" ? "标签" : "网页" }))}
            onChange={onDestinationModeChange}
            ariaLabel="数据维度"
          />
        </div>
        <p className="mt-3 text-[var(--at-text-tertiary)] at-text-caption" role="status">{labels.loading}</p>
      </section>
    );
  }

  if (model.tagOptions.length === 0) {
    return (
      <section className="at-panel p-5" aria-label={labels.title}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="at-weight-emphasis text-[var(--at-text-primary)] at-text-section-title">{labels.title}</h3>
          <QuietSegmentedFilter
            value={destinationMode}
            options={availableDestinationModes.map((value) => ({ value, label: value === "app" ? "应用" : value === "tag" ? "标签" : "网页" }))}
            onChange={onDestinationModeChange}
            ariaLabel="数据维度"
          />
        </div>
        <p className="mt-3 text-[var(--at-text-tertiary)] at-text-caption">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section className="at-panel p-5" aria-label={labels.title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="at-weight-emphasis text-[var(--at-text-primary)] at-text-section-title">{labels.title}</h3>
        <QuietSegmentedFilter
          value={destinationMode}
          options={availableDestinationModes.map((value) => ({ value, label: value === "app" ? "应用" : value === "tag" ? "标签" : "网页" }))}
          onChange={onDestinationModeChange}
          ariaLabel="数据维度"
        />
      </div>
      <input
        className="mt-3 w-full at-control"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索标签、应用或事项"
        aria-label="搜索标签、应用或事项"
      />
      <ul className="mt-3 divide-y divide-[var(--at-border-subtle)]">
        {options.length === 0 ? (
          <li className="py-3 text-[var(--at-text-tertiary)] at-text-caption">{labels.empty}</li>
        ) : options.map((tag) => (
          <li key={tag.key} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <strong className="min-w-0 break-words text-[var(--at-text-primary)]">#{tag.displayName}</strong>
              <span className="shrink-0 text-[var(--at-text-secondary)] at-text-caption">
                {labels.duration(tag.totalDuration)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[var(--at-text-tertiary)] at-text-caption">
              <span>{labels.applications(tag.appCount)}</span>
              <span>{labels.items(tag.itemCount)}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p className="min-w-0 break-words text-[var(--at-text-secondary)] at-text-caption">
                {tag.applications.length > 0
                  ? tag.applications.map((app) => app.name).join(", ")
                  : labels.noApplications}
              </p>
              <p className="min-w-0 break-words text-[var(--at-text-secondary)] at-text-caption">
                {tag.items.length > 0
                  ? tag.items.map((item) => item.name).join(", ")
                  : labels.noItems}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
