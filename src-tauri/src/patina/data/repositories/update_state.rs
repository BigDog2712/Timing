use crate::patina::data::repositories::tracker_settings;
use crate::patina::domain::settings::parse_boolean_setting;
use sqlx::{Pool, Sqlite};

const UPDATE_LAST_AUTO_CHECK_DAY_KEY: &str = "__update_last_auto_check_day";
const UPDATE_POST_INSTALL_REOPEN_MAIN_WINDOW_KEY: &str = "__update_post_install_reopen_main_window";

pub async fn load_last_auto_check_day(pool: &Pool<Sqlite>) -> Result<Option<String>, sqlx::Error> {
    tracker_settings::load_setting_value(pool, UPDATE_LAST_AUTO_CHECK_DAY_KEY).await
}

pub async fn save_last_auto_check_day(pool: &Pool<Sqlite>, day: &str) -> Result<(), sqlx::Error> {
    tracker_settings::save_setting_value(pool, UPDATE_LAST_AUTO_CHECK_DAY_KEY, day).await
}

pub async fn request_post_install_reopen_main_window(
    pool: &Pool<Sqlite>,
) -> Result<(), sqlx::Error> {
    tracker_settings::save_setting_value(pool, UPDATE_POST_INSTALL_REOPEN_MAIN_WINDOW_KEY, "1")
        .await
}

pub async fn clear_post_install_reopen_main_window(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    tracker_settings::save_setting_value(pool, UPDATE_POST_INSTALL_REOPEN_MAIN_WINDOW_KEY, "0")
        .await
}

pub async fn load_post_install_reopen_main_window(
    pool: &Pool<Sqlite>,
) -> Result<bool, sqlx::Error> {
    Ok(
        tracker_settings::load_setting_value(pool, UPDATE_POST_INSTALL_REOPEN_MAIN_WINDOW_KEY)
            .await?
            .map(|raw| parse_boolean_setting(&raw, false))
            .unwrap_or(false),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patina::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn auto_check_day_roundtrip() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert_eq!(load_last_auto_check_day(&pool).await.unwrap(), None);

            save_last_auto_check_day(&pool, "2026-04-13").await.unwrap();
            assert_eq!(
                load_last_auto_check_day(&pool).await.unwrap(),
                Some("2026-04-13".to_string())
            );
        });
    }

    #[test]
    fn post_install_reopen_main_window_roundtrip() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            assert!(!load_post_install_reopen_main_window(&pool).await.unwrap());

            request_post_install_reopen_main_window(&pool)
                .await
                .unwrap();
            assert!(load_post_install_reopen_main_window(&pool).await.unwrap());
            assert!(load_post_install_reopen_main_window(&pool).await.unwrap());

            clear_post_install_reopen_main_window(&pool).await.unwrap();
            assert!(!load_post_install_reopen_main_window(&pool).await.unwrap());
        });
    }
}
