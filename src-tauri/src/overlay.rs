use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use tauri::PhysicalPosition;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(SubtitlePanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

pub fn setup_overlay(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("subtitle")
        .ok_or("找不到 subtitle 窗口")?;

    #[cfg(target_os = "macos")]
    {
        let panel = window
            .to_panel::<SubtitlePanel>()
            .map_err(|e| format!("转 panel 失败: {e}"))?;
        panel.set_level(PanelLevel::Floating.value());
        panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces()
                .into(),
        );
        panel.show();
    }

    #[cfg(target_os = "windows")]
    {
        position_windows_subtitle(&window)?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.set_decorations(false).map_err(|e| e.to_string())?;
        window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
        let _ = window.set_shadow(false);
    }

    window
        .set_ignore_cursor_events(true)
        .map_err(|e| format!("设置鼠标穿透失败: {e}"))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn position_windows_subtitle(window: &tauri::WebviewWindow) -> Result<(), String> {
    const BOTTOM_MARGIN: i32 = 32;

    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主显示器")?;
    let work_area = monitor.work_area();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = work_area.position.x
        + ((work_area.size.width as i32 - window_size.width as i32) / 2).max(0);
    let y = work_area.position.y
        + work_area.size.height as i32
        - window_size.height as i32
        - BOTTOM_MARGIN;

    window
        .set_position(PhysicalPosition::new(x, y.max(work_area.position.y)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_subtitle_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("subtitle")
        .ok_or("找不到 subtitle 窗口")?;
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}
