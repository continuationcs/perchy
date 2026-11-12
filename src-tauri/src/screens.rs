//! Which display the pet lives on.
//!
//! The overlay covers exactly one display's work area (macOS gives each display
//! its own Spaces, so one window can't span several). The choice is saved in
//! <app config>/settings.json by display name and survives restarts; if that
//! display is unplugged the pet falls back to the primary one and returns
//! when it comes back.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    monitor: Option<String>,
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    if let Some(path) = settings_path(app) {
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        let _ = std::fs::write(path, serde_json::to_string_pretty(settings).unwrap());
    }
}

/// Stable-ish identity: the OS display name, or its index when unnamed.
fn key(m: &Monitor, index: usize) -> String {
    m.name().cloned().unwrap_or_else(|| format!("显示器 {}", index + 1))
}

fn same(a: &Monitor, b: &Monitor) -> bool {
    a.position() == b.position() && a.size() == b.size()
}

/// All displays as (key, label, monitor); the label marks the primary one.
pub fn list<R: Runtime>(window: &WebviewWindow<R>) -> Vec<(String, String, Monitor)> {
    let primary = window.primary_monitor().ok().flatten();
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let k = key(&m, i);
            let main = primary.as_ref().is_some_and(|p| same(p, &m));
            let size = m.size();
            let label = format!("{k}（{}×{}{}）", size.width, size.height, if main { "，主显示器" } else { "" });
            (k, label, m)
        })
        .collect()
}

/// The display the pet should be on right now, and its key.
pub fn target<R: Runtime>(window: &WebviewWindow<R>) -> Option<(String, Monitor)> {
    let monitors = list(window);
    let wanted = load(window.app_handle()).monitor;
    if let Some(found) = monitors.iter().find(|(k, _, _)| Some(k) == wanted.as_ref()) {
        return Some((found.0.clone(), found.2.clone()));
    }
    let primary = window.primary_monitor().ok().flatten();
    monitors
        .iter()
        .find(|(_, _, m)| primary.as_ref().is_some_and(|p| same(p, m)))
        .or(monitors.first())
        .map(|(k, _, m)| (k.clone(), m.clone()))
}

/// Move/resize the overlay onto the target display's work area if it isn't
/// already there (handles hot-plug, resolution and Dock/taskbar changes).
/// Returns true when the window was changed.
pub fn ensure_placement<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let Some((_, monitor)) = target(window) else { return false };
    let area = monitor.work_area();
    let pos = PhysicalPosition::new(area.position.x, area.position.y);
    let size = PhysicalSize::new(area.size.width, area.size.height);
    let here = window.outer_position().ok() == Some(pos) && window.outer_size().ok() == Some(size);
    if here {
        return false;
    }
    let _ = window.set_position(pos);
    let _ = window.set_size(size);
    true
}

pub fn choose<R: Runtime>(window: &WebviewWindow<R>, monitor_key: &str) {
    save(window.app_handle(), &Settings { monitor: Some(monitor_key.to_string()) });
    ensure_placement(window);
}

/// If the cursor is on another display than the pet's, move the pet there
/// (dragging the pet across screens). Returns true when it moved.
#[tauri::command]
pub fn follow_cursor_monitor(window: WebviewWindow) -> bool {
    let Ok(cursor) = window.cursor_position() else { return false };
    let monitors = list(&window);
    let under = monitors.iter().find(|(_, _, m)| {
        let (p, s) = (m.position(), m.size());
        cursor.x >= p.x as f64
            && cursor.x < p.x as f64 + s.width as f64
            && cursor.y >= p.y as f64
            && cursor.y < p.y as f64 + s.height as f64
    });
    match (under, target(&window)) {
        (Some((k, _, _)), Some((current, _))) if *k != current => {
            choose(&window, k);
            true
        }
        _ => false,
    }
}
