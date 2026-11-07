import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('contributors', Path(__file__).resolve().parents[1] / 'check-contributors.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
OWNER = '51950495+Nahur1@users.noreply.github.com'
REZA = '63972210+reza-hashemian@users.noreply.github.com'
class ContributorTests(unittest.TestCase):
    def test_both_accounts_and_web_merge(self):
        self.assertEqual(policy.validate(OWNER, REZA, 'Change'), [])
        self.assertEqual(policy.validate(REZA, 'noreply@github.com', 'Change'), [])
    def test_unknown_human_and_ai(self):
        for email in ('stranger@example.com', 'claude@anthropic.com', 'codex@openai.com', 'gemini@google.com'):
            self.assertTrue(policy.validate(email, OWNER, 'Change'))
            self.assertTrue(policy.validate(OWNER, email, 'Change'))
            self.assertTrue(policy.validate(OWNER, OWNER, 'Change\nCo-Authored-By: Person <' + email + '>'))
    def test_coauthors(self):
        self.assertEqual(policy.validate(OWNER, OWNER, 'Change\nCo-Authored-By: Reza <' + REZA + '>'), [])
        self.assertTrue(policy.validate(OWNER, OWNER, 'Change\nco-authored-by: invalid'))
        self.assertTrue(policy.validate('noreply@github.com', OWNER, 'Change'))

    def test_ai_name_with_approved_email(self):
        self.assertTrue(policy.validate(OWNER, OWNER, 'Change', 'Claude', 'Nahur1'))
        self.assertTrue(policy.validate(OWNER, OWNER, 'Co-Authored-By: ChatGPT <' + OWNER + '>'))
