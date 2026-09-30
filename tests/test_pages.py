import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_pages", ROOT / "tools" / "build_pages.py")
BUILD_PAGES = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(BUILD_PAGES)


class PagesBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name)
        self.project = self.workspace / "game"
        (self.project / "src" / "nested").mkdir(parents=True)
        (self.project / "tools").mkdir()
        for name in BUILD_PAGES.ROOT_ASSETS:
            (self.project / name).write_text(f"public {name}\n", encoding="utf-8")
        (self.project / "index.html").write_text(
            '<link rel="stylesheet" href="src/theme.css">\n'
            '<script type="module" src="src/app.js"></script>\n',
            encoding="utf-8",
        )
        (self.project / "elements.html").write_text(
            '<script type="module" src="src/app.js"></script>\n', encoding="utf-8"
        )
        (self.project / "package.json").write_text(
            json.dumps({"name": "fixture", "version": "1.2.3"}),
            encoding="utf-8",
        )
        (self.project / "src" / "app.js").write_text(
            "import './nested/helper.js';\nexport {};\n", encoding="utf-8"
        )
        (self.project / "src" / "nested" / "helper.js").write_text(
            "export const helper = true;\n", encoding="utf-8"
        )
        (self.project / "src" / "theme.css").write_text("body {}\n", encoding="utf-8")
        self._write_manifest(
            ["src/app.js", "src/nested/helper.js", "src/theme.css"]
        )

    def _write_manifest(self, source_assets):
        (self.project / "tools" / "pages-assets.json").write_text(
            json.dumps({"sourceAssets": source_assets}), encoding="utf-8"
        )

    def test_stages_only_public_allowlist_and_version(self):
        private_files = {
            "AGENTS.md": "operator instructions",
            "stigmergicmemory.md": "private continuity",
            ".env": "SECRET=value",
            "README.md": "documentation",
            "tools/serve.py": "private tool",
            "tests/fixture.json": "private fixture",
            "docs/handoffs/private.md": "private handoff",
            "src/settings.json": '{"private": true}',
            "src/.operator.js": "throw new Error('private')",
            "src/private.js": "export const privateValue = true;",
            "src/private.css": ".private {}",
            "src/node_modules/private-package/index.js": "export default 'private';",
        }
        for relative, content in private_files.items():
            path = self.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

        output = BUILD_PAGES.build_pages(
            self.project, output="public", git_sha="A" * 40
        )
        staged = {
            path.relative_to(output).as_posix()
            for path in output.rglob("*")
            if path.is_file()
        }
        self.assertEqual(
            staged,
            {
                ".nojekyll",
                "elements.css",
                "elements.html",
                "index.html",
                "LICENSE",
                "src/app.js",
                "src/nested/helper.js",
                "src/theme.css",
                "style.css",
                "version.json",
            },
        )
        self.assertEqual(
            json.loads((output / "version.json").read_text(encoding="utf-8")),
            {"gitSha": "a" * 40, "version": "1.2.3"},
        )
        self.assertIn(
            "import './nested/helper.js'",
            (output / "src" / "app.js").read_text(encoding="utf-8"),
        )

    def test_cli_bases_relative_output_at_relative_project_root(self):
        command = [
            sys.executable,
            str(ROOT / "tools" / "build_pages.py"),
            "--project-root",
            "game",
            "--output",
            "site",
            "--git-sha",
            "b" * 40,
        ]
        result = subprocess.run(
            command,
            cwd=self.workspace,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), self.project / "site")
        self.assertTrue((self.project / "site" / "index.html").is_file())
        self.assertFalse((self.workspace / "site").exists())

    def test_existing_output_is_preserved_and_refused(self):
        output = self.project / ".pages-site"
        output.mkdir()
        sentinel = output / "do-not-delete.txt"
        sentinel.write_text("keep me", encoding="utf-8")

        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "already exists"):
            BUILD_PAGES.build_pages(self.project, git_sha="c" * 40)

        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep me")

    def test_refuses_destinations_that_could_overwrite_sources(self):
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "project root"):
            BUILD_PAGES.build_pages(self.project, output=".", git_sha="d" * 40)
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "source directory"):
            BUILD_PAGES.build_pages(
                self.project, output="src/generated-site", git_sha="d" * 40
            )

    def test_refuses_source_symlinks_without_creating_output(self):
        outside = self.workspace / "outside.js"
        outside.write_text("export const secret = true;\n", encoding="utf-8")
        link = self.project / "src" / "escaped.js"
        try:
            link.symlink_to(outside)
        except OSError as error:
            self.skipTest(f"symbolic links unavailable: {error}")
        self._write_manifest(
            [
                "src/app.js",
                "src/escaped.js",
                "src/nested/helper.js",
                "src/theme.css",
            ]
        )

        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "symbolic link"):
            BUILD_PAGES.build_pages(self.project, git_sha="e" * 40)
        self.assertFalse((self.project / ".pages-site").exists())

        link.unlink()
        self._write_manifest(
            ["src/app.js", "src/nested/helper.js", "src/theme.css"]
        )
        shutil.rmtree(self.project / "src" / "nested")
        outside_directory = self.workspace / "outside-directory"
        outside_directory.mkdir()
        (outside_directory / "helper.js").write_text("export {};\n", encoding="utf-8")
        (self.project / "src" / "nested").symlink_to(
            outside_directory, target_is_directory=True
        )
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "parent.*symbolic link"):
            BUILD_PAGES.build_pages(self.project, git_sha="e" * 40)

    def test_refuses_unsafe_manifest_paths_and_output_symlinks(self):
        self._write_manifest(["src/app.js", "../outside.js"])
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "unsafe Pages asset path"):
            BUILD_PAGES.build_pages(self.project, git_sha="f" * 40)

        self._write_manifest(
            ["src/app.js", "src/nested/helper.js", "src/theme.css"]
        )
        outside = self.workspace / "existing-site"
        outside.mkdir()
        sentinel = outside / "sentinel.txt"
        sentinel.write_text("keep", encoding="utf-8")
        output_link = self.project / ".pages-site"
        try:
            output_link.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symbolic links unavailable: {error}")
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "already exists"):
            BUILD_PAGES.build_pages(self.project, git_sha="f" * 40)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_invalid_manifest_or_sha_leaves_no_output(self):
        (self.project / "package.json").write_text("not json", encoding="utf-8")
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "invalid package"):
            BUILD_PAGES.build_pages(self.project, git_sha="f" * 40)
        self.assertFalse((self.project / ".pages-site").exists())

        (self.project / "package.json").write_text(
            json.dumps({"version": "1.2.3"}), encoding="utf-8"
        )
        with self.assertRaisesRegex(BUILD_PAGES.BuildError, "40 hexadecimal"):
            BUILD_PAGES.build_pages(self.project, git_sha="not-a-sha")
        self.assertFalse((self.project / ".pages-site").exists())

    def test_repository_manifest_is_complete_for_runtime_imports(self):
        files = BUILD_PAGES._source_files(ROOT)
        source_paths = {
            relative.as_posix()
            for _source, relative in files
            if relative.parts[0] == "src"
        }
        manifest = json.loads(
            (ROOT / "tools" / "pages-assets.json").read_text(encoding="utf-8")
        )
        self.assertTrue(source_paths)
        self.assertEqual(source_paths, set(manifest["sourceAssets"]))


if __name__ == "__main__":
    unittest.main()
