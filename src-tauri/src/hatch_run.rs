//! On-disk state of an unfinished AI hatch, so closing the window (or a
//! crash) doesn't throw away images that were already paid for.
//!
//! <app data>/hatch-run/
//!   meta.json          inputs + per-row status (written by the frontend)
//!   <name>.png         reference, base and raw row sheets
//!
//! Only raw model output is stored; frames are re-derived from it on load.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("hatch-run")).map_err(|e| e.to_string())
}

/// `ref`, `base`, `row-<state id>`: letters, digits and dashes only.
fn checked(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty() && name.len() <= 40 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    ok.then_some(name).ok_or_else(|| format!("bad name: {name}"))
}

#[derive(Serialize)]
pub struct Run {
    meta: serde_json::Value,
    images: BTreeMap<String, String>,
}

#[tauri::command]
pub fn hatch_put_image(app: AppHandle, name: String, png: String) -> Result<(), String> {
    let d = dir(&app)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let bytes = B64.decode(png).map_err(|e| e.to_string())?;
    fs::write(d.join(format!("{}.png", checked(&name)?)), bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hatch_put_meta(app: AppHandle, meta: serde_json::Value) -> Result<(), String> {
    let d = dir(&app)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    fs::write(d.join("meta.json"), serde_json::to_vec_pretty(&meta).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hatch_load(app: AppHandle) -> Option<Run> {
    let d = dir(&app).ok()?;
    let meta: serde_json::Value = serde_json::from_slice(&fs::read(d.join("meta.json")).ok()?).ok()?;
    let mut images = BTreeMap::new();
    for entry in fs::read_dir(&d).ok()?.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "png") {
            if let (Some(stem), Ok(bytes)) = (path.file_stem(), fs::read(&path)) {
                images.insert(stem.to_string_lossy().into_owned(), B64.encode(bytes));
            }
        }
    }
    Some(Run { meta, images })
}

#[tauri::command]
pub fn hatch_clear(app: AppHandle) -> Result<(), String> {
    let d = dir(&app)?;
    if d.exists() {
        fs::remove_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(())
}
