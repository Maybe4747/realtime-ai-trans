mod asr;
mod audio;
mod db;
mod overlay;
mod prompts;
mod tools;
mod translate;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            if let Err(e) = overlay::setup_overlay(app.handle()) {
                eprintln!("[overlay] 初始化失败: {e}");
            }
            if let Err(e) = db::init(app.handle()) {
                eprintln!("[db] 初始化失败: {e}");
            }
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[tray] 初始化失败: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::start_capture,
            audio::stop_capture,
            db::get_app_config,
            db::get_translation_history,
            db::save_app_config,
            overlay::set_subtitle_click_through,
            tools::process_audio_tool,
            tools::translate_text_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
