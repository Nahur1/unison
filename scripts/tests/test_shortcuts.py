from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ShortcutTests(unittest.TestCase):
    def setUp(self):
        self.ui = (ROOT / "ui/app.slint").read_text(encoding="utf-8")
        start = self.ui.index("keys := FocusScope {")
        self.handler = self.ui[start:self.ui.index("                reject\n", start)]

    def test_letter_shortcuts_understand_the_persian_layout(self):
        # Comparing e.text with a Latin letter breaks as soon as the Persian
        # keyboard layout is active; letters must go through shortcut-key().
        raw = re.findall(r'e\.text == "[A-Za-z,]"', self.handler)
        self.assertEqual(raw, [])
        for latin, persian in {"f": "ب", "t": "ف", "m": "پ", "n": "د", "p": "ح", "o": "خ", ",": "و"}.items():
            self.assertRegex(self.ui, rf'if \(t == .*"{re.escape(persian)}".*\) {{ return "{re.escape(latin)}"; }}')

    def test_keyboard_returns_to_shortcuts_when_panels_close(self):
        for flag in ("show-notes", "show-settings", "show-equalizer", "show-link-sheet", "show-translation"):
            self.assertIn(f"changed {flag} => {{ if !self.{flag} {{ keys.focus(); }} }}", self.ui)


if __name__ == "__main__":
    unittest.main()
