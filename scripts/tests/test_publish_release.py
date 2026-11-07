import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import re

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).parents[1] / "publish-release.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class ReleaseTests(unittest.TestCase):
    def test_cross_platform_release_requires_all_verified_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(FileNotFoundError):
                publisher.platform_assets(root, "0.3.6")
            for suffix in ("linux-amd64.deb", "macos-arm64.dmg", "macos-x86_64.dmg"):
                path = root / f"unison-0.3.6-{suffix}"
                path.write_bytes(b"native package fixture")
                path.with_suffix(path.suffix + ".sha256").write_text(
                    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")
            self.assertEqual(len(publisher.platform_assets(root, "0.3.6")), 6)
            path.write_bytes(b"corrupted download")
            with self.assertRaises(ValueError):
                publisher.platform_assets(root, "0.3.6")

    def test_verified_assets_and_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / "unison-setup-0.3.4.exe"
            installer.write_bytes(b"installer fixture")
            manifest = dict(version="0.3.4", sha256=hashlib.sha256(installer.read_bytes()).hexdigest(),
                            url="https://github.com/Nahur1/unison/releases/download/v0.3.4/unison-setup-0.3.4.exe")
            (root / "latest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertEqual(publisher.verify_assets(root, "Nahur1/unison")[0], "0.3.4")
            installer.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                publisher.verify_assets(root, "Nahur1/unison")

    def test_wrong_repository_and_path_versions(self):
        for value in ["../0.3.4", "0.3.4-beta", "v0.3.4", "1.2"]:
            with self.assertRaises(ValueError):
                publisher.version_parts(value)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "latest.json").write_text(json.dumps(dict(version="0.3.4", sha256="0" * 64, url="https://example.com/installer")))
            with self.assertRaises(ValueError):
                publisher.verify_assets(root, "Nahur1/unison")

    def test_new_release_and_retry_same_draft(self):
        latest = dict(tag_name="v0.3.3")
        self.assertEqual(publisher.release_plan("0.3.4", "a", "a", None, latest), "publish")
        draft = dict(draft=True, target_commitish="a")
        self.assertEqual(publisher.release_plan("0.3.4", "a", "a", draft, latest), "publish")

    def test_published_assets_never_overwritten(self):
        plan = publisher.release_plan("0.3.4", "a", "a", dict(draft=False), None)
        self.assertTrue(plan.startswith("skip:"))

    def test_old_build_never_replaces_newer_release(self):
        self.assertTrue(publisher.release_plan("0.3.4", "a", "a", None, dict(tag_name="v0.3.5")).startswith("skip:"))
        self.assertTrue(publisher.release_plan("0.3.4", "a", "b", None, None).startswith("skip:"))

    def test_unrelated_draft_never_overwritten(self):
        with self.assertRaises(ValueError):
            publisher.release_plan("0.3.4", "a", "a", dict(draft=True, target_commitish="b"), None)

    def test_new_draft_uses_creation_id_without_waiting_for_release_list(self):
        version = re.search(r'^version = "([^"]+)"', Path("Cargo.toml").read_text(), re.MULTILINE).group(1)
        commit = "a" * 40
        latest_reads = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / f"unison-setup-{version}.exe"
            installer.write_bytes(b"installer")
            (root / "latest.json").write_text(json.dumps(dict(
                version=version, sha256=hashlib.sha256(installer.read_bytes()).hexdigest(),
                url=f"https://github.com/Nahur1/unison/releases/download/v{version}/{installer.name}")))
            draft = dict(id=7, draft=True, target_commitish=commit)

            def fake_api(path, optional=False, payload=None):
                if path.endswith("/git/ref/heads/main"):
                    return {"object": {"sha": commit}}
                if path.endswith("/releases/latest"):
                    latest_reads.append(True)
                    return dict(tag_name=f"v{version}" if len(latest_reads) == 3 else "v0.0.0", draft=False)
                if path.endswith("/releases") and payload is not None:
                    self.assertTrue(payload["draft"])
                    self.assertEqual(payload["target_commitish"], commit)
                    return draft
                if path.endswith("/releases/7"):
                    return dict(draft, assets=[dict(name=p.name, size=p.stat().st_size)
                                              for p in [installer, root / "latest.json"]])
                self.fail(f"Unexpected API request: {path}")

            with patch.object(publisher, "tagged_release", return_value=None) as lookup, \
                 patch.object(publisher, "api", side_effect=fake_api), \
                 patch.object(publisher, "gh", return_value="") as cli, \
                 patch.object(publisher, "summary"):
                publisher.publish(root, "Nahur1/unison", commit)
                self.assertEqual(lookup.call_count, 1)
                self.assertEqual([call.args[1] for call in cli.call_args_list], ["upload", "edit"])


if __name__ == "__main__":
    unittest.main()
