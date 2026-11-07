"""Publish a tested Actions build without exposing incomplete update assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def version_parts(value):
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise ValueError(f"Expected a stable X.Y.Z version, got {value!r}")
    return tuple(map(int, value.split(".")))


def verify_assets(directory, repository):
    directory = Path(directory)
    manifest = json.loads((directory / "latest.json").read_text(encoding="utf-8-sig"))
    version = manifest["version"]
    version_parts(version)
    installer = directory / f"unison-setup-{version}.exe"
    expected = f"https://github.com/{repository}/releases/download/v{version}/{installer.name}"
    if manifest["url"] != expected:
        raise ValueError("Update manifest points to an unexpected repository or version")
    digest = hashlib.sha256(installer.read_bytes()).hexdigest()
    if not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"]) or digest != manifest["sha256"]:
        raise ValueError("Installer checksum does not match latest.json")
    if installer.stat().st_size == 0:
        raise ValueError("Installer is empty")
    return version, installer


def release_plan(version, commit, main_commit, existing, latest):
    if commit != main_commit:
        return "skip: a newer main commit is waiting to build"
    if existing and not existing["draft"]:
        return "skip: this version is already published; increase Cargo.toml version for the next update"
    if latest and version_parts(latest["tag_name"].removeprefix("v")) >= version_parts(version):
        return "skip: a release at this version or newer is already latest"
    if existing and existing["target_commitish"] != commit:
        raise ValueError("An existing draft belongs to a different commit; refusing to overwrite it")
    return "publish"


def gh(*args, optional=False, input_json=None):
    result = subprocess.run(["gh", *args], text=True, encoding="utf-8", capture_output=True,
                            input=json.dumps(input_json) if input_json is not None else None)
    if result.returncode:
        if optional and "HTTP 404" in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip() or f"GitHub CLI exited {result.returncode}")
    return result.stdout


def api(path, optional=False, payload=None):
    args = ["api", path, "--header", "Cache-Control: no-cache"]
    if payload is not None:
        args += ["--method", "POST", "--input", "-"]
    result = gh(*args, optional=optional, input_json=payload)
    return json.loads(result) if result is not None else None


def tagged_release(base, tag):
    # The by-tag endpoint only promises published releases. Authenticated lists
    # also include drafts, which lets a failed upload be resumed safely.
    pages = json.loads(gh("api", "--paginate", "--slurp", "--header", "Cache-Control: no-cache", f"{base}/releases?per_page=100"))
    return next((release for page in pages for release in page if release["tag_name"] == tag), None)


def summary(message):
    print(message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(message + "\n")


def platform_assets(directory, version):
    """All three native Unix packages are required for a cross-platform release."""
    root = Path(directory)
    paths = []
    for suffix in ("linux-amd64.deb", "macos-arm64.dmg", "macos-x86_64.dmg"):
        package = root / f"unison-{version}-{suffix}"
        checksum = package.with_suffix(package.suffix + ".sha256")
        expected = f"{hashlib.sha256(package.read_bytes()).hexdigest()}  {package.name}"
        if not package.stat().st_size or checksum.read_text(encoding="utf-8").strip() != expected:
            raise ValueError(f"Invalid package/checksum: {package.name}")
        paths += [package, checksum]
    return paths


def publish(directory, repository, commit, cross_platform=False):
    if repository != "Nahur1/unison" or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Publishing requires the official repository and a full commit SHA")
    version, installer = verify_assets(directory, repository)
    upload_paths = [installer, Path(directory) / "latest.json"]
    if cross_platform:
        upload_paths += platform_assets(directory, version)
    declared = re.search(r'^version = "([^"]+)"', Path("Cargo.toml").read_text(encoding="utf-8"), re.MULTILINE)
    if not declared or version != declared.group(1):
        raise ValueError("Build artifacts do not match the checked-out package version")
    tag = f"v{version}"
    base = f"repos/{repository}"
    main_commit = api(f"{base}/git/ref/heads/main")["object"]["sha"]
    existing = tagged_release(base, tag)
    latest = api(f"{base}/releases/latest", optional=True)
    plan = release_plan(version, commit, main_commit, existing, latest)
    if plan != "publish":
        summary(plan)
        return
    # Keep the release private until both update files have been uploaded.
    if not existing:
        notes = Path("docs/releases") / f"{version}.md"
        # Use the creation response's ID directly: a newly created draft can
        # take time to appear in GitHub's release list.
        existing = api(f"{base}/releases", payload={
            "tag_name": tag, "target_commitish": commit, "draft": True,
            "name": f"Unison Player {version}",
            "body": notes.read_text(encoding="utf-8") if notes.is_file() else f"Unison Player {version}",
        })
    gh("release", "upload", tag, *map(str, upload_paths),
       "--repo", repository, "--clobber")
    draft = api(f"{base}/releases/{existing['id']}")
    assets = {asset["name"]: asset["size"] for asset in draft["assets"]}
    for path in upload_paths:
        if assets.get(path.name) != path.stat().st_size:
            raise ValueError(f"Release upload missing or incomplete: {path.name}")
    # Recheck after uploads: a different build must not become latest behind us.
    main_commit = api(f"{base}/git/ref/heads/main")["object"]["sha"]
    latest = api(f"{base}/releases/latest", optional=True)
    plan = release_plan(version, commit, main_commit, draft, latest)
    if plan != "publish":
        summary(plan + "; the unpublished draft is retained")
        return
    gh("release", "edit", tag, "--repo", repository, "--draft=false", "--latest")
    published = api(f"{base}/releases/latest")
    if published["tag_name"] != tag or published["draft"]:
        raise ValueError("Release did not become the latest public version")
    summary(f"Published [{tag}](https://github.com/{repository}/releases/tag/{tag}) with verified update assets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--cross-platform", action="store_true")
    args = parser.parse_args()
    publish(args.artifact_dir, args.repository, args.commit, args.cross_platform)
