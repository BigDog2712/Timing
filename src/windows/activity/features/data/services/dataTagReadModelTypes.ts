import type { DataAppTrendViewModel } from "./dataReadModel.ts";

export interface DataTagAssociationItem {
  id: number;
  name: string;
}

export interface DataTagAssociationApp {
  key: string;
  name: string;
}

export interface DataTagOption {
  key: string;
  displayName: string;
  color: string;
  totalDuration: number;
  percentage: number;
  appCount: number;
  itemCount: number;
  applications: DataTagAssociationApp[];
  items: DataTagAssociationItem[];
}

export interface DataTagReadModel {
  tagOptions: DataTagOption[];
  appOptions: DataAppTrendViewModel["appOptions"];
}
