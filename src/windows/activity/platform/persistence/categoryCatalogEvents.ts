import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const CATEGORY_CATALOG_CHANGED = "category-catalog:changed";

export function subscribeCategoryCatalogChanged(listener: () => void): Promise<UnlistenFn> {
  return listen(CATEGORY_CATALOG_CHANGED, () => listener());
}
