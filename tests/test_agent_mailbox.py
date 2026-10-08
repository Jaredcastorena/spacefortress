"""Focused standard-library CLI checks; no gameplay dependencies."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "agent_mailbox.py"


class MailboxTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.mailbox = self.root / "mailbox.md"

    def write(self, text):
        self.mailbox.write_text(text, encoding="utf-8")

    def cli(self, *args, index=None):
        command = [sys.executable, str(SCRIPT), "--file", str(self.mailbox)]
        if index:
            command += ["--index", str(index)]
        return subprocess.run(command + list(args), text=True, capture_output=True)

    def index(self):
        raw = self.mailbox.read_bytes()
        data = dict(archive=str(self.mailbox), sha256=hashlib.sha256(raw).hexdigest(),
                    byte_count=len(raw), line_count=4,
                    entries=[dict(id="chat-one", start_line=1, end_line=2),
                             dict(id="chat-two", start_line=3, end_line=4)])
        path = self.root / "index.json"
        if path.exists():
            path.chmod(0o644)
        path.write_text(json.dumps(data), encoding="utf-8")
        path.chmod(0o444)
        self.mailbox.chmod(0o444)
        return path, data

    def change_index(self, path, data):
        path.chmod(0o644)
        path.write_text(json.dumps(data), encoding="utf-8")
        path.chmod(0o444)

    def assert_error(self, result, message):
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn(message, result.stderr)
        self.assertLess(len(result.stderr), 350)

    def test_bounded_listing_continuation(self):
        self.write("preamble\n" + "".join(f"### chat-{i}\nbody\n" for i in range(25)))
        first = self.cli("list")
        self.assertEqual(first.returncode, 0)
        self.assertEqual(len(first.stdout.splitlines()), 11)
        self.assertIn("next_offset=10 total=25 complete=false", first.stdout)
        final = self.cli("list", "--offset", "20", "--limit", "5")
        self.assertIn("next_offset=25 total=25 complete=true", final.stdout)
        self.assertNotIn("chat-19 ", final.stdout)
        self.assert_error(self.cli("list", "--offset", "26"), "exceeds")

    def test_exact_missing_id_and_entry_boundary(self):
        self.write("### chat-one\nfirst\n### chat-one-more\nsecond\n")
        result = self.cli("read", "chat-one")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(result.stdout.endswith("### chat-one\nfirst\n"))
        self.assertNotIn("second", result.stdout)
        self.assert_error(self.cli("read", "chat-on"), "missing mailbox ID")

    def test_duplicate_ids_rejected_for_list_and_read(self):
        self.write("### chat-one\nx\n### chat-one\ny\n")
        for command in [("list",), ("read", "chat-one")]:
            self.assert_error(self.cli(*command), "duplicate mailbox ID")

    def test_huge_single_line_and_unicode_continuation(self):
        text = "### chat-huge\n" + "🛸é" * 500000 + "\n"
        self.write(text)
        first = self.cli("read", "chat-huge", "--max-chars", "37")
        self.assertEqual(first.returncode, 0)
        self.assertEqual(first.stdout.split("\n", 1)[1], text[:37] + "\n")
        self.assertIn("next_offset=37 complete=false", first.stdout)
        later = self.cli("read", "chat-huge", "--offset", "37", "--max-chars", "31")
        self.assertEqual(later.stdout.split("\n", 1)[1], text[37:68] + "\n")
        self.assertLess(len(later.stdout), 200)
        default = self.cli("read", "chat-huge")
        self.assertLessEqual(len(default.stdout), 3400)

    def test_line_limit_and_end_offsets(self):
        text = "### chat-one\na\nb\n"
        self.write(text)
        first = self.cli("read", "chat-one", "--max-lines", "2")
        offset = len("### chat-one\na\n")
        self.assertIn(f"next_offset={offset} complete=false", first.stdout)
        final = self.cli("read", "chat-one", "--offset", str(offset))
        self.assertTrue(final.stdout.endswith("\nb\n"))
        self.assertIn("complete=true", final.stdout)
        self.assertIn("complete=true", self.cli("read", "chat-one", "--offset", str(len(text))).stdout)
        self.assert_error(self.cli("read", "chat-one", "--offset", str(len(text) + 1)), "exceeds")

    def test_nonterminated_and_crlf_lines(self):
        self.mailbox.write_bytes(b"preamble\r\n### chat-one\r\nx\r\n### chat-two\r\ny")
        result = self.cli("list")
        self.assertEqual(result.returncode, 0)
        self.assertIn("chat-one lines=2-3", result.stdout)
        self.assertIn("chat-two lines=4-5", result.stdout)
        self.assertTrue(self.cli("read", "chat-two").stdout.endswith("y\n"))

    def test_valid_index(self):
        self.write("### chat-one\nx\n### chat-two\ny\n")
        path, _ = self.index()
        result = self.cli("read", "chat-two", index=path)
        self.assertEqual(result.returncode, 0)
        self.assertTrue(result.stdout.endswith("### chat-two\ny\n"))

    def test_tampered_archive_and_hash(self):
        self.write("### chat-one\nx\n### chat-two\ny\n")
        path, data = self.index()
        data["sha256"] = "0" * 64
        self.change_index(path, data)
        self.assert_error(self.cli("list", index=path), "sha256 mismatch")
        path, _ = self.index()
        self.mailbox.chmod(0o644)
        self.write("### chat-one\nz\n### chat-two\ny\n")
        self.mailbox.chmod(0o444)
        self.assert_error(self.cli("read", "chat-one", index=path), "sha256 mismatch")

    def test_bad_index_addresses_missing_duplicate_and_types(self):
        self.write("### chat-one\nx\n### chat-two\ny\n")
        path, original = self.index()
        for mutate in [lambda x: x["entries"][0].update(start_line=2),
                       lambda x: x["entries"].pop(),
                       lambda x: x["entries"].append(x["entries"][0]),
                       lambda x: x["entries"][0].update(start_line=True),
                       lambda x: x.update(entries=None)]:
            data = json.loads(json.dumps(original))
            mutate(data)
            self.change_index(path, data)
            self.assert_error(self.cli("list", index=path), "heading/line addresses mismatch")

    def test_bad_index_metadata_path_json_and_mutability(self):
        self.write("### chat-one\nx\n### chat-two\ny\n")
        path, original = self.index()
        for key, value in [("archive", "other.md"), ("byte_count", 1), ("line_count", 5)]:
            data = dict(original, **{key: value})
            self.change_index(path, data)
            self.assert_error(self.cli("list", index=path), "mismatch" if key != "archive" else "does not match")
        path.chmod(0o644)
        path.write_text('{"archive":"a","archive":"b"}')
        path.chmod(0o444)
        self.assert_error(self.cli("list", index=path), "duplicate index key")
        path.chmod(0o644)
        path.write_text("broken")
        path.chmod(0o444)
        self.assert_error(self.cli("list", index=path), "error:")
        path.chmod(0o644)
        self.assert_error(self.cli("list", index=path), "immutable")
        path.chmod(0o444)
        self.mailbox.chmod(0o644)
        self.assert_error(self.cli("list", index=path), "immutable")

    def test_read_only_and_argument_caps(self):
        self.write("### chat-one\nx\n")
        before = self.mailbox.stat(), self.mailbox.read_bytes()
        self.assertEqual(self.cli("read", "chat-one").returncode, 0)
        after = self.mailbox.stat(), self.mailbox.read_bytes()
        self.assertEqual(before[1], after[1])
        self.assertEqual(before[0].st_mtime_ns, after[0].st_mtime_ns)
        for args in [("list", "--limit", "21"), ("read", "chat-one", "--max-chars", "12001"),
                     ("read", "chat-one", "--max-lines", "81"), ("read", "chat-one", "--offset", "-1")]:
            self.assert_error(self.cli(*args), "must be between")
        help_result = self.cli("--help")
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("Unicode characters", help_result.stdout)


if __name__ == "__main__":
    unittest.main()
