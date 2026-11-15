/**
 * [0.14] 分类目录（`list_category_catalog` 出参）—— **哑管道**的六组原始 KV 行。
 *
 * 合并 / 排序 / 标签解析收敛在 `src/windows/shared/classification/categoryCatalog.ts`
 * （两窗共用一份），这里只描述传输形状，与 Rust `models/category_catalog.rs` 逐字对齐。
 */

/** settings KV 的一行（key 带各自前缀原样透传，前端按前缀自己切） */
export interface CategorySettingRow {
  key: string;
  value: string;
}

/** 六组原始行；手机端桩回全空数组 */
export interface CategoryCatalogRows {
  definitions: CategorySettingRow[];
  deleted: CategorySettingRow[];
  labelOverrides: CategorySettingRow[];
  colorOverrides: CategorySettingRow[];
  appOverrides: CategorySettingRow[];
  webOverrides: CategorySettingRow[];
}
