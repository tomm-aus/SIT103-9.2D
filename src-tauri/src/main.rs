// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/* Program entry point */

#[tokio::main]
async fn main() {
    sit10392d_lib::run()
}
