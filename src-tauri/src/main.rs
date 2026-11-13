// Coquou — desktop pet runner (PoC)
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
mod migrate;
mod install;
mod pets;
mod screens;
mod settings;
mod system;
mod update;

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
#[derive(Default, Clone, PartialEq, Serialize)]
struct UiState {
    pet: String,
    size: String,
    zone: String,
    activity: String,
    sleep: String,
}

#[derive(Default)]
struct TrayState(Mutex<UiState>);

#[tauri::command]
fn report_ui_state(
    app: AppHandle,
    state: State<TrayState>,
    pet: String,
    size: String,
    zone: String,
    activity: String,
    sleep: String,
) {
    let next = UiState { pet, size, zone, activity, sleep };
    let changed = {
        let mut cur = state.0.lock().unwrap();
        let changed = *cur != next;
        *cur = next;
        changed
    };
    if changed {
        let ui = state.0.lock().unwrap().clone();
        println!(
            "[coquou] ui state: pet={} size={} zone={} activity={} sleep={}",
            ui.pet, ui.size, ui.zone, ui.activity, ui.sleep
        );
        refresh_tray(&app);
        let _ = app.emit("ui-state", ui);
    }
}

/// Current overlay choices, for the settings window.
#[tauri::command]
fn ui_state(state: State<TrayState>) -> UiState {
    state.0.lock().unwrap().clone()
}

/// Re-read the power source now (e.g. after toggling the battery saver).
fn refresh_power<R: Runtime>(app: &AppHandle<R>) {
    let battery = settings::get(app).battery_saver && system::on_battery();
    let state = app.state::<PowerState>();
    let mut power = state.0.lock().unwrap();
    if power.battery != battery {
        power.battery = battery;
        let _ = app.emit("power", power.clone());
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
                let prefs = settings::get(&app);
                let fullscreen = prefs.hide_fullscreen && rect.is_some_and(system::fullscreen_app_on);
                let battery = (tick % 30 == 0).then(|| prefs.battery_saver && system::on_battery());

                let state = app.state::<PowerState>();
                let mut power = state.0.lock().unwrap();
                let mut changed = false;
                if power.paused != fullscreen {
                    power.paused = fullscreen;
                    changed = true;
                    let _ = if fullscreen { window.hide() } else { window.show() };
                    println!("[coquou] {}", if fullscreen { "fullscreen app → hidden" } else { "shown again" });
                }
                if let Some(b) = battery {
                    if b != power.battery {
                        println!("[coquou] power source: {}", if b { "battery → 30 fps" } else { "AC" });
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

/// Tray menu: only quick actions; everything else lives in the app window.
/// Rebuilt when pets, the current pet or the update state change.
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let ui = app.try_state::<TrayState>().map(|s| s.0.lock().unwrap().clone()).unwrap_or_default();
    // "换宠物" lists the built-in cat plus every pet found on disk.
    let switcher = Submenu::with_id(app, "pets", "换宠物", true)?;
    let on = |key: &str| ui.pet == key;
    for pet in pets::list(app) {
        switcher.append(&CheckMenuItem::with_id(app, format!("pet:{}", pet.key), &pet.display_name, true, on(&pet.key), None::<&str>)?)?;
    }
    switcher.append(&CheckMenuItem::with_id(app, "pet:builtin", "团团", true, on("builtin"), None::<&str>)?)?;
    switcher.append(&PredefinedMenuItem::separator(app)?)?;
    switcher.append(&MenuItem::with_id(app, "library", "管理宠物…", true, None::<&str>)?)?;

    let sep = || PredefinedMenuItem::separator(app);
    let open = MenuItem::with_id(app, "open", "打开 Coquou", true, None::<&str>)?;
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = vec![Box::new(open)];
    if let Some(v) = update::available_version(app) {
        items.push(Box::new(MenuItem::with_id(app, "update", format!("有新版本 {v}，查看更新…"), true, None::<&str>)?));
    }
    items.push(Box::new(sep()?));
    items.push(Box::new(switcher));
    items.push(Box::new(MenuItem::with_id(app, "reset", "叫它回来", true, None::<&str>)?));
    items.push(Box::new(MenuItem::with_id(app, "sleep", "哄它睡觉", true, None::<&str>)?));
    items.push(Box::new(sep()?));
    items.push(Box::new(MenuItem::with_id(app, "quit", "退出 Coquou", true, None::<&str>)?));
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

fn open_pets_dir<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = pets::coquou_root(app) else { return };
    let _ = std::fs::create_dir_all(&dir);
    open_path(&dir);
}

/// Open a folder or URL with the system's default handler.
fn open_path(target: impl AsRef<std::ffi::OsStr>) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(target).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32").arg("url.dll,FileProtocolHandler").arg(target).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(target).spawn();
}

/// Project links shown in the app window (fixed list, nothing else opens).
#[tauri::command]
fn open_link(which: String) -> Result<(), String> {
    let url = match which.as_str() {
        "home" => "https://github.com/continuationcs/perchy",
        "issues" => "https://github.com/continuationcs/perchy/issues",
        "releases" => "https://github.com/continuationcs/perchy/releases",
        _ => return Err(format!("unknown link {which}")),
    };
    open_path(url);
    Ok(())
}

/// Show one pet's folder in Finder / Explorer.
#[tauri::command]
fn reveal_pet(app: AppHandle, key: String) -> Result<(), String> {
    let dir = pets::pet_dir(&app, &key)?;
    open_path(&dir);
    Ok(())
}

/// Delete a pet installed into Coquou (presets and Codex pets are read-only).
#[tauri::command]
fn delete_pet(app: AppHandle, key: String) -> Result<(), String> {
    if !key.starts_with("coquou:") {
        return Err("只能删除安装到 Coquou 的宠物".into());
    }
    let dir = pets::pet_dir(&app, &key)?;
    let root = pets::coquou_root(&app).and_then(|r| r.canonicalize().ok()).ok_or("找不到宠物文件夹")?;
    if dir.parent() != Some(root.as_path()) {
        return Err("宠物路径不对".into());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("删除失败：{e}"))?;
    println!("[coquou] deleted {key}");
    refresh_tray(&app);
    let _ = app.emit("pets-changed", serde_json::json!({ "removed": key }));
    Ok(())
}

/// Install a .pet / .zip picked in the app window (bytes arrive as the raw
/// request body, the file name in the `x-name` header).
#[tauri::command]
fn install_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<install::Installed, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| urlencoding_decode(v))
        .unwrap_or_else(|| "pet.pet".into());
    let ext = if name.to_lowercase().ends_with(".zip") { "zip" } else { "pet" };
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("import-{}.{ext}", std::process::id()));
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    let result = install_one(&app, &file);
    let _ = std::fs::remove_file(&file);
    if result.is_ok() {
        refresh_tray(&app);
    }
    result.map_err(|e| format!("{name}：{e}"))
}

/// Paths of the last drop on the app window.
#[derive(Default)]
struct Dropped(Mutex<Vec<PathBuf>>);

/// Install what was just dropped on the app window.
#[tauri::command]
fn install_dropped(app: AppHandle, dropped: State<Dropped>) {
    let paths = std::mem::take(&mut *dropped.0.lock().unwrap());
    install_paths(&app, paths);
}

/// Bytes of an image that was just dropped on the app window (hatch reference).
#[tauri::command]
fn read_dropped(dropped: State<Dropped>, path: String) -> Result<tauri::ipc::Response, String> {
    let file = dropped.0.lock().unwrap().iter().find(|p| p.display().to_string() == path).cloned().ok_or("不是刚拖进来的文件")?;
    let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 40 * 1024 * 1024 {
        return Err("图片太大或不是文件".into());
    }
    std::fs::read(&file).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Minimal %XX decoding for the file-name header.
fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Pet installed while the webview may not be listening yet (double-click
/// launch); the frontend picks it up with `take_pending_pet` at startup.
#[derive(Default)]
struct PendingPet(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_pet(state: State<PendingPet>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Install one pet and announce it (`pet-installed`); errors are returned.
fn install_one<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<install::Installed, String> {
    let done = install::install(app, path)?;
    println!("[coquou] installed {} from {}", done.key, path.display());
    *app.state::<PendingPet>().0.lock().unwrap() = Some(done.key.clone());
    let _ = app.emit("pet-installed", done.clone());
    Ok(done)
}

/// Install pets from dropped / opened paths, then tell the frontend.
fn install_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let mut any = false;
    for path in paths {
        match install_one(app, &path) {
            Ok(_) => any = true,
            Err(error) => {
                eprintln!("[coquou] install failed for {}: {error}", path.display());
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
/// coquou.json), then install it through the same validated path as a .pet.
#[tauri::command]
fn install_generated(
    app: AppHandle,
    id: String,
    display_name: String,
    description: String,
    spritesheet_png: String,
    coquou_json: Option<String>,
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
    if let Some(ext) = coquou_json {
        write("coquou.json", ext.as_bytes())?;
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
    println!("[coquou] exported {key} → {}", path.display());
    Ok(path.file_name().unwrap().to_string_lossy().into_owned())
}

/// Chinese app menu bar (shown while the hatch window makes Coquou a regular
/// app). The Edit menu keeps ⌘C / ⌘V working in text fields.
#[cfg(target_os = "macos")]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let sep = || PredefinedMenuItem::separator(app);
    let coquou = Submenu::with_items(app, "Coquou", true, &[
        &MenuItem::with_id(app, "menu-about", "关于 Coquou", true, None::<&str>)?,
        &sep()?,
        &MenuItem::with_id(app, "menu-settings", "设置…", true, Some("CmdOrCtrl+,"))?,
        &sep()?,
        &PredefinedMenuItem::hide(app, Some("隐藏 Coquou"))?,
        &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
        &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
        &sep()?,
        &PredefinedMenuItem::quit(app, Some("退出 Coquou"))?,
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
    Menu::with_items(app, &[&coquou, &edit, &window])
}

/// Tray and app-menu actions. Pet actions go to the overlay as `tray` events.
fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "quit" => app.exit(0),
        "open" => open_app(app, None),
        "library" => open_app(app, Some("pets")),
        "update" => open_app(app, Some("about")),
        "menu-settings" => open_app(app, Some("general")),
        "menu-about" => open_app(app, Some("about")),
        id => {
            let _ = app.emit("tray", id.to_string());
        }
    }
}

/// Tray icon: a monochrome template on macOS (adapts to the menu bar), the
/// coloured icon elsewhere.
fn tray_icon() -> tauri::image::Image<'static> {
    #[cfg(target_os = "macos")]
    let bytes: &[u8] = include_bytes!("../icons/tray-template.png");
    #[cfg(not(target_os = "macos"))]
    let bytes: &[u8] = include_bytes!("../icons/tray.png");
    tauri::image::Image::from_bytes(bytes).expect("tray icon")
}

/// Normal, focusable app windows (as opposed to the pet overlay).
const APP_WINDOWS: [&str; 1] = ["app"];

/// Show the window `label` if it exists, otherwise build it with `make`.
fn open_app_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    make: impl FnOnce(WebviewWindowBuilder<'_, R, AppHandle<R>>) -> WebviewWindowBuilder<'_, R, AppHandle<R>>,
) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // While one is open, show Coquou in the Dock / app switcher like a normal app.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(format!("{label}.html").into()));
    match make(builder).build() {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[coquou] cannot open {label} window: {e}"),
    }
}

/// The hatch page of the app window. The dev self-test needs a fresh window
/// (its config is injected at creation).
fn open_hatch<R: Runtime>(app: &AppHandle<R>, selftest: Option<serde_json::Value>) {
    match selftest {
        None => open_app(app, Some("hatch")),
        Some(cfg) => {
            if let Some(w) = app.get_webview_window("app") {
                let _ = w.destroy();
            }
            open_app_with(app, Some("hatch"), Some(format!("window.__COQUOU_SELFTEST__ = {cfg};")));
        }
    }
}

/// The app window ("Coquou"), optionally on a given page: pets, hatch,
/// behaviour, general, about. Files dropped on it are installed.
fn open_app<R: Runtime>(app: &AppHandle<R>, page: Option<&str>) {
    open_app_with(app, page, None);
}

fn open_app_with<R: Runtime>(app: &AppHandle<R>, page: Option<&str>, init: Option<String>) {
    if let (Some(page), Some(_)) = (page, app.get_webview_window("app")) {
        let _ = app.emit_to("app", "app-page", page);
    }
    let page = page.map(str::to_string);
    open_app_window(app, "app", move |b| {
        let b = match page {
            Some(p) => b.initialization_script(format!("window.__COQUOU_PAGE__ = {};", serde_json::json!(p))),
            None => b,
        };
        let b = match init {
            Some(js) => b.initialization_script(js),
            None => b,
        };
        let b = b.title("Coquou").inner_size(1000.0, 680.0).min_inner_size(780.0, 540.0);
        // Unified title bar: the sidebar runs up under the traffic lights.
        #[cfg(target_os = "macos")]
        let b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(18.0, 24.0));
        b
    });
}

#[tauri::command]
fn open_window(app: AppHandle, name: String) -> Result<(), String> {
    match name.as_str() {
        "hatch" => open_hatch(&app, None),
        "app" => open_app(&app, None),
        "pets-dir" => open_pets_dir(&app),
        _ => return Err(format!("unknown window {name}")),
    }
    Ok(())
}

fn argv_has(flag: &str) -> bool {
    std::env::args().any(|a| a == flag)
}

/// File arguments (Windows/Linux file association, or `coquou my.pet`).
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
            // Launching Coquou again (Start menu, Launchpad) opens its window.
            if paths.is_empty() {
                open_app(app, None);
            }
            install_paths(app, paths);
        }))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::UpdateState::default())
        .manage(PendingPet::default())
        .manage(Dropped::default())
        .manage(PowerState::default())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![
            cursor_local,
            set_passthrough,
            log,
            take_pending_pet,
            report_ui_state,
            ui_state,
            open_window,
            settings::get_settings,
            settings::set_setting,
            open_link,
            reveal_pet,
            delete_pet,
            install_bytes,
            install_dropped,
            read_dropped,
            update::update_status,
            update::update_check,
            update::update_install,
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
            // Back to a menu-bar-only app once the last app window closes.
            #[cfg(target_os = "macos")]
            if APP_WINDOWS.contains(&window.label()) && matches!(event, WindowEvent::Destroyed) {
                let app = window.app_handle();
                let others = APP_WINDOWS.iter().any(|l| *l != window.label() && app.get_webview_window(l).is_some());
                if !others {
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
            // Files dropped on the app window: the page decides (reference
            // image on the hatch page, otherwise install) via `install_dropped`
            // / `read_dropped`, which only accept these exact paths.
            if let (WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }), "app") = (event, window.label()) {
                let app = window.app_handle();
                *app.state::<Dropped>().0.lock().unwrap() = paths.clone();
                let list: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();
                let _ = app.emit_to("app", "app-drop", list);
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
            // One handler for both the tray menu and the macOS app menu
            // (a tray-specific handler would fire in addition to this one).
            app.on_menu_event(|app, event| on_menu(app, event.id.as_ref()));

            migrate::run(app.handle());
            settings::init(app.handle());

            let window = app.get_webview_window("main").expect("main window");
            screens::ensure_placement(&window);
            window.set_ignore_cursor_events(true)?;
            let _ = window.set_visible_on_all_workspaces(true);
            window.show()?;

            let tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon())
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Coquou")
                .menu(&build_menu(app.handle())?)
                // Windows convention: left click opens the app, right click the menu.
                .show_menu_on_left_click(!cfg!(target_os = "windows"))
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if cfg!(target_os = "windows") {
                            open_app(tray.app_handle(), None);
                        }
                    }
                });
            tray.build(app)?;

            let cwd = std::env::current_dir().unwrap_or_default();
            install_paths(app.handle(), path_args(std::env::args(), &cwd));
            if argv_has("--settings") || argv_has("--window") {
                open_app(app.handle(), None);
            }
            // `coquou --pet preset:qiqi` starts with (and remembers) that pet.
            let argv: Vec<String> = std::env::args().collect();
            if let Some(key) = argv.iter().position(|a| a == "--pet").and_then(|i| argv.get(i + 1)) {
                *app.state::<PendingPet>().0.lock().unwrap() = Some(key.clone());
            }
            watch(app.handle().clone());
            update::start(app.handle().clone());

            // Dev: `coquou --hatch-selftest <base url> <images|chat> [transparent] [persist]` runs the
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
        .expect("error while building Coquou");

    app.run(|app, event| {
        // macOS: clicking Coquou in Finder / Launchpad while it runs.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = &event {
            open_app(app, None);
        }
        // macOS delivers double-clicked files as an "open URLs" event.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            install_paths(app, paths);
        }
        let _ = (app, event);
    });
}
