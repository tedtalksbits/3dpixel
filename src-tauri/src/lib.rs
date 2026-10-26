use std::fs;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};

// The editor reads and writes files the user picked, plus export targets saved in the project,
// so file access is plain std::fs rather than the scoped fs plugin. File bytes travel as raw IPC
// bodies; the path goes in a percent-encoded header.

fn header_path(request: &Request) -> Result<PathBuf, String> {
    let raw = request
        .headers()
        .get("path")
        .ok_or("missing path header")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = urlencoding::decode(raw).map_err(|e| e.to_string())?;
    Ok(PathBuf::from(path.into_owned()))
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_file(request: Request) -> Result<(), String> {
    let path = header_path(&request)?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw file bytes".into());
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::write(&path, data).map_err(|e| format!("{}: {e}", path.display()))
}

/// The file the app was launched with, e.g. by double-clicking a .kenshape in Explorer.
#[tauri::command]
fn launch_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && PathBuf::from(a).is_file())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, launch_file])
        .run(tauri::generate_context!())
        .expect("error while running 3dpixel");
}
