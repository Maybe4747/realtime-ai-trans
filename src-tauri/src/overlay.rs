// Phase 0 · Spike B —— 全屏悬浮字幕窗
// 验证:字幕窗能浮在全屏 app 之上(NSPanel + collectionBehavior),且鼠标穿透。

use tauri::{AppHandle, Manager};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

tauri_panel! {
    panel!(SubtitlePanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

/// 把 subtitle 窗转成可浮于全屏之上的 non-activating 面板。
pub fn setup_overlay(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("subtitle")
        .ok_or("找不到 subtitle 窗口")?;

    let panel = window
        .to_panel::<SubtitlePanel>()
        .map_err(|e| format!("转 panel 失败: {e}"))?;

    // 浮动层级
    panel.set_level(PanelLevel::Floating.value());

    // non-activating:面板不抢焦点、不激活 app
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());

    // 关键:浮于全屏 app 之上 + 出现在所有 Space
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces()
            .into(),
    );

    panel.show();

    // 默认整窗鼠标穿透(spike 阶段)。点击直达底层视频。
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| format!("设置鼠标穿透失败: {e}"))?;

    Ok(())
}

/// 切换字幕窗鼠标穿透(true=穿透,点击直达视频;false=可交互/可拖)。
#[tauri::command]
pub fn set_subtitle_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("subtitle")
        .ok_or("找不到 subtitle 窗口")?;
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}
