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
