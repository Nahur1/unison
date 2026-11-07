import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("packager", Path(__file__).parents[1] / "package-unix.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def loads(*paths):
    return "\n".join(f"Load command 1\n          cmd LC_RPATH\n      cmdsize 64\n         path {path} (offset 12)" for path in paths)


class MacPackagingTests(unittest.TestCase):
    def test_duplicate_rpath_after_bundling_removed_without_losing_search_path(self):
        value = "@executable_path/../Frameworks/"
        for remaining in (loads(value), loads()):
            with patch.object(packager.subprocess, "check_output", side_effect=[loads(value, value), remaining]), \
                 patch.object(packager, "command") as command:
                packager.deduplicate_rpaths("Player.app/Contents/MacOS/unison")
                self.assertEqual(command.call_args_list[0].args[:3], ("install_name_tool", "-delete_rpath", value))
                self.assertEqual(command.call_count, 1 if remaining else 2)
                if not remaining:
                    self.assertEqual(command.call_args_list[1].args[:3], ("install_name_tool", "-add_rpath", value))

    def test_distinct_rpaths_preserved(self):
        paths = ("@executable_path/../Frameworks/", "/usr/lib/swift", "/a path/with spaces")
        self.assertEqual(packager.macho_rpaths(loads(*paths)), list(paths))
        with patch.object(packager.subprocess, "check_output", return_value=loads(*paths)), \
             patch.object(packager, "command") as command:
            packager.deduplicate_rpaths("binary")
            command.assert_not_called()


class DebianDependencyTests(unittest.TestCase):
    def test_either_libmpv_soname_satisfies_the_package(self):
        deps = packager.debian_dependencies("shlibs:Depends=libc6 (>= 2.34), libmpv1 (>= 0.29), libssl3\n")
        self.assertEqual(deps, "libc6 (>= 2.34), libssl3, libmpv2 | libmpv1")
        self.assertEqual(packager.debian_dependencies("shlibs:Depends=libc6 (>= 2.34)"), "libc6 (>= 2.34), libmpv2 | libmpv1")
