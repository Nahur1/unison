import importlib.util
import hashlib
import tempfile
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('publisher',Path(__file__).resolve().parents[1]/'publish-release.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
class MobileAssetsTests(unittest.TestCase):
    def test_requires_both_mobile_packages_and_exact_checksums(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for suffix in ('android.apk','pwa.zip'):
                package=root/f'unison-0.5.0-{suffix}';package.write_bytes(b'fixture-'+suffix.encode())
                package.with_suffix(package.suffix+'.sha256').write_text(hashlib.sha256(package.read_bytes()).hexdigest()+'  '+package.name+'\n')
            self.assertEqual(len(publisher.mobile_assets(root,'0.5.0')),4)
            (root/'unison-0.5.0-android.apk').write_bytes(b'tampered')
            with self.assertRaises(ValueError):publisher.mobile_assets(root,'0.5.0')
