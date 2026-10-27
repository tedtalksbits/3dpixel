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

// API keys (the PixelLab key) live in the OS keychain rather than in a file or localStorage.
const KEYCHAIN_SERVICE: &str = "com.tedtalksbits.3dpixel";

fn keychain(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match keychain(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(name: String, value: Option<String>) -> Result<(), String> {
    let entry = keychain(&name)?;
    match value.filter(|v| !v.is_empty()) {
        Some(v) => entry.set_password(&v).map_err(|e| e.to_string()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, launch_file, secret_get, secret_set])
        .run(tauri::generate_context!())
        .expect("error while running 3dpixel");
}
