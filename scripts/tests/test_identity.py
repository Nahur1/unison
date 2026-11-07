"""Protect the display-name/technical-name split and independent installation."""
import base64
import json
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


class IdentityTests(unittest.TestCase):
    def test_project_cli_and_repository_identity(self):
        cargo = (ROOT / "Cargo.toml").read_text(encoding="utf-8")
        self.assertRegex(cargo, r'\[package\]\s+name = "unison"')
        self.assertRegex(cargo, r'\[\[bin\]\]\s+name = "unison"')
        self.assertNotIn('name = "unison-player"', cargo)
        self.assertIn('repository = "https://github.com/Nahur1/unison"', cargo)
        self.assertIn('https://github.com/Nahur1/unison/releases/latest/download/latest.json',
                      (ROOT / "src/updater.rs").read_text())

    def test_display_name_and_separate_installer_identity(self):
        installer = (ROOT / "packaging/windows/unison.iss").read_text()
        self.assertIn('AppName=Unison Player', installer)
        self.assertIn('DefaultDirName={autopf}\\Unison', installer)
        self.assertIn('13A77F89-D5AC-4ECC-A660-FE6C31B12D79', installer)
        self.assertNotIn('3B1C2C37-4876-48D1-93EC-94014678813D', installer)
        self.assertIn('CFBundleExecutable</key><string>unison', (ROOT / "packaging/macos/Info.plist").read_text())
        self.assertIn('Name=Unison Player', (ROOT / "packaging/linux/unison.desktop").read_text())
        self.assertIn('Exec=unison %U', (ROOT / "packaging/linux/unison.desktop").read_text())

    def test_exported_icon_uses_selected_master(self):
        svg = ET.fromstring((ROOT / "ui/icons/unison.svg").read_text())
        image = next(iter(svg))
        href = image.attrib['{http://www.w3.org/1999/xlink}href']
        self.assertEqual(base64.b64decode(href.split(',', 1)[1]),
                         (ROOT / "design/unison/unison-icon-v1.png").read_bytes())
        for size in (32, 64, 128, 256, 512):
            self.assertTrue((ROOT / f"ui/icons/unison-{size}.png").is_file())

    def test_current_sources_do_not_use_previous_product_identifiers(self):
        for directory in ('src', 'ui', 'scripts'):
            for path in (ROOT / directory).rglob('*'):
                if path.suffix not in ('.rs', '.slint', '.py', '.ps1'):
                    continue
                text = path.read_text(encoding='utf-8')
                self.assertIsNone(re.search(r'\b[Kk][Aa][Gg][Hh][Aa][Zz]\b', text), str(path))

    def test_external_seed_is_pinned_and_shared_hooks_allow_humans(self):
        seed = json.loads((ROOT / 'packaging/dependencies.json').read_text())['windows_playback_seed']
        self.assertRegex(seed['sha256'], r'^[a-f0-9]{64}$')
        for name in ('commit-msg', 'pre-push'):
            hook = (ROOT / '.githooks' / name).read_text()
            self.assertNotIn('Nahur1 <', hook)
            self.assertNotIn('grep -Fvx', hook)
