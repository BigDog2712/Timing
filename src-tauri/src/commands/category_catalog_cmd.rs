//! 分类目录命令（[0.14] 两窗「事项分类选用」的读口）。
//!
//! ## 为什么是**宿主命令**而不是 insight 命令
//!
//! 分类真源在活动库 `patina.db` 的 settings KV，唯一的既有读口
//! `cmd_get_setting_rows` 带 `require_main_window` 守卫只放行分析窗；药丸窗的
//! capability 只挂 `host-commands` 段（`permissions/host-commands.toml`），一条
//! `cmd_*` 都没有 —— 药丸窗 invoke 必被 ACL 静默拒。放宽守卫（分析窗守卫是
//! 数据面的边界）或污染设置 DTO 都被否决，所以新增一条宿主命令走
//! `wait_for_sqlite_pool` 读同一张表。
//!
//! ## 哑管道纪律
//!
//! 只按前缀捞六组原始行，**不合并、不排序、不解析标签**：合并语义收敛在
//! `src/windows/shared/classification/categoryCatalog.ts`（两窗共用一份），
//! 标签由各窗注入各自的文案源。本文件加任何业务判断都是第二个真源。
//!
//! 错误口径沿用 insight 读命令的 `CommandErrorDto`（`SQLITE_UNAVAILABLE` 可重试 /
//! `SqliteOperationError` 收口），不走 `AppError`：不新增错误码。

use crate::commands::activity::error::CommandErrorDto;
use crate::models::category_catalog::{CategoryCatalogDto, CategorySettingRow};
use crate::services::activity::data::repositories::settings;
use crate::services::activity::data::sqlite_error::SqliteOperationError;
use crate::services::activity::data::sqlite_pool::wait_for_sqlite_pool;
use tauri::{AppHandle, Runtime};

/// 六组前缀。新增前缀必须同批改前端 `categoryCatalog.ts` 的 `CATALOG_PREFIXES`。
const CATALOG_PREFIXES: [(&str, &str); 6] = [
    ("definitions", "__custom_category::"),
    ("deleted", "__deleted_category::"),
    ("labelOverrides", "__category_label_override::"),
    ("colorOverrides", "__category_color_override::"),
    ("appOverrides", "__app_override::"),
    ("webOverrides", "__web_domain_override::"),
];

#[tauri::command]
pub async fn list_category_catalog<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CategoryCatalogDto, CommandErrorDto> {
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    let mut dto = CategoryCatalogDto::empty();
    for (field, prefix) in CATALOG_PREFIXES {
        let rows = settings::load_rows(&pool, None, Some(prefix))
            .await
            .map_err(|error| SqliteOperationError::from_sqlx("reading category catalog", error))?;
        let mapped: Vec<CategorySettingRow> = rows
            .into_iter()
            .map(|row| CategorySettingRow {
                key: row.key,
                value: row.value,
            })
            .collect();
        match field {
            "definitions" => dto.definitions = mapped,
            "deleted" => dto.deleted = mapped,
            "labelOverrides" => dto.label_overrides = mapped,
            "colorOverrides" => dto.color_overrides = mapped,
            "appOverrides" => dto.app_overrides = mapped,
            _ => dto.web_overrides = mapped,
        }
    }
    Ok(dto)
}
