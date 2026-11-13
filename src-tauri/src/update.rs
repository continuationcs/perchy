//! Self-update through tauri-plugin-updater.
//!
//! Releases live on GitHub (see tools/release.py): every release carries a
//! `latest.json` describing the newest version per platform, and the plugin
//! verifies each download against the public key in tauri.conf.json.
//!
//! Flow: check 20 s after start and every 6 h (setting `autoUpdate`), or when
//! the user presses 「检查更新」. A found update is announced (tray item,
//! settings window, a bubble from the pet); nothing installs until the user
//! clicks 「更新并重启」.
//!
//! Dev: `COQUOU_UPDATE_URL=http://127.0.0.1:8765/latest.json` points the
//! updater at a local server (plain http only works in debug builds).

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    current: String,
    available: Option<Available>,
    checking: bool,
    installing: bool,
    /// Unix seconds of the last finished check.
    last_checked: Option<u64>,
    last_error: Option<String>,
}

#[derive(Default)]
pub struct UpdateState {
    status: Mutex<Status>,
    pending: Mutex<Option<Update>>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> Status {
    let state = app.state::<UpdateState>();
    let mut s = state.status.lock().unwrap().clone();
    s.current = app.package_info().version.to_string();
    s
}

/// Version string of an update waiting to be installed, for the tray.
pub fn available_version<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.try_state::<UpdateState>()?.status.lock().unwrap().available.as_ref().map(|a| a.version.clone())
}

fn set<R: Runtime>(app: &AppHandle<R>, change: impl FnOnce(&mut Status)) {
    {
        let state = app.state::<UpdateState>();
        let mut s = state.status.lock().unwrap();
        change(&mut s);
    }
    let _ = app.emit("update-status", status(app));
}

/// Updater errors in plain Chinese (the raw text goes to the log).
fn friendly(raw: &str) -> String {
    let e = raw.to_lowercase();
    let msg = if e.contains("signature") {
        "更新包的签名校验没通过，为安全起见没有安装。请稍后再试，或到发布页手动下载。"
    } else if e.contains("platform") && (e.contains("not found") || e.contains("missing")) {
        "这次发布还没有适合你电脑的安装包，请过一阵再检查。"
    } else if e.contains("timed out") || e.contains("timeout") {
        "连接 GitHub 超时了，请检查网络后再试。"
    } else if e.contains("dns") || e.contains("connect") || e.contains("network") || e.contains("error sending request") || e.contains("tls") {
        "连不上更新服务器（GitHub），请检查网络或代理后再试。"
    } else if e.contains("404") || e.contains("not found") {
        "还没有找到发布的版本信息。"
    } else if e.contains("permission") || e.contains("denied") || e.contains("read-only") {
        "没有权限替换应用文件。请把 Coquou 移到「应用程序」文件夹后再试。"
    } else {
        "检查或安装更新时出了点问题，请稍后再试。"
    };
    msg.to_string()
}

async fn check_inner<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Update>, String> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(30));
    if let Ok(url) = std::env::var("COQUOU_UPDATE_URL") {
        let url = url.parse().map_err(|e| format!("COQUOU_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())
}

/// Check once; announces a new version with `update-available`.
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Status, String> {
    if status(app).checking || status(app).installing {
        return Ok(status(app));
    }
    set(app, |s| s.checking = true);
    let result = check_inner(app).await;
    let had = available_version(app);
    match &result {
        Ok(Some(update)) => {
            let info = Available {
                version: update.version.clone(),
                notes: update.body.clone().filter(|b| !b.trim().is_empty()),
                date: update.date.map(|d| d.date().to_string()),
            };
            println!("[coquou] update available: {} → {}", update.current_version, update.version);
            *app.state::<UpdateState>().pending.lock().unwrap() = Some(update.clone());
            set(app, |s| {
                s.available = Some(info.clone());
                s.last_error = None;
            });
            if had.as_deref() != Some(info.version.as_str()) {
                let _ = app.emit("update-available", info);
                crate::refresh_tray(app);
            }
        }
        Ok(None) => {
            println!("[coquou] up to date ({})", app.package_info().version);
            *app.state::<UpdateState>().pending.lock().unwrap() = None;
            set(app, |s| {
                s.available = None;
                s.last_error = None;
            });
            if had.is_some() {
                crate::refresh_tray(app);
            }
        }
        Err(e) => {
            eprintln!("[coquou] update check failed: {e}");
            set(app, |s| s.last_error = Some(friendly(e)));
        }
    }
    set(app, |s| {
        s.checking = false;
        s.last_checked = Some(now());
    });
    result.map(|_| status(app)).map_err(|e| friendly(&e))
}

/// Background checks while `autoUpdate` is on.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            if crate::settings::get(&app).auto_update {
                let _ = tauri::async_runtime::block_on(check(&app));
                // Dev only: COQUOU_UPDATE_AUTOINSTALL=1 installs right away
                // (end-to-end updater test without clicking).
                if cfg!(debug_assertions)
                    && std::env::var_os("COQUOU_UPDATE_AUTOINSTALL").is_some()
                    && available_version(&app).is_some()
                {
                    let _ = tauri::async_runtime::block_on(update_install(app.clone()));
                }
            }
            std::thread::sleep(Duration::from_secs(6 * 3600));
        }
    });
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    status(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Status, String> {
    check(&app).await
}

/// Download, verify, install and restart. Emits `update-progress`
/// `{ downloaded, total }` while downloading.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app.state::<UpdateState>().pending.lock().unwrap().clone();
    let Some(update) = update else { return Err("没有可安装的更新，请先检查更新".into()) };
    set(&app, |s| {
        s.installing = true;
        s.last_error = None;
    });
    let mut downloaded: u64 = 0;
    let progress = app.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": total }));
            },
            || println!("[coquou] update downloaded, verifying and installing"),
        )
        .await;
    match result {
        Ok(()) => {
            println!("[coquou] update installed, restarting");
            app.restart();
        }
        Err(e) => {
            eprintln!("[coquou] update install failed: {e}");
            let msg = friendly(&e.to_string());
            set(&app, |s| {
                s.installing = false;
                s.last_error = Some(msg.clone());
            });
            Err(msg)
        }
    }
}
