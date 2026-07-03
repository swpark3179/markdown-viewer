#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct MarkdownFile {
    path: String,
    name: String,
    content: String,
    size: u64,
    modified: Option<u64>,
}

#[derive(Serialize)]
struct FontInfo {
    family: String,
    source: String,
}

fn is_supported_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown" | "txt"))
        .unwrap_or(false)
}

fn normalize_path(path: PathBuf) -> Result<PathBuf, String> {
    if !is_supported_markdown_path(&path) {
        return Err("지원하지 않는 파일 형식입니다. .md, .markdown, .txt 파일만 열 수 있습니다.".into());
    }
    if !path.is_file() {
        return Err("파일을 찾을 수 없습니다.".into());
    }
    path.canonicalize().map_err(|e| e.to_string())
}

fn read_one(path: PathBuf) -> Result<MarkdownFile, String> {
    let path = normalize_path(path)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    Ok(MarkdownFile {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        content,
        size: metadata.len(),
        modified,
    })
}

fn filter_args(args: Vec<String>) -> Vec<String> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_supported_markdown_path(path))
        .filter_map(|path| path.canonicalize().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    read_one(PathBuf::from(path))
}

#[tauri::command]
fn read_markdown_files(paths: Vec<String>) -> Result<Vec<MarkdownFile>, String> {
    let mut docs = Vec::new();
    for path in paths {
        docs.push(read_one(PathBuf::from(path))?);
    }
    Ok(docs)
}

#[tauri::command]
fn startup_files() -> Vec<String> {
    filter_args(std::env::args().collect())
}

#[tauri::command]
fn list_system_fonts() -> Vec<FontInfo> {
    let mut families = BTreeSet::new();

    #[cfg(windows)]
    {
        collect_windows_fonts(&mut families);
    }

    if families.is_empty() {
        for family in [
            "Claude Serif",
            "Segoe UI",
            "Malgun Gothic",
            "Georgia",
            "Times New Roman",
            "Cambria",
            "Verdana",
            "Consolas",
        ] {
            families.insert(family.to_string());
        }
    }

    families
        .into_iter()
        .map(|family| FontInfo {
            family,
            source: "system".to_string(),
        })
        .collect()
}

#[cfg(windows)]
fn collect_windows_fonts(families: &mut BTreeSet<String>) {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    fn collect_from(root: RegKey, subkey: &str, families: &mut BTreeSet<String>) {
        if let Ok(key) = root.open_subkey(subkey) {
            for value in key.enum_values().flatten() {
                let raw_name = value.0;
                let family = raw_name
                    .split('(')
                    .next()
                    .unwrap_or(&raw_name)
                    .replace("&", "")
                    .trim()
                    .to_string();
                if !family.is_empty() {
                    families.insert(family);
                }
            }
        }
    }

    collect_from(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        families,
    );
    collect_from(
        RegKey::predef(HKEY_CURRENT_USER),
        "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        families,
    );
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let files = filter_args(args);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            read_markdown_files,
            startup_files,
            list_system_fonts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
