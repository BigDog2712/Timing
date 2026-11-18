import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type {
  DataAppDayRow,
  DataAppTrendViewModel,
  DataDestinationTrendChartRow,
} from "./dataReadModel.ts";

export interface DataCategoryOption {
  category: AppCategory;
  sourceAppKeys: string[];
  displayName: string;
  color: string;
  appCount: number;
  totalDuration: number;
  percentage: number;
  averageDuration: number;
  activeDayCount: number;
}

export interface DataCategoryTrendViewModel {
  range: DataAppTrendViewModel["range"];
  rangeLabel: string;
  granularity: "day" | "month";
  categoryOptions: DataCategoryOption[];
  selectedCategories: DataCategoryOption[];
  selectedSourceAppKeys: string[];
  chartSeries: DataAppTrendViewModel["chartSeries"];
  chartRows: DataDestinationTrendChartRow[];
  summary: DataAppTrendViewModel["summary"];
  chartAxis: DataAppTrendViewModel["chartAxis"];
  peakDay: DataAppDayRow | null;
  activeDateKeys: string[];
}

export interface DataCategoryTrendBucket extends DataCategoryOption {
  dayDurations: Map<string, number>;
  monthDurations: Map<string, number>;
}
