//! 窗口 / 系统域命令。
//!
//! V0.3.3：`set_always_on_top`（窗口置顶开关）与 `register_shortcut`（全局快捷键）
//! 随对应功能整体下架，详见 `docs/decisions/ADR-022.md`。窗口置顶改为恒定行为
//! （`infra::window_spec` 的 `always_on_top` 全为 true，主窗由 `tauri.conf.json` 声明）。

use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::infra::window;
use crate::models::common::{WindowRectDip, WorkAreaDip};
use crate::platform::boot_timing;
use crate::services;
use crate::state::AppState;

/// 显示主窗。
///
/// 这里同时是「首帧可见」的观测点（T17）：主窗以 `visible:false` 启动防白闪（K-1），
/// 前端在 DOM 至少画过一帧后才调它，所以这一次调用 ≈ 用户真正看见界面的时刻。
/// 打点 + 汇总都是幂等的，托盘重复调用不会重复记样本。
#[tauri::command]
pub async fn show_window(app: AppHandle) -> AppResult<()> {
    boot_timing::mark("first_frame");
    boot_timing::report("first_frame");
    window::show_main(&app)
}

/// 主窗所在显示器的工作区（DIP）。前端 auto-fit 拿它当布局上界（ADR-020）：
/// 删掉写死的 384×360 画布后，浮层能占多大空间由当前屏幕决定，而不是常量。
#[tauri::command]
pub async fn main_work_area(app: AppHandle) -> AppResult<WorkAreaDip> {
    window::main_work_area_dip(&app)
}

/// 主条（小条）当前矩形（DIP）。便利贴等浮层据此「默认落在小条附近」——
/// 发起建窗的可能是别的窗口，所以基准必须由后端给出，不能取当前窗。
#[tauri::command]
pub async fn main_window_rect(app: AppHandle) -> AppResult<WindowRectDip> {
    window::main_window_rect_dip(&app)
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> AppResult<()> {
    window::hide_main(&app)
}

#[tauri::command]
pub async fn toggle_window(app: AppHandle) -> AppResult<()> {
    window::toggle(&app)
}

#[tauri::command]
pub async fn save_window_position(state: State<'_, AppState>, x: f64, y: f64) -> AppResult<()> {
    services::settings::set_window_position(&state.pool, x, y).await
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

/* ── [0.13] 手柄自定义动作：启动应用 / 发送快捷键 ───────────────────────────────
 *
 * 一条命令两个分支，而不是两条命令：两者都只做「执行一次系统动作」，
 * 拆成两条会让契约面 +1 却没有换来任何独立性（前端永远只会二选一调用）。
 *
 * `deny_unknown_fields` 不是洁癖：这个载荷直接决定「跑哪个程序」，多出来的字段
 * 意味着前端与本文件对形状的理解已经分叉 —— 宁可拒绝执行，也不要猜着执行。
 *
 * ## [R1] 两条分支都是**闸门**，不是「把前端算好的东西执行掉」
 *
 * 这个载荷来自 IPC，而 IPC 不是可信输入：markdown 渲染、窗口标题、ingest 进来的
 * 网页标题都是攻击者可控的字面量。前端 `dispatch.ts` 里的校验只是**提示**，
 * 绕过它只需要一次直接调用。所以：
 *
 *  - `Launch` 只认**用户亲自在原生对话框里确认过**的路径（`services::handle_launch`
 *    的授权名单），未授权一律 `CUSTOM_ACTION_DENIED`；
 *  - `Hotkey` 的后端校验在 `infra::hotkey_send::validate`（必须有修饰键 / 恰好 1 个
 *    主键 / 禁止 Win 键）—— 那是本功能唯一的完整 RCE 路径（`Win+R` → 敲命令）。
 */
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum HandleCustomAction {
    /// 启动一个用户亲手选中的文件（`.exe` / `.lnk` / 文档，语义 = 双击）
    Launch { path: String },
    /// 向当前前台窗口发送组合键；`vks` 是**已排好序**的 VK 序列（修饰键在前）
    Hotkey { vks: Vec<u16> },
}

/// 弹原生对话框让用户选一个可执行文件，选中后**由后端**写进授权名单。
///
/// 为什么选路径这件事必须发生在后端：只有「用户在一次原生交互里点了确认」才能作为
/// 授权事实。前端拿到路径后能自由改写（它是普通字符串），后端拿到的就只是「某个
/// 字符串声称自己是用户选的」—— 那样等于没有名单。
///
/// 取消返回 `None`（不是错误）：用户合上对话框是正常操作。
#[tauri::command]
pub async fn pick_custom_launch_target(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择要启动的程序")
            .pick_file()
            .map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| AppError::io(format!("打开文件选择器失败: {err}")))?;
    let Some(path) = picked else { return Ok(None) };
    services::handle_launch::authorize(&state.pool, &path).await.map(Some)
}

#[tauri::command]
pub async fn run_handle_custom_action(
    state: State<'_, AppState>,
    action: HandleCustomAction,
) -> AppResult<()> {
    match action {
        HandleCustomAction::Launch { path } => {
            /* 授权检查在 `launch` 之前：`launch` 会真的 spawn，先检查后执行没有中间态。 */
            if !services::handle_launch::is_authorized(&state.pool, &path).await? {
                return Err(AppError::custom_action_denied(
                    "这个程序没有经过授权，请在设置里重新选择一次",
                ));
            }
            crate::infra::shell_open::launch(std::path::Path::new(&path)).map_err(AppError::io)
        }
        HandleCustomAction::Hotkey { vks } => {
            /* 后端闸门（前端那份只是提示）。校验失败是**载荷不合法**，不是 IO 故障 ——
               归到 `CUSTOM_ACTION_DENIED`，否则用户会去查系统权限。 */
            crate::infra::hotkey_send::validate(&vks)
                .map_err(AppError::custom_action_denied)?;
            crate::infra::hotkey_send::send(&vks).map_err(AppError::io)
        }
    }
}
