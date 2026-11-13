#!/usr/bin/env python3
"""Render the app + tray icons from tools/icons/icons.js.

    python3 tools/build-icons.py <concept id>      # e.g. shellchick

Writes src-tauri/icons/source.png (1024²) and, through `tauri icon`, every
platform size (icns, ico, PNGs); plus the tray icons:
  icons/tray-template.png  monochrome glyph (macOS menu bar, template image)
  icons/tray.png           coloured icon (Windows / Linux notification area)
Needs Google Chrome (headless) and Node (npx).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
CHROME = next((c for c in [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "google-chrome", "chromium",
] if os.path.isfile(c) or shutil.which(c)), None)


def concepts():
    js = (ROOT / "tools" / "icons" / "icons.js").read_text(encoding="utf-8")
    out = subprocess.run(["node", "-e", js + "\nconsole.log(JSON.stringify(module.exports))"],
                         check=True, capture_output=True, text=True).stdout
    return {c["id"]: c for c in json.loads(out)}


def render(svg, size, dest):
    tmp = Path(tempfile.mkdtemp())
    page = tmp / "i.html"
    page.write_text(f"<!doctype html><style>html,body{{margin:0;background:transparent}}svg{{width:{size}px;height:{size}px;display:block}}</style>{svg}", encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={size},{size}", "--default-background-color=00000000",
                    f"--screenshot={dest}", page.as_uri()], check=True, capture_output=True)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if not CHROME:
        sys.exit("Chrome not found")
    all_ = concepts()
    c = all_.get(sys.argv[1]) or sys.exit(f"unknown concept; pick one of {', '.join(all_)}")
    ICONS.mkdir(parents=True, exist_ok=True)
    src = ICONS / "source.png"
    render(c["icon"], 1024, src)
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.run([npx, "-y", "@tauri-apps/cli@2", "icon", str(src), "-o", str(ICONS)], check=True, cwd=ROOT / "src-tauri")
    render(c["tray"], 64, ICONS / "tray-template.png")
    shutil.copy(ICONS / "64x64.png", ICONS / "tray.png")
    # The app window shows the icon too.
    assets = ROOT / "src" / "assets"
    assets.mkdir(exist_ok=True)
    shutil.copy(ICONS / "128x128@2x.png", assets / "app-icon.png")
    # Drop mobile icon sets `tauri icon` also emits.
    for extra in ("android", "ios"):
        shutil.rmtree(ICONS / extra, ignore_errors=True)
    print(f"icons built from concept {c['id']} → {ICONS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
