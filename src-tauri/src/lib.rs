use std::env;
use tauri::Manager;
use tokio::spawn;

// Crate for this project
// Validation and database connections
use crate::database::{init, AppState};
mod database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Spawn the async database initialization
            // Calls database::init()
            spawn(async move {
                init(&app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database::authenticate,
            database::logout,
            database::get_all_watch_items,
            database::insert_watch_item,
            database::delete_watch_items
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}