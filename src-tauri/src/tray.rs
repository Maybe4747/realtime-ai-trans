use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::audio;

const START_CAPTURE: &str = "tray_start_capture";
const STOP_CAPTURE: &str = "tray_stop_capture";
const SHOW_CONSOLE: &str = "tray_show_console";
const QUIT: &str = "tray_quit";

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let start = MenuItem::with_id(app, START_CAPTURE, "开始同传", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, STOP_CAPTURE, "停止同传", true, None::<&str>)?;
    let show = MenuItem::with_id(app, SHOW_CONSOLE, "打开控制台", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&start, &stop, &show, &separator, &quit])?;

    TrayIconBuilder::with_id("lumen")
        .icon(tauri::include_image!("icons/32x32.png"))
        .icon_as_template(true)
        .tooltip("LUMEN 实时双语字幕")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            START_CAPTURE => {
                if let Err(e) = audio::start_capture(app.clone()) {
                    audio::emit_capture_state(app, format!("错误: {e}"));
                    show_console(app);
                }
            }
            STOP_CAPTURE => {
                if let Err(e) = audio::stop_capture(app.clone()) {
                    audio::emit_capture_state(app, format!("错误: {e}"));
                    show_console(app);
                }
            }
            SHOW_CONSOLE => show_console(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn show_console(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
