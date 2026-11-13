#!/usr/bin/env python3
"""Render the preset pets (tools/presets/) into src-tauri/presets/<id>/.

Needs Google Chrome (or Chromium / Edge) for headless canvas rendering.

    python3 tools/build-presets.py [--only qiqi] [--preview-dir DIR] [--chrome PATH]

Each preset becomes a Codex v2 pet directory:
    pet.json, perchy.json, spritesheet.webp (1536×2288),
    spritesheet@2x.webp (3072×4576, used by Perchy for HiDPI screens)
"""
import argparse
import base64
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "presets" / "render.html"
DEST = ROOT / "src-tauri" / "presets"

CHROMES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium", "chromium-browser",
]


def find_chrome(explicit):
    for c in ([explicit] if explicit else CHROMES):
        if c and (os.path.isfile(c) or shutil.which(c)):
            return c
    sys.exit("Chrome not found; pass --chrome PATH")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--preview-dir")
    ap.add_argument("--chrome")
    a = ap.parse_args()

    url = SRC.as_uri() + (f"?only={a.only}" if a.only else "")
    dom = subprocess.run(
        [find_chrome(a.chrome), "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
         "--virtual-time-budget=120000", "--dump-dom", url],
        check=True, capture_output=True, text=True, timeout=600,
    ).stdout
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not m or not m.group(1).strip():
        sys.exit("renderer produced no output (open tools/presets/render.html?preview in Chrome to debug)")

    meta = {}
    for line in html.unescape(m.group(1)).strip().splitlines():
        item = json.loads(line)
        if "error" in item:
            sys.exit(f"renderer error: {item['error']}")
        pid = item["id"]
        out = DEST / pid
        out.mkdir(parents=True, exist_ok=True)
        if "meta" in item:
            meta[pid] = item["meta"]
            continue
        data = base64.b64decode(item["data"].split(",", 1)[1])
        if item["file"] == "preview.png":
            if a.preview_dir:
                Path(a.preview_dir).mkdir(parents=True, exist_ok=True)
                (Path(a.preview_dir) / f"{pid}.png").write_bytes(data)
            continue
        (out / item["file"]).write_bytes(data)
        print(f"  {pid}/{item['file']}  {len(data) // 1024} KB")

    for pid, m in meta.items():
        out = DEST / pid
        (out / "pet.json").write_text(json.dumps({
            "id": pid,
            "displayName": m["displayName"],
            "description": m["description"],
            "spriteVersionNumber": 2,
            "spritesheetPath": "spritesheet.webp",
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (out / "perchy.json").write_text(json.dumps({
            "format": "perchy/1",
            "author": "Perchy contributors",
            "license": "CC-BY-4.0",
            "tags": ["preset"],
            "hd": "spritesheet@2x.webp",
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"built {', '.join(meta)} → {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
