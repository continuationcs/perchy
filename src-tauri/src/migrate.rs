//! One-time move from the app's former identities (Perchy,
//! `io.perchy.desktop`; briefly Pipkin, `io.github.pipkin`) to Coquou
//! (`io.github.coquou`): pets, settings, AI profiles, the saved hatch run.
//! API keys move lazily (see ai.rs `OLD_KEYCHAIN_SERVICES`).

use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

pub const OLD_IDS: [&str; 2] = ["io.github.pipkin", "io.perchy.desktop"];

/// Move everything from the old folder that the new one doesn't have yet.
fn merge(old: &Path, new: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(new)?;
    let mut moved = 0;
    for entry in fs::read_dir(old)?.flatten() {
        let dest = new.join(entry.file_name());
        if dest.exists() {
            // Pets: merge one level deeper (keep both sets).
            if entry.path().is_dir() && entry.file_name() == "pets" {
                moved += merge(&entry.path(), &dest)?;
            }
            continue;
        }
        if fs::rename(entry.path(), &dest).is_err() {
            copy(&entry.path(), &dest)?;
        }
        moved += 1;
    }
    Ok(moved)
}

fn copy(src: &Path, dest: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dest)?;
        for e in fs::read_dir(src)?.flatten() {
            copy(&e.path(), &dest.join(e.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dest).map(|_| ())
    }
}

pub fn run<R: Runtime>(app: &AppHandle<R>) {
    let mut dirs = vec![];
    for d in [app.path().app_data_dir(), app.path().app_config_dir()].into_iter().flatten() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    for (new, id) in dirs.iter().flat_map(|d| OLD_IDS.iter().map(move |id| (d.clone(), *id))) {
        let Some(old) = new.parent().map(|p| p.join(id)) else { continue };
        if !old.is_dir() || old == new {
            continue;
        }
        match merge(&old, &new) {
            Ok(n) if n > 0 => println!("[coquou] moved {n} item(s) from {} to {}", old.display(), new.display()),
            Ok(_) => {}
            Err(e) => eprintln!("[coquou] migration from {} failed: {e}", old.display()),
        }
        // Drop the old folder once it is empty.
        let _ = fs::remove_dir(old.join("pets"));
        let _ = fs::remove_dir(&old);
    }
}
