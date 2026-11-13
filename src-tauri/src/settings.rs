//! App-level settings owned by Rust, saved in <app config>/settings.json.
//!
//! Per-pet and behaviour choices (current pet, size, zone, activity, sleep)
//! belong to the overlay frontend and live in its localStorage; it reports
//! them through `report_ui_state` (main.rs) so the tray and the settings
//! window can show them.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Display the pet lives on (see screens.rs); None = primary.
    #[serde(default)]
    pub monitor: Option<String>,
    /// Hide while another app is fullscreen on the pet's display.
    #[serde(default = "yes")]
    pub hide_fullscreen: bool,
    /// Drop to 30 fps on battery power.
    #[serde(default = "yes")]
    pub battery_saver: bool,
    /// Check GitHub for new versions in the background (update.rs).
    #[serde(default = "yes")]
    pub auto_update: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { monitor: None, hide_fullscreen: true, battery_saver: true, auto_update: true }
    }
}

pub struct SettingsState(Mutex<Settings>);

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let settings = path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    app.manage(SettingsState(Mutex::new(settings)));
}

pub fn get<R: Runtime>(app: &AppHandle<R>) -> Settings {
    app.try_state::<SettingsState>().map(|s| s.0.lock().unwrap().clone()).unwrap_or_default()
}

/// Change, save, and tell every window (`settings-changed`).
pub fn update<R: Runtime>(app: &AppHandle<R>, change: impl FnOnce(&mut Settings)) {
    let Some(state) = app.try_state::<SettingsState>() else { return };
    let next = {
        let mut s = state.0.lock().unwrap();
        change(&mut s);
        s.clone()
    };
    if let Some(p) = path(app) {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, serde_json::to_string_pretty(&next).unwrap());
    }
    let _ = app.emit("settings-changed", ());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    key: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    /// The display the pet is on right now (may differ from `monitor` when
    /// that one is unplugged).
    current_display: Option<String>,
    displays: Vec<Display>,
    autostart: bool,
    version: String,
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> SettingsView {
    let (displays, current_display) = match app.get_webview_window("main") {
        Some(w) => (
            crate::screens::list(&w).into_iter().map(|(key, label, _)| Display { key, label }).collect(),
            crate::screens::target(&w).map(|(k, _)| k),
        ),
        None => (Vec::new(), None),
    };
    SettingsView {
        settings: get(&app),
        current_display,
        displays,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        version: app.package_info().version.to_string(),
    }
}

/// `name` is one of: hideFullscreen, batterySaver, autoUpdate, autostart (bool) or
/// display (string key).
#[tauri::command]
pub fn set_setting(app: AppHandle, name: String, value: serde_json::Value) -> Result<(), String> {
    match name.as_str() {
        "hideFullscreen" => {
            let on = value.as_bool().ok_or("expected a boolean")?;
            update(&app, |s| s.hide_fullscreen = on);
        }
        "batterySaver" => {
            let on = value.as_bool().ok_or("expected a boolean")?;
            update(&app, |s| s.battery_saver = on);
            crate::refresh_power(&app);
        }
        "autoUpdate" => {
            let on = value.as_bool().ok_or("expected a boolean")?;
            update(&app, |s| s.auto_update = on);
        }
        "autostart" => {
            let on = value.as_bool().ok_or("expected a boolean")?;
            let auto = app.autolaunch();
            if on { auto.enable() } else { auto.disable() }.map_err(|e| e.to_string())?;
            let _ = app.emit("settings-changed", ());
        }
        "display" => {
            let key = value.as_str().ok_or("expected a display key")?;
            let window = app.get_webview_window("main").ok_or("no overlay window")?;
            crate::screens::choose(&window, key);
            crate::refresh_tray(&app);
        }
        _ => return Err(format!("unknown setting {name}")),
    }
    Ok(())
}
