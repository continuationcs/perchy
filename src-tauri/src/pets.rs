//! Pet discovery and sandboxed file access.
//!
//! A pet is a directory holding a Codex-compatible `pet.json` + spritesheet,
//! optionally extended by `perchy.json` (see docs/pet-format.md). Pets are
//! looked up in two roots:
//!   - `perchy`: <app data>/pets            — pets installed into Perchy
//!   - `codex`:  ${CODEX_HOME:-~/.codex}/pets — read in place, never modified
//!
//! The frontend addresses a pet by its key `"<source>:<dir name>"` and may only
//! read files inside that pet's directory.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PetEntry {
    pub key: String,
    pub id: String,
    pub display_name: String,
    pub source: &'static str,
    pub extended: bool,
}

/// Where Perchy installs pets.
pub fn perchy_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("pets"))
}

fn roots<R: Runtime>(app: &AppHandle<R>) -> Vec<(&'static str, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(dir) = perchy_root(app) {
        roots.push(("perchy", dir));
    }
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| app.path().home_dir().ok().map(|h| h.join(".codex")));
    if let Some(home) = codex_home {
        roots.push(("codex", home.join("pets")));
    }
    roots
}

/// A single path segment with no separators, `.`/`..`, or hidden prefix.
fn plain_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\'])
}

pub fn list<R: Runtime>(app: &AppHandle<R>) -> Vec<PetEntry> {
    let mut pets = Vec::new();
    for (source, root) in roots(app) {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for entry in dirs {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !plain_name(&name) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path().join("pet.json")) else { continue };
            let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            let id = manifest["id"].as_str().unwrap_or(&name).to_string();
            let display_name = manifest["displayName"].as_str().unwrap_or(&id).to_string();
            pets.push(PetEntry {
                key: format!("{source}:{name}"),
                id,
                display_name,
                source,
                extended: entry.path().join("perchy.json").is_file(),
            });
        }
    }
    pets
}

/// Resolve `path` inside the pet identified by `key`, refusing anything that
/// could escape the pet's directory (absolute paths, `..`, symlinks out).
fn resolve<R: Runtime>(app: &AppHandle<R>, key: &str, path: &str) -> Result<PathBuf, String> {
    let (source, name) = key.split_once(':').ok_or("bad pet key")?;
    if !plain_name(name) {
        return Err("bad pet key".into());
    }
    let root = roots(app)
        .into_iter()
        .find(|(s, _)| *s == source)
        .map(|(_, r)| r)
        .ok_or("unknown pet source")?;
    let rel = Path::new(path);
    if path.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("illegal path: {path}"));
    }
    let dir = root.join(name).canonicalize().map_err(|e| e.to_string())?;
    let file = dir.join(rel).canonicalize().map_err(|e| format!("{path}: {e}"))?;
    if !file.starts_with(&dir) {
        return Err(format!("illegal path: {path}"));
    }
    Ok(file)
}

#[tauri::command]
pub fn list_pets(app: AppHandle) -> Vec<PetEntry> {
    list(&app)
}

/// Raw bytes of a file inside a pet (arrives in JS as an ArrayBuffer).
#[tauri::command]
pub fn read_pet_file(app: AppHandle, key: String, path: String) -> Result<tauri::ipc::Response, String> {
    let file = resolve(&app, &key, &path)?;
    std::fs::read(file)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{path}: {e}"))
}
