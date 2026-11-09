use crate::services::insight::data::app_settings_service;
use crate::models::insight::settings::WebActivityBridgeSettings;
use crate::services::insight::engine::web_activity::WebActivityRuntimeState;
use crate::infra::insight::web_activity_bridge::{
    WebActivityBridgeHttpRequest, WebActivityBridgeHttpResponse, WebActivityBridgeRuntimeDeps,
    WebActivityBridgeRuntimeState,
};
use crate::models::insight::events::APP_SETTINGS_CHANGED;
use std::future::Future;
use std::pin::Pin;
use tauri::{AppHandle, Listener, Manager, Runtime};

pub fn start<R: Runtime + 'static>(app: AppHandle<R>) {
    if app.try_state::<WebActivityBridgeRuntimeState>().is_none() {
        crate::log_warn!("runtime state is not available");
        return;
    }

    spawn_settings_bootstrap(app.clone());
    register_event_handlers(app);
}

fn spawn_settings_bootstrap<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match load_web_activity_bridge_settings(&app).await {
            Ok(settings) => update_runtime_state(app, settings),
            Err(error) => crate::log_error!("failed to load settings: {error}"),
        }
    });
}

fn register_event_handlers<R: Runtime + 'static>(app: AppHandle<R>) {
    let settings_app = app.clone();
    app.listen_any(APP_SETTINGS_CHANGED, move |_| {
        let settings_app = settings_app.clone();
        tauri::async_runtime::spawn(async move {
            match load_web_activity_bridge_settings(&settings_app).await {
                Ok(settings) => update_runtime_state(settings_app, settings),
                Err(error) => {
                    crate::log_error!("failed to reload settings: {error}")
                }
            }
        });
    });
}

fn update_runtime_state<R: Runtime + 'static>(
    app: AppHandle<R>,
    settings: WebActivityBridgeSettings,
) {
    if let Some(state) = app.try_state::<WebActivityBridgeRuntimeState>() {
        let bridge_restarted = state.update(
            app.clone(),
            settings,
            WebActivityBridgeRuntimeDeps {
                handle_http_request: handle_http_request_boxed::<R>,
            },
        );
        if bridge_restarted {
            if let Some(web_activity_state) = app.try_state::<WebActivityRuntimeState>() {
                web_activity_state.reset_client();
            }
        }
    }
}

async fn load_web_activity_bridge_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivityBridgeSettings, String> {
    app_settings_service::load_web_activity_bridge_settings(app).await
}

fn handle_http_request_boxed<R: Runtime + 'static>(
    app: AppHandle<R>,
    request: WebActivityBridgeHttpRequest,
) -> Pin<Box<dyn Future<Output = WebActivityBridgeHttpResponse> + Send>> {
    Box::pin(crate::app::insight::web_activity::handle_http_request(app, request))
}
