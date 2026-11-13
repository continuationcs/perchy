#!/usr/bin/env python3
"""Build and publish a Coquou release on GitHub (used by the in-app updater).

The updater signing key lives only on the release Mac
(~/.tauri/perchy-updater.key, or $COQUOU_UPDATER_KEY). The Windows machine
just builds and uploads its installer; the Mac signs it and publishes.

    # Mac: set the version, commit, push
    python3 tools/release.py bump 0.1.1

    # Mac: build + sign the macOS update bundle and DMG, upload to a draft release
    python3 tools/release.py build [--universal]
    python3 tools/release.py upload --notes-file notes.md

    # Windows: build the NSIS installer, upload it to the same draft
    py tools\\release.py build
    py tools\\release.py upload

    # Mac: sign what's unsigned, write latest.json, publish the draft
    python3 tools/release.py publish

`upload` and `publish` use the GitHub CLI; run them with a token that can
write to the repo, e.g. GH_TOKEN=$(gh auth token -u <owner>).

Optional: COQUOU_SIGN_IDENTITY="<codesign identity>" signs the macOS app
with that certificate (keeps keychain access across updates).
"""
import argparse
import datetime
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAURI = ROOT / "src-tauri"
CONF = TAURI / "tauri.conf.json"
CARGO = TAURI / "Cargo.toml"
REPO = "continuationcs/perchy"
NPX = "npx.cmd" if os.name == "nt" else "npx"
CLI = [NPX, "-y", "@tauri-apps/cli@2"]
KEY = Path(os.environ.get("COQUOU_UPDATER_KEY", Path.home() / ".tauri" / "perchy-updater.key"))


def run(cmd, **kw):
    print("$", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run(cmd, check=True, **kw)


def version():
    return json.loads(CONF.read_text(encoding="utf-8"))["version"]


def dist():
    d = ROOT / "dist" / version()
    d.mkdir(parents=True, exist_ok=True)
    return d


def gh(*args, capture=False):
    if not shutil.which("gh"):
        sys.exit("GitHub CLI (gh) not found")
    r = subprocess.run(["gh", *args], check=True, text=True, capture_output=capture)
    return r.stdout if capture else None


# ---------- bump ----------

def cmd_bump(a):
    if not re.fullmatch(r"\d+\.\d+\.\d+", a.version):
        sys.exit("version must look like 1.2.3")
    conf = json.loads(CONF.read_text(encoding="utf-8"))
    old = conf["version"]
    conf["version"] = a.version
    CONF.write_text(json.dumps(conf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cargo = CARGO.read_text(encoding="utf-8")
    cargo = re.sub(r'(?m)^version = "[^"]+"', f'version = "{a.version}"', cargo, count=1)
    CARGO.write_text(cargo, encoding="utf-8")
    run(["cargo", "update", "-p", "coquou", "--offline"], cwd=TAURI)
    print(f"{old} → {a.version}. Commit and push, then build on each machine.")


# ---------- build ----------

def cmd_build(a):
    out = dist()
    v = version()
    env = dict(os.environ)
    system = platform.system()
    if system == "Darwin":
        if not KEY.is_file():
            sys.exit(f"updater key not found: {KEY}")
        env["TAURI_SIGNING_PRIVATE_KEY"] = KEY.read_text().strip()
        env.setdefault("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
        if os.environ.get("COQUOU_SIGN_IDENTITY"):
            env["APPLE_SIGNING_IDENTITY"] = os.environ["COQUOU_SIGN_IDENTITY"]
        target = "universal-apple-darwin" if a.universal else None
        cmd = CLI + ["build", "--bundles", "app,dmg", "--config", json.dumps({"bundle": {"createUpdaterArtifacts": True}})]
        if target:
            cmd += ["--target", target]
        run(cmd, cwd=TAURI, env=env)
        base = TAURI / "target" / (target or "") / "release" / "bundle"
        arch = "universal" if a.universal else ("aarch64" if platform.machine() == "arm64" else "x86_64")
        tgz = base / "macos" / "Coquou.app.tar.gz"
        shutil.copy(tgz, out / f"Coquou_{v}_darwin-{arch}.app.tar.gz")
        shutil.copy(Path(str(tgz) + ".sig"), out / f"Coquou_{v}_darwin-{arch}.app.tar.gz.sig")
        for dmg in (base / "dmg").glob("*.dmg"):
            shutil.copy(dmg, out / f"Coquou_{v}_macos-{arch}.dmg")
    elif system == "Windows":
        # No key here: the Mac signs the installer during `publish`.
        cmd = CLI + ["build", "--bundles", "nsis", "--config", json.dumps({"bundle": {"createUpdaterArtifacts": False}})]
        run(cmd, cwd=TAURI, env=env)
        exes = sorted((TAURI / "target" / "release" / "bundle" / "nsis").glob(f"*_{v}_*-setup.exe"))
        if not exes:
            sys.exit("NSIS installer not found")
        shutil.copy(exes[-1], out / f"Coquou_{v}_windows-x86_64-setup.exe")
    else:
        sys.exit(f"unsupported build host: {system}")
    print("built into", out)
    for f in sorted(out.iterdir()):
        print("  ", f.name)


# ---------- upload ----------

def ensure_draft(v, notes):
    tag = f"v{v}"
    try:
        gh("release", "view", tag, "--repo", REPO, capture=True)
    except subprocess.CalledProcessError:
        gh("release", "create", tag, "--repo", REPO, "--draft", "--title", f"Coquou {v}",
           "--notes", notes or f"Coquou {v}")
    else:
        if notes:
            gh("release", "edit", tag, "--repo", REPO, "--notes", notes)
    return tag


def cmd_upload(a):
    v = version()
    notes = Path(a.notes_file).read_text(encoding="utf-8") if a.notes_file else a.notes
    tag = ensure_draft(v, notes)
    files = [str(f) for f in sorted(dist().iterdir()) if f.is_file()]
    if not files:
        sys.exit("nothing to upload; run build first")
    gh("release", "upload", tag, "--repo", REPO, "--clobber", *files)
    print(f"uploaded {len(files)} file(s) to draft {tag}")


# ---------- publish ----------

PLATFORM_OF = [
    (re.compile(r"_darwin-universal\.app\.tar\.gz$"), ["darwin-aarch64", "darwin-x86_64"]),
    (re.compile(r"_darwin-aarch64\.app\.tar\.gz$"), ["darwin-aarch64"]),
    (re.compile(r"_darwin-x86_64\.app\.tar\.gz$"), ["darwin-x86_64"]),
    (re.compile(r"_windows-x86_64-setup\.exe$"), ["windows-x86_64"]),
]


def cmd_publish(a):
    if not KEY.is_file():
        sys.exit(f"publish needs the updater key {KEY} (run it on the release Mac)")
    v = version()
    tag = f"v{v}"
    info = json.loads(gh("release", "view", tag, "--repo", REPO, "--json", "body,assets,isDraft", capture=True))
    names = {x["name"] for x in info["assets"]}
    work = Path(tempfile.mkdtemp(prefix="perchy-release-"))
    platforms = {}
    for name in sorted(names):
        keys = next((k for rx, k in PLATFORM_OF if rx.search(name)), None)
        if not keys:
            continue
        sig = name + ".sig"
        if sig not in names:
            gh("release", "download", tag, "--repo", REPO, "--pattern", name, "--dir", str(work))
            run(CLI + ["signer", "sign", "-f", str(KEY), "-p", "", str(work / name)])
            gh("release", "upload", tag, "--repo", REPO, "--clobber", str(work / sig))
        else:
            gh("release", "download", tag, "--repo", REPO, "--pattern", sig, "--dir", str(work))
        signature = (work / sig).read_text().strip()
        url = f"https://github.com/{REPO}/releases/download/{tag}/{name}"
        for k in keys:
            platforms[k] = {"signature": signature, "url": url}
    if not platforms:
        sys.exit("no update bundles in the release")
    latest = {
        "version": v,
        "notes": info.get("body") or "",
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": platforms,
    }
    (work / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
    gh("release", "upload", tag, "--repo", REPO, "--clobber", str(work / "latest.json"))
    print("latest.json platforms:", ", ".join(sorted(platforms)))
    missing = {"darwin-aarch64", "windows-x86_64"} - set(platforms)
    if missing and not a.force:
        sys.exit(f"missing {', '.join(sorted(missing))}; upload them or pass --force to publish anyway")
    if info.get("isDraft"):
        gh("release", "edit", tag, "--repo", REPO, "--draft=false", "--latest")
    print(f"published {tag}: https://github.com/{REPO}/releases/tag/{tag}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bump"); b.add_argument("version"); b.set_defaults(fn=cmd_bump)
    b = sub.add_parser("build"); b.add_argument("--universal", action="store_true", help="macOS: Intel + Apple Silicon"); b.set_defaults(fn=cmd_build)
    b = sub.add_parser("upload"); b.add_argument("--notes"); b.add_argument("--notes-file"); b.set_defaults(fn=cmd_upload)
    b = sub.add_parser("publish"); b.add_argument("--force", action="store_true", help="publish even if a platform is missing"); b.set_defaults(fn=cmd_publish)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
