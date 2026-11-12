//! Installing pets into Perchy's own pets directory from a `.pet` / `.zip`
//! archive or a plain directory.
//!
//! Untrusted input, so every step is defensive:
//!   - archive entries must stay inside the target (`enclosed_name`), symlinks
//!     are skipped, and file count / per-file / total sizes are capped while
//!     actually decompressing (headers can lie);
//!   - the pet is unpacked into a hidden staging dir, validated, and only then
//!     moved into place, replacing an older install of the same id.

use crate::pets;
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Runtime};

const MAX_FILES: usize = 256;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 96 * 1024 * 1024;
const CODEX_CELL: (u32, u32) = (192, 208);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub key: String,
    pub display_name: String,
    pub replaced: bool,
}

struct Budget {
    files: usize,
    bytes: u64,
}

impl Budget {
    fn take(&mut self, len: u64) -> Result<(), String> {
        self.files += 1;
        self.bytes += len;
        if self.files > MAX_FILES {
            return Err(format!("文件太多（上限 {MAX_FILES} 个）"));
        }
        if len > MAX_FILE_BYTES || self.bytes > MAX_TOTAL_BYTES {
            return Err("宠物包太大".into());
        }
        Ok(())
    }
}

/// Junk that archivers and Finder add; never part of a pet.
fn is_junk(path: &Path) -> bool {
    path.components().any(|c| match c {
        Component::Normal(s) => {
            let s = s.to_string_lossy();
            s.starts_with('.') || s == "__MACOSX" || s == "Thumbs.db"
        }
        _ => true,
    })
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "不是有效的 .pet / .zip 文件".to_string())?;
    let mut budget = Budget { files: 0, bytes: 0 };
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| format!("压缩包里有非法路径：{}", entry.name()))?;
        if entry.is_dir() || entry.is_symlink() || is_junk(&rel) {
            continue;
        }
        budget.take(entry.size())?;
        let out = dest.join(&rel);
        fs::create_dir_all(out.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut writer = fs::File::create(&out).map_err(|e| e.to_string())?;
        // Cap the real decompressed size, not the declared one.
        let copied = io::copy(&mut (&mut entry).take(MAX_FILE_BYTES + 1), &mut writer)
            .map_err(|e| format!("{}: {e}", rel.display()))?;
        if copied > MAX_FILE_BYTES {
            return Err("宠物包太大".into());
        }
    }
    Ok(())
}

fn copy_dir(src: &Path, dest: &Path, budget: &mut Budget) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let name = PathBuf::from(entry.file_name());
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if is_junk(&name) || meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            copy_dir(&entry.path(), &dest.join(&name), budget)?;
        } else {
            budget.take(meta.len())?;
            fs::copy(entry.path(), dest.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The pet is either the staging root itself or its single sub-directory
/// (archives made by "compress folder" nest everything one level down).
fn locate_pet_dir(staging: &Path) -> Result<PathBuf, String> {
    if staging.join("pet.json").is_file() {
        return Ok(staging.to_path_buf());
    }
    let dirs: Vec<PathBuf> = fs::read_dir(staging)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    match dirs.as_slice() {
        [only] if only.join("pet.json").is_file() => Ok(only.clone()),
        _ => Err("没找到 pet.json，这不是一个宠物包".into()),
    }
}

fn safe_rel(path: &str) -> bool {
    !path.is_empty() && Path::new(path).components().all(|c| matches!(c, Component::Normal(_)))
}

/// Width/height from a PNG or WebP header.
fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let u16le = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]) as u32;
    let u24le = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], 0]);
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return Some((w, h));
    }
    if bytes.len() >= 30 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return match &bytes[12..16] {
            b"VP8 " => Some((u16le(26) & 0x3fff, u16le(28) & 0x3fff)),
            b"VP8L" => {
                let b = u32::from_le_bytes(bytes[21..25].try_into().ok()?);
                Some((1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)))
            }
            b"VP8X" => Some((1 + u24le(24), 1 + u24le(27))),
            _ => None,
        };
    }
    None
}

/// Check the pet against docs/pet-format.md; returns (id, displayName).
fn validate(dir: &Path) -> Result<(String, String), String> {
    let text = fs::read_to_string(dir.join("pet.json")).map_err(|_| "读不了 pet.json".to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("pet.json 格式错误：{e}"))?;

    let id = manifest["id"].as_str().unwrap_or_default().to_string();
    let id_ok = (1..=64).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !id.starts_with(['-', '_']);
    if !id_ok {
        return Err(format!("pet.json 里的 id 不合法：\"{id}\"（只能用字母、数字、- 和 _）"));
    }
    let display_name = manifest["displayName"].as_str().unwrap_or(&id).to_string();

    let sheet = manifest["spritesheetPath"].as_str().unwrap_or("spritesheet.webp");
    if !safe_rel(sheet) {
        return Err(format!("spritesheetPath 不合法：{sheet}"));
    }
    let bytes = fs::read(dir.join(sheet)).map_err(|_| format!("缺少精灵图 {sheet}"))?;
    let (w, h) = image_size(&bytes).ok_or("精灵图必须是 PNG 或 WebP")?;
    let version = manifest["spriteVersionNumber"].as_u64().unwrap_or(1);
    let rows = if version >= 2 { 11 } else { 9 };
    let (cw, ch) = CODEX_CELL;
    if (w, h) != (cw * 8, ch * rows) {
        return Err(format!(
            "精灵图尺寸 {w}×{h} 不对，Codex v{version} 需要 {}×{}",
            cw * 8,
            ch * rows
        ));
    }

    if let Ok(text) = fs::read_to_string(dir.join("perchy.json")) {
        let ext: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("perchy.json 格式错误：{e}"))?;
        if let Some(states) = ext["states"].as_object() {
            for (name, state) in states {
                if let Some(sheet) = state["sheet"].as_str() {
                    if !safe_rel(sheet) || !dir.join(sheet).is_file() {
                        return Err(format!("perchy.json 的状态 {name} 引用的 {sheet} 不存在"));
                    }
                }
            }
        }
    }
    Ok((id, display_name))
}

pub fn install<R: Runtime>(app: &AppHandle<R>, src: &Path) -> Result<Installed, String> {
    let root = pets::perchy_root(app).ok_or("找不到应用数据目录")?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let staging = root.join(format!(".staging-{nonce}"));

    let result = (|| {
        if src.is_dir() {
            copy_dir(src, &staging, &mut Budget { files: 0, bytes: 0 })?;
        } else {
            let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase());
            match ext.as_deref() {
                Some("pet") | Some("zip") => {
                    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
                    extract_zip(src, &staging)?;
                }
                _ => return Err("只支持 .pet、.zip 或宠物文件夹".into()),
            }
        }
        let pet_dir = locate_pet_dir(&staging)?;
        let (id, display_name) = validate(&pet_dir)?;
        let dest = root.join(&id);
        let replaced = dest.exists();
        if replaced {
            fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
        }
        fs::rename(&pet_dir, &dest).map_err(|e| e.to_string())?;
        Ok(Installed { key: format!("perchy:{id}"), display_name, replaced })
    })();

    let _ = fs::remove_dir_all(&staging);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_and_webp_headers() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend(1536u32.to_be_bytes());
        png.extend(2288u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((1536, 2288)));
        assert_eq!(image_size(b"nope"), None);
    }

    #[test]
    fn junk_and_paths() {
        assert!(is_junk(Path::new("__MACOSX/x")));
        assert!(is_junk(Path::new("a/.DS_Store")));
        assert!(!is_junk(Path::new("extra/sleep.webp")));
        assert!(!safe_rel("../x.webp"));
        assert!(!safe_rel("/etc/passwd"));
        assert!(safe_rel("extra/sleep.webp"));
    }
}
