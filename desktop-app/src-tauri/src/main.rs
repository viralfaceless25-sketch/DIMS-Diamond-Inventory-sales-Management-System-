#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use tauri::webview::NewWindowResponse;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(config::production_url()),
            )
            .title("Diamond Inventory")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1024.0, 700.0)
            // Tauri v2 defaults this to false — without it, Ctrl+=/Ctrl+-/
            // Ctrl+scroll do nothing in the installed app even though the
            // hosted page itself has no zoom-blocking code.
            .zoom_hotkeys_enabled(true)
            .on_navigation(config::is_allowed_navigation)
            .on_new_window(|url, _features| {
                if config::is_allowed_popup(&url) {
                    NewWindowResponse::Allow
                } else {
                    NewWindowResponse::Deny
                }
            })
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Diamond Inventory");
}
