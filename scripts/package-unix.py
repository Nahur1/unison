"""Build native Linux .deb or relocatable macOS .app/.dmg with offline assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'^version = "([^"]+)"', (ROOT / "Cargo.toml").read_text(), re.MULTILINE).group(1)
DIST = ROOT / "dist"


def command(*args):
    subprocess.run(list(map(str, args)), check=True, stdin=subprocess.DEVNULL, timeout=600)


def macho_rpaths(text):
    return re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset", text)


def deduplicate_rpaths(binary):
    # dylibbundler rewrites multiple distinct source rpaths to the same bundle
    # path. Recent dyld rejects duplicate load commands even if codesign passes.
    def read():
        return macho_rpaths(subprocess.check_output(["otool", "-l", str(binary)], text=True))
    paths = read()
    for path in dict.fromkeys(paths):
        while paths.count(path) > 1:
            before = paths.count(path)
            command("install_name_tool", "-delete_rpath", path, binary)
            paths = read()
            if paths.count(path) >= before:
                raise ValueError(f"Could not deduplicate rpath in {binary}: {path}")
            if path not in paths:
                command("install_name_tool", "-add_rpath", path, binary)
                paths.append(path)


def resources(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("LICENSE", "COPYRIGHT.md", "THIRD_PARTY.md", "README.md", "README.fa.md"):
        shutil.copy2(ROOT / name, destination / name)
    shutil.copytree(ROOT / "licenses", destination / "licenses", dirs_exist_ok=True)
    shutil.copytree(ROOT / "ui/fonts", destination / "runtime/fonts", dirs_exist_ok=True)
    shutil.copytree(ROOT / "models/enfa", destination / "models/enfa", dirs_exist_ok=True)
    shutil.copy2(ROOT / "scripts/MODEL-LICENSE.txt", destination / "models/enfa/LICENSE.txt")
    # Reverify the exact model going into the archive, not only the download.
    import importlib.util
    spec = importlib.util.spec_from_file_location("offline", ROOT / "scripts/prepare-offline.py")
    offline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(offline)
    for name, _, sha in offline.FILES:
        if hashlib.sha256((destination / "models/enfa" / name).read_bytes()).hexdigest() != sha:
            raise ValueError(f"Invalid packaged model: {name}")


def linux():
    arch = subprocess.check_output(["dpkg", "--print-architecture"], text=True).strip()
    stage = DIST / f"linux-{arch}"
    if stage.exists():
        raise ValueError(f"Staging folder already exists: {stage}")
    app = stage / "usr/lib/unison"
    resources(app)
    shutil.copy2(ROOT / "target/release/unison", app / "unison")
    (app / "unison").chmod(0o755)
    (stage / "usr/bin").mkdir(parents=True)
    (stage / "usr/bin/unison").symlink_to("../lib/unison/unison")
    applications = stage / "usr/share/applications"
    applications.mkdir(parents=True)
    shutil.copy2(ROOT / "packaging/linux/unison.desktop", applications)
    for size in (32, 64, 128, 256, 512):
        icons = stage / f"usr/share/icons/hicolor/{size}x{size}/apps"
        icons.mkdir(parents=True)
        shutil.copy2(ROOT / f"ui/icons/unison-{size}.png", icons / "unison.png")
    icons = stage / "usr/share/icons/hicolor/scalable/apps"
    icons.mkdir(parents=True)
    shutil.copy2(ROOT / "ui/icons/unison.svg", icons)
    control = stage / "DEBIAN"
    control.mkdir()
    source = DIST / "shlibdeps-source"
    (source / "debian").mkdir(parents=True)
    (source / "debian/control").write_text("Source: unison\n\nPackage: unison\nArchitecture: any\n", encoding="utf-8")
    deps = subprocess.check_output(["dpkg-shlibdeps", "--ignore-missing-info", "-O",
                                    f"-e{app / 'unison'}"], text=True, cwd=source)
    dependencies = deps.strip().removeprefix("shlibs:Depends=")
    # X11/Wayland are dynamically loaded by winit and need explicit runtime deps.
    dependencies += ", libxkbcommon0, libxkbcommon-x11-0, libx11-6, libxcursor1, libxi6, libxrandr2, libwayland-client0, libwayland-cursor0, libwayland-egl1, libegl1, libgl1"
    (control / "control").write_text(
        f"Package: unison\nVersion: {VERSION}\nArchitecture: {arch}\n"
        "Maintainer: Mohammad Fakhari (Nahur1) <51950495+Nahur1@users.noreply.github.com>\n"
        f"Depends: {dependencies}\nRecommends: ffmpeg, yt-dlp\nSection: sound\nPriority: optional\n"
        f"Installed-Size: {sum(p.stat().st_size for p in stage.rglob('*') if p.is_file()) // 1024}\n"
        "Homepage: https://github.com/Nahur1/unison\n"
        "Description: Unison music and video player with offline Persian subtitles\n", encoding="utf-8")
    output = DIST / f"unison-{VERSION}-linux-{arch}.deb"
    command("dpkg-deb", "--root-owner-group", "--build", stage, output)
    return output


def macos():
    arch = platform.machine()
    volume = DIST / f"macos-{arch}"
    app = volume / "Unison Player.app"
    contents = app / "Contents"
    executable = contents / "MacOS/unison"
    if volume.exists():
        raise ValueError(f"Staging folder already exists: {volume}")
    resources(contents / "Resources")
    executable.parent.mkdir(parents=True)
    shutil.copy2(ROOT / "target/release/unison", executable)
    executable.chmod(0o755)
    info = plistlib.loads((ROOT / "packaging/macos/Info.plist").read_bytes())
    info.update(CFBundleShortVersionString=VERSION, CFBundleVersion=VERSION, LSMinimumSystemVersion="15.0")
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    iconset = DIST / f"unison-{arch}.iconset"
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
            command("sips", "-z", size * scale, size * scale, ROOT / "ui/icons/unison-512.png",
                    "--out", iconset / name)
    command("iconutil", "-c", "icns", iconset, "-o", contents / "Resources/unison.icns")
    # Recursively vendor libmpv and all non-system dylibs; use relative load paths.
    command("dylibbundler", "-od", "-b", "-x", executable,
            "-d", contents / "Frameworks", "-p", "@executable_path/../Frameworks/")
    # Ship dependency license receipts from Homebrew alongside the dylibs.
    cellar = Path(subprocess.check_output(["brew", "--cellar"], text=True).strip())
    receipts = contents / "Resources/licenses/homebrew"
    for formula in sorted(cellar.iterdir()):
        for receipt in formula.glob("*/.brew/*.rb"):
            target = receipts / formula.name
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy2(receipt, target / receipt.name)
        for entry in formula.glob("*/*"):
            if entry.is_file() and any(key in entry.name.upper() for key in ("LICENSE", "COPYING", "COPYRIGHT")):
                target = receipts / formula.name
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry, target / entry.name)
    for binary in [executable, *sorted((contents / "Frameworks").glob("*.dylib"))]:
        deduplicate_rpaths(binary)
        linked = subprocess.check_output(["otool", "-L", str(binary)], text=True)
        for line in linked.splitlines()[1:]:
            dependency = line.strip().split(" (", 1)[0]
            if not dependency.startswith(("@", "/usr/lib/", "/System/Library/")):
                raise ValueError(f"Non-relocatable dependency in {binary}: {dependency}")
    # Ad-hoc signing is required for Apple Silicon after rewriting load paths.
    for dylib in sorted((contents / "Frameworks").glob("*.dylib")):
        command("codesign", "--force", "--sign", "-", dylib)
    command("codesign", "--force", "--deep", "--sign", "-", app)
    command("codesign", "--verify", "--deep", "--strict", app)
    (volume / "Applications").symlink_to("/Applications")
    output = DIST / f"unison-{VERSION}-macos-{arch}.dmg"
    command("hdiutil", "create", "-volname", "Unison Player", "-srcfolder", volume,
            "-ov", "-format", "UDZO", output)
    command("hdiutil", "verify", output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=["linux", "macos"])
    args = parser.parse_args()
    DIST.mkdir(exist_ok=True)
    output = linux() if args.platform == "linux" else macos()
    sha = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + ".sha256").write_text(f"{sha}  {output.name}\n", encoding="utf-8")
    print(json.dumps(dict(package=str(output), sha256=sha)))
