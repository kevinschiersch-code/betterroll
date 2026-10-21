#!/usr/bin/env python3
# build.py – baut aus dem Quellordner ../crunchyroll-filter die Pakete für Chrome/Edge/Brave und Firefox
# und daraus den Windows-Installer (.exe, NSIS).
#
#   python3 build.py            -> dist/chrome/, dist/firefox/, Zips und Installer
#
# Firefox: Die Datei dist/betterroll-firefox-<version>.zip muss einmal bei addons.mozilla.org
# („Eigene Verbreitung“) signiert werden. Die signierte .xpi nach signed/betterroll-firefox.xpi legen
# und build.py erneut starten – erst dann kann der Installer Firefox anbieten.
import hashlib, json, os, shutil, subprocess, sys, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "crunchyroll-filter"
DIST = HERE / "dist"
SIGNED_XPI = HERE / "signed" / "betterroll-firefox.xpi"
GECKO_ID = "betterroll@enigma"
# Ablageort der Updates (öffentliches GitHub-Repository, Ordner release/ auf main)
REPO = "kevinschiersch-code/betterroll"
BASE_URL = f"https://raw.githubusercontent.com/{REPO}/main/release"
RELEASE = HERE / "release"

# nur diese Dateien gehören ins Add-on (keine Test- oder Hilfsdateien)
SKIP = {".DS_Store", "Thumbs.db", "lang.json"}


def copy_source(dest: Path):
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SRC, dest, ignore=lambda d, names: [n for n in names if n in SKIP or n.startswith(".")])


def firefox_manifest(m: dict) -> dict:
    m = json.loads(json.dumps(m))
    # Firefox kennt keine Service-Worker-Hintergrundskripte, sondern Hintergrundseiten mit „scripts“
    m["background"] = {"scripts": [m["background"]["service_worker"]]}
    # Update-Helfer (↻) gibt es nur für Chrome/Edge/Brave; Firefox aktualisiert sich selbst
    m["permissions"] = [p for p in m.get("permissions", []) if p != "nativeMessaging"]
    m["browser_specific_settings"] = {"gecko": {
        "id": GECKO_ID,
        "strict_min_version": "128.0",  # :has(), MV3-Berechtigungen bei der Installation
        "data_collection_permissions": {"required": ["none"]},  # das Add-on sammelt und sendet keine Daten
    }}
    # auch für Firefox auf Android (Handy-Modus in theme.js)
    m["browser_specific_settings"]["gecko_android"] = {"strict_min_version": "128.0"}
    # Firefox braucht die Seite ausdrücklich als Host-Berechtigung (Chrome leitet sie aus den Content-Scripts ab)
    m["browser_specific_settings"]["gecko"]["update_url"] = f"{BASE_URL}/updates.json"  # Firefox aktualisiert selbst
    hosts = m.setdefault("host_permissions", [])
    if "https://www.crunchyroll.com/*" not in hosts:
        hosts.insert(0, "https://www.crunchyroll.com/*")
    if "https://static.crunchyroll.com/*" not in hosts:  # Player-iframe (speed.js)
        hosts.insert(1, "https://static.crunchyroll.com/*")
    return m


def store_variant(folder: Path, firefox: bool):
    """Store-Fassung: ohne eigenen Updater (Store aktualisiert selbst), ohne nativeMessaging-Berechtigung, Firefox ohne update_url."""
    bg = folder / "background.js"
    s = bg.read_text(encoding="utf-8")
    a, b = s.index("// @updater-begin"), s.index("// @updater-end")
    bg.write_text(s[:a] + s[b + len("// @updater-end"):].lstrip("\n"), encoding="utf-8")
    mf = folder / "manifest.json"
    m = json.loads(mf.read_text(encoding="utf-8"))
    m["permissions"] = [p for p in m.get("permissions", []) if p not in ("alarms", "nativeMessaging")]
    if firefox:
        m["browser_specific_settings"]["gecko"].pop("update_url", None)
    mf.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def zip_dir(folder: Path, out: Path):
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(folder).as_posix())


def make_icon(dest: Path):
    from PIL import Image
    Image.open(SRC / "icons" / "icon128.png").save(dest, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128)])


def main():
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    DIST.mkdir(exist_ok=True)

    # Updater für Chrome/Edge/Brave (UTF-8 mit BOM, sonst liest Windows PowerShell Umlaute falsch)
    ps = (HERE / "updater.ps1").read_text(encoding="utf-8").replace("__BASE_URL__", BASE_URL)
    (DIST / "updater.ps1").write_text(ps, encoding="utf-8-sig")
    shutil.copy(HERE / "updater.vbs", DIST / "updater.vbs")
    (DIST / "host.ps1").write_text((HERE / "native" / "host.ps1").read_text(encoding="utf-8"), encoding="utf-8-sig")
    shutil.copy(HERE / "native" / "host.cmd", DIST / "host.cmd")
    NATIVE = ("updater.ps1", "updater.vbs", "host.ps1", "host.cmd")

    chrome = DIST / "chrome"
    copy_source(chrome)
    # Updater und Update-Helfer (Knopf ↻) reisen im Chrome-Paket mit: updater.ps1 übernimmt sie nach einem Update
    (chrome / "native").mkdir()
    for f in NATIVE:
        shutil.copy(DIST / f, chrome / "native" / f)
    zip_dir(chrome, DIST / f"betterroll-chrome-{version}.zip")

    firefox = DIST / "firefox"
    copy_source(firefox)
    (firefox / "manifest.json").write_text(json.dumps(firefox_manifest(manifest), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    zip_dir(firefox, DIST / f"betterroll-firefox-{version}.zip")

    # Store-Pakete (Chrome Web Store, Firefox Add-ons „gelistet“)
    store = DIST / "store"
    store.mkdir(exist_ok=True)
    for p in store.glob("*.zip"):
        p.unlink()
    for name, ff in (("chrome", False), ("firefox", True)):
        tmp = store / name
        copy_source(tmp)
        if ff:
            (tmp / "manifest.json").write_text(json.dumps(firefox_manifest(manifest), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        store_variant(tmp, ff)
        zip_dir(tmp, store / f"betterroll-{name}-store-{version}.zip")

    # „Updates einrichten“ für schon entpackt geladene Add-ons (ohne Installer): Doppelklick auf die .cmd
    setup_zip = DIST / "BetterRoll-Updates-einrichten.zip"
    with zipfile.ZipFile(setup_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for f in NATIVE:
            z.write(DIST / f, f"BetterRoll-Updates/{f}")
        z.writestr("BetterRoll-Updates/setup-updates.ps1", "\ufeff" + (HERE / "setup-updates.ps1").read_text(encoding="utf-8"))
        for cmd in ("Updates einrichten.cmd", "Updates ausschalten.cmd"):
            z.write(HERE / cmd, f"BetterRoll-Updates/{cmd}")

    # Update-Dateien (werden ins Repository unter release/ hochgeladen)
    RELEASE.mkdir(exist_ok=True)
    czip = f"betterroll-chrome-{version}.zip"
    shutil.copy(DIST / czip, RELEASE / czip)
    sha = hashlib.sha256((RELEASE / czip).read_bytes()).hexdigest().upper()
    (RELEASE / "latest.json").write_text(json.dumps({"version": version, "chrome": czip, "sha256": sha}, indent=2) + "\n", encoding="utf-8")
    if SIGNED_XPI.exists():
        xpi = f"betterroll-firefox-{version}.xpi"
        shutil.copy(SIGNED_XPI, RELEASE / xpi)
        (RELEASE / "updates.json").write_text(json.dumps({"addons": {GECKO_ID: {"updates": [
            {"version": version, "update_link": f"{BASE_URL}/{xpi}"}]}}}, indent=2) + "\n", encoding="utf-8")
    shutil.copy(setup_zip, RELEASE / setup_zip.name)
    # alte Pakete im Ablageordner entfernen (nur die aktuelle Version bleibt)
    for p in RELEASE.iterdir():
        if p.suffix == ".zip" and version not in p.name and p.name != setup_zip.name:
            p.unlink()

    make_icon(DIST / "installer.ico")
    defines = [f"-DVERSION={version}", f"-DDIST={DIST}", f"-DOUTFILE={DIST / f'BetterRoll-Setup-{version}.exe'}"]
    if SIGNED_XPI.exists():
        defines.append(f"-DFIREFOX_XPI={SIGNED_XPI}")
        print("Firefox: signierte .xpi gefunden, Installer bietet Firefox an")
    else:
        print("Firefox: noch keine signierte .xpi (signed/betterroll-firefox.xpi) – Installer zeigt Hinweis")
    r = subprocess.run(["makensis", "-V2", *defines, str(HERE / "installer.nsi")])
    if r.returncode:
        sys.exit(r.returncode)
    print(f"fertig: {DIST}")


if __name__ == "__main__":
    main()
