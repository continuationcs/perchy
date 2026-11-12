// Perchy — desktop pet runner (PoC)
//
// One transparent, borderless, always-on-top, non-focusable window covers one
// display's work area (see screens.rs). The window ignores mouse events (clicks pass through
// to whatever is underneath) except while the cursor is over an opaque pixel
// of the pet. Because a click-through window receives no mouse events, the
// frontend polls the global cursor position through `cursor_local`, does the
// per-pixel hit test itself, and flips pass-through with `set_passthrough`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod hatch_run;
mod install;
mod pets;
mod screens;
mod system;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, DragDropEvent, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};

/// Cursor position in logical (CSS) pixels relative to the window's top-left.
#[tauri::command]
fn cursor_local(window: WebviewWindow) -> Option<(f64, f64)> {
    let cursor = window.cursor_position().ok()?;
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some((
        (cursor.x - origin.x as f64) / scale,
        (cursor.y - origin.y as f64) / scale,
    ))
}

/// `true` → clicks fall through to the windows below; `false` → we catch them.
#[tauri::command]
fn set_passthrough(window: WebviewWindow, enabled: bool) {
    let _ = window.set_ignore_cursor_events(enabled);
}

/// Forward webview console output to stdout (debugging without devtools).
#[tauri::command]
fn log(level: String, msg: String) {
    println!("[web:{level}] {msg}");
}

/// Paused = hidden because another app is fullscreen on our display.
#[derive(Default, Clone, Serialize)]
struct Power {
    paused: bool,
    battery: bool,
}

#[derive(Default)]
struct PowerState(Mutex<Power>);

#[tauri::command]
fn power_state(state: State<PowerState>) -> Power {
    state.0.lock().unwrap().clone()
}

/// What the overlay currently shows, so the tray can tick the right items.
/// The frontend owns these choices (they're remembered per pet) and reports
/// every change through `report_ui_state`.
#[derive(Default, Clone, PartialEq)]
struct UiState {
    pet: String,
    size: String,
    zone: String,
}

#[derive(Default)]
struct TrayState(Mutex<UiState>);

#[tauri::command]
fn report_ui_state(app: AppHandle, state: State<TrayState>, pet: String, size: String, zone: String) {
    let next = UiState { pet, size, zone };
    let changed = {
        let mut cur = state.0.lock().unwrap();
        let changed = *cur != next;
        *cur = next;
        changed
    };
    if changed {
        let ui = state.0.lock().unwrap().clone();
        println!("[perchy] tray state: pet={} size={} zone={}", ui.pet, ui.size, ui.zone);
        refresh_tray(&app);
    }
}

fn refresh_tray<R: Runtime>(app: &AppHandle<R>) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// 1 Hz watcher: keeps the overlay on the right display, hides it while
/// another app is fullscreen there, and reports battery power every 30 s.
fn watch<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        let mut displays = String::new();
        loop {
            if let Some(window) = app.get_webview_window("main") {
                let keys: Vec<String> = screens::list(&window).into_iter().map(|(k, _, _)| k).collect();
                let moved = screens::ensure_placement(&window);
                if moved || keys.join("|") != displays {
                    displays = keys.join("|");
                    refresh_tray(&app);
                }

                let rect = (|| {
                    let s = window.scale_factor().ok()?;
                    let p = window.outer_position().ok()?;
                    let z = window.outer_size().ok()?;
                    Some((p.x as f64 / s, p.y as f64 / s, z.width as f64 / s, z.height as f64 / s))
                })();
                let fullscreen = rect.is_some_and(system::fullscreen_app_on);
                let battery = (tick % 30 == 0).then(system::on_battery);

                let state = app.state::<PowerState>();
                let mut power = state.0.lock().unwrap();
                let mut changed = false;
                if power.paused != fullscreen {
                    power.paused = fullscreen;
                    changed = true;
                    let _ = if fullscreen { window.hide() } else { window.show() };
                    println!("[perchy] {}", if fullscreen { "fullscreen app → hidden" } else { "shown again" });
                }
                if let Some(b) = battery {
                    if b != power.battery {
                        println!("[perchy] power source: {}", if b { "battery → 30 fps" } else { "AC" });
                        power.battery = b;
                        changed = true;
                    }
                }
                if changed {
                    let _ = app.emit("power", power.clone());
                }
            }
            tick += 1;
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

/// Tray menu; rebuilt whenever a pet is installed so "换宠物" stays current.
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // "换宠物" lists the built-in cat plus every pet found on disk
    // (Perchy's own pets dir and the user's Codex pets).
    let ui = app.try_state::<TrayState>().map(|s| s.0.lock().unwrap().clone()).unwrap_or_default();
    let switcher = Submenu::with_id(app, "pets", "换宠物", true)?;
    let on = |key: &str| ui.pet == key;
    switcher.append(&CheckMenuItem::with_id(app, "pet:builtin", "团子猫（内置）", true, on("builtin"), None::<&str>)?)?;
    for pet in pets::list(app) {
        let tag = if pet.source == "codex" { " · Codex" } else { "" };
        let label = format!("{}{}", pet.display_name, tag);
        switcher.append(&CheckMenuItem::with_id(app, format!("pet:{}", pet.key), label, true, on(&pet.key), None::<&str>)?)?;
    }
    let displays = Submenu::with_id(app, "displays", "显示器", true)?;
    if let Some(window) = app.get_webview_window("main") {
        let current = screens::target(&window).map(|(k, _)| k);
        for (k, label, _) in screens::list(&window) {
            let checked = current.as_ref() == Some(&k);
            displays.append(&CheckMenuItem::with_id(app, format!("display:{k}"), label, true, checked, None::<&str>)?)?;
        }
    }
    // Size multiplier for the current pet (remembered per pet by the frontend).
    let size = Submenu::with_id(app, "size", "大小", true)?;
    for (id, label) in [("size:0.75", "小"), ("size:1", "标准"), ("size:1.3", "大"), ("size:1.6", "特大"), ("size:2", "超大")] {
        let checked = id == format!("size:{}", ui.size);
        size.append(&CheckMenuItem::with_id(app, id, label, true, checked, None::<&str>)?)?;
    }
    // Where the pet may roam (kept away from the middle of the screen by default).
    let zone = Submenu::with_id(app, "zone", "活动范围", true)?;
    for (id, label) in [
        ("zone:corners", "两边角落（默认）"),
        ("zone:right", "只在右下角"),
        ("zone:left", "只在左下角"),
        ("zone:full", "整个屏幕底部"),
    ] {
        let checked = id == format!("zone:{}", ui.zone);
        zone.append(&CheckMenuItem::with_id(app, id, label, true, checked, None::<&str>)?)?;
    }
    Menu::with_items(
        app,
        &[
            &switcher,
            &size,
            &zone,
            &displays,
            &MenuItem::with_id(app, "hatch", "孵化新宠物（AI）…", true, None::<&str>)?,
            &MenuItem::with_id(app, "export", "导出当前宠物为 .pet", true, None::<&str>)?,
            &MenuItem::with_id(app, "open-pets-dir", "打开宠物文件夹", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "reset", "把它叫回来", true, None::<&str>)?,
            &MenuItem::with_id(app, "sleep", "哄它睡觉", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "退出 Perchy", true, None::<&str>)?,
        ],
    )
}

fn open_pets_dir<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = pets::perchy_root(app) else { return };
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
}

/// Pet installed while the webview may not be listening yet (double-click
/// launch); the frontend picks it up with `take_pending_pet` at startup.
#[derive(Default)]
struct PendingPet(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_pet(state: State<PendingPet>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Install pets from dropped / opened paths, then tell the frontend.
fn install_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let mut any = false;
    for path in paths {
        match install::install(app, &path) {
            Ok(done) => {
                println!("[perchy] installed {} from {}", done.key, path.display());
                *app.state::<PendingPet>().0.lock().unwrap() = Some(done.key.clone());
                let _ = app.emit("pet-installed", done);
                any = true;
            }
            Err(error) => {
                eprintln!("[perchy] install failed for {}: {error}", path.display());
                let _ = app.emit("pet-install-failed", serde_json::json!({
                    "file": path.file_name().map(|n| n.to_string_lossy().into_owned()),
                    "error": error,
                }));
            }
        }
    }
    if any {
        refresh_tray(app);
    }
}

/// Save a pet assembled by the hatch window (Codex v2 PNG atlas + optional
/// perchy.json), then install it through the same validated path as a .pet.
#[tauri::command]
fn install_generated(
    app: AppHandle,
    id: String,
    display_name: String,
    description: String,
    spritesheet_png: String,
    perchy_json: Option<String>,
) -> Result<install::Installed, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!("hatched-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest = serde_json::json!({
        "id": id,
        "displayName": display_name,
        "description": description,
        "spriteVersionNumber": 2,
        "spritesheetPath": "spritesheet.png",
    });
    let write = |name: &str, bytes: &[u8]| std::fs::write(dir.join(name), bytes).map_err(|e| e.to_string());
    write("pet.json", serde_json::to_string_pretty(&manifest).unwrap().as_bytes())?;
    write("spritesheet.png", &B64.decode(spritesheet_png).map_err(|e| e.to_string())?)?;
    if let Some(ext) = perchy_json {
        write("perchy.json", ext.as_bytes())?;
    }
    let result = install::install(&app, &dir);
    let _ = std::fs::remove_dir_all(&dir);
    let done = result?;
    *app.state::<PendingPet>().0.lock().unwrap() = Some(done.key.clone());
    let _ = app.emit("pet-installed", done.clone());
    refresh_tray(&app);
    Ok(done)
}

/// Export a pet as `<Downloads>/<id>.pet` and reveal it in Finder / Explorer.
#[tauri::command]
fn export_pet(app: AppHandle, key: String) -> Result<String, String> {
    let path = install::export(&app, &key)?;
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
    println!("[perchy] exported {key} → {}", path.display());
    Ok(path.file_name().unwrap().to_string_lossy().into_owned())
}

/// Chinese app menu bar (shown while the hatch window makes Perchy a regular
/// app). The Edit menu keeps ⌘C / ⌘V working in text fields.
#[cfg(target_os = "macos")]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let sep = || PredefinedMenuItem::separator(app);
    let perchy = Submenu::with_items(app, "Perchy", true, &[
        &PredefinedMenuItem::about(app, Some("关于 Perchy"), None)?,
        &sep()?,
        &PredefinedMenuItem::hide(app, Some("隐藏 Perchy"))?,
        &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
        &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
        &sep()?,
        &PredefinedMenuItem::quit(app, Some("退出 Perchy"))?,
    ])?;
    let edit = Submenu::with_items(app, "编辑", true, &[
        &PredefinedMenuItem::undo(app, Some("撤销"))?,
        &PredefinedMenuItem::redo(app, Some("重做"))?,
        &sep()?,
        &PredefinedMenuItem::cut(app, Some("剪切"))?,
        &PredefinedMenuItem::copy(app, Some("拷贝"))?,
        &PredefinedMenuItem::paste(app, Some("粘贴"))?,
        &PredefinedMenuItem::select_all(app, Some("全选"))?,
    ])?;
    let window = Submenu::with_items(app, "窗口", true, &[
        &PredefinedMenuItem::minimize(app, Some("最小化"))?,
        &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
    ])?;
    Menu::with_items(app, &[&perchy, &edit, &window])
}

/// The "孵化新宠物" window (a normal, focusable app window).
fn open_hatch<R: Runtime>(app: &AppHandle<R>, selftest: Option<serde_json::Value>) {
    if let Some(w) = app.get_webview_window("hatch") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // While it is open, show Perchy in the Dock / app switcher like a normal app.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    let mut builder = WebviewWindowBuilder::new(app, "hatch", WebviewUrl::App("hatch.html".into()))
        // Let the page receive HTML5 file drops (reference image) instead of
        // the native handler.
        .disable_drag_drop_handler();
    if let Some(cfg) = selftest {
        builder = builder.initialization_script(format!("window.__PERCHY_SELFTEST__ = {cfg};"));
    }
    match builder
        .title("孵化新宠物 · Perchy")
        .inner_size(1040.0, 780.0)
        .min_inner_size(820.0, 600.0)
        .build()
    {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[perchy] cannot open hatch window: {e}"),
    }
}

/// File arguments (Windows/Linux file association, or `perchy my.pet`).
fn path_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .filter(|p| p.exists())
        .collect()
}

fn main() {
    let app = tauri::Builder::default()
        // A second launch (double-clicking a .pet on Windows) forwards its
        // arguments here instead of starting another pet.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = path_args(argv, Path::new(&cwd));
            install_paths(app, paths);
        }))
        .manage(PendingPet::default())
        .manage(PowerState::default())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![
            cursor_local,
            set_passthrough,
            log,
            take_pending_pet,
            report_ui_state,
            export_pet,
            hatch_run::hatch_put_image,
            hatch_run::hatch_put_meta,
            hatch_run::hatch_load,
            hatch_run::hatch_clear,
            install_generated,
            ai::ai_profiles,
            ai::ai_save_profile,
            ai::ai_delete_profile,
            ai::ai_generate,
            power_state,
            screens::follow_cursor_monitor,
            pets::list_pets,
            pets::read_pet_file
        ])
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "hatch" && matches!(event, WindowEvent::Destroyed) {
                let _ = window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            // Drops only reach us while the cursor is over the pet (elsewhere
            // the window is click-through), so this is "feeding" it a file.
            if let (WindowEvent::DragDrop(drop), "main") = (event, window.label()) {
                let app = window.app_handle();
                match drop {
                    DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => {
                        let _ = app.emit("drop-hover", true);
                    }
                    DragDropEvent::Leave => {
                        let _ = app.emit("drop-hover", false);
                    }
                    DragDropEvent::Drop { paths, .. } => {
                        let _ = app.emit("drop-hover", false);
                        install_paths(app, paths.clone());
                    }
                    _ => {}
                }
            }
        })
        .setup(|app| {
            // No Dock icon on macOS: the pet lives in the menu-bar tray only.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            #[cfg(target_os = "macos")]
            app.set_menu(app_menu(app.handle())?)?;

            let window = app.get_webview_window("main").expect("main window");
            screens::ensure_placement(&window);
            window.set_ignore_cursor_events(true)?;
            let _ = window.set_visible_on_all_workspaces(true);
            window.show()?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Perchy")
                .menu(&build_menu(app.handle())?)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "open-pets-dir" => open_pets_dir(app),
                    "hatch" => open_hatch(app, None),
                    id if id.starts_with("display:") => {
                        if let Some(window) = app.get_webview_window("main") {
                            screens::choose(&window, &id["display:".len()..]);
                            refresh_tray(app);
                        }
                    }
                    id => {
                        let _ = app.emit("tray", id.to_string());
                    }
                })
                .build(app)?;

            let cwd = std::env::current_dir().unwrap_or_default();
            install_paths(app.handle(), path_args(std::env::args(), &cwd));
            watch(app.handle().clone());

            // Dev: `perchy --hatch-selftest <base url> <images|chat> [transparent] [persist]` runs the
            // hatch flow end-to-end against a mock API (tools/mock-image-api.py).
            let args: Vec<String> = std::env::args().collect();
            if let Some(i) = args.iter().position(|a| a == "--hatch-selftest") {
                let cfg = serde_json::json!({
                    "selftest": args.get(i + 1).cloned().unwrap_or_default(),
                    "protocol": args.get(i + 2).cloned().unwrap_or_else(|| "images".into()),
                    "transparent": args.iter().skip(i + 3).any(|a| a == "transparent"),
                    "persist": args.iter().skip(i + 3).any(|a| a == "persist"),
                });
                open_hatch(app.handle(), Some(cfg));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Perchy");

    app.run(|app, event| {
        // macOS delivers double-clicked files as an "open URLs" event.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            install_paths(app, paths);
        }
        let _ = (app, event);
    });
}
