#!/usr/bin/env python3
"""Read private coordination mailboxes without dumping their history.

Examples (global options precede the command):
  python3 tools/agent_mailbox.py list --limit 10
  python3 tools/agent_mailbox.py read chat-20261008T103521Z-root-coordination-helper
  python3 tools/agent_mailbox.py read EXACT_ID --offset 3200
  python3 tools/agent_mailbox.py --file ARCHIVE --index INDEX read EXACT_ID

Read offsets count Unicode characters from the entry heading, including newlines.
List offsets count entries. Both commands print the next offset and completion.
Archives and indexes are read only; an optional index must describe an immutable
archive exactly, including its SHA-256, byte/line counts and all entry addresses.
"""

import argparse
import codecs
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HEADING = re.compile(rb"### (chat-[A-Za-z0-9][A-Za-z0-9_-]{0,191})[ \t]*\r?\n?\Z")
CHUNK = 8192


def bounded_integer(minimum, maximum):
    def parse(value):
        number = int(value)
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"must be between {minimum} and {maximum}")
        return number
    return parse


def scan(stream):
    """Track byte/line addresses using a fixed-size prefix even for giant lines."""
    digest = hashlib.sha256()
    entries, seen = [], set()
    prefix = b""
    line_start = position = line_count = 0

    def finish_line(end):
        nonlocal prefix, line_start, line_count
        line_count += 1
        match = HEADING.fullmatch(prefix) if end - line_start <= 256 else None
        if match:
            entry_id = match[1].decode("ascii")
            if entry_id in seen:
                raise ValueError(f"duplicate mailbox ID: {entry_id}")
            seen.add(entry_id)
            if entries:
                entries[-1].update(end_line=line_count - 1, end_byte=line_start)
            entries.append(dict(id=entry_id, start_line=line_count, start_byte=line_start))
        prefix, line_start = b"", end

    stream.seek(0)
    while block := stream.read(CHUNK):
        digest.update(block)
        cursor = 0
        while cursor < len(block):
            newline = block.find(b"\n", cursor)
            stop = len(block) if newline < 0 else newline + 1
            prefix += block[cursor:stop][:max(0, 256 - len(prefix))]
            position += stop - cursor
            cursor = stop
            if newline >= 0:
                finish_line(position)
    if position > line_start:
        finish_line(position)
    if entries:
        entries[-1].update(end_line=line_count, end_byte=position)
    return entries, dict(sha256=digest.hexdigest(), byte_count=position, line_count=line_count)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate index key: {key}")
        result[key] = value
    return result


def verify_index(path, mailbox, entries, facts):
    if path.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError("index must be immutable (no write permission bits)")
    if mailbox.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError("indexed archive must be immutable (no write permission bits)")
    # Index size is capped; mailbox data itself is streamed without a size limit.
    with path.open("rb") as stream:
        raw = stream.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("index exceeds the 1 MiB limit")
    data = json.loads(raw, object_pairs_hook=unique_object)
    if not isinstance(data, dict) or not isinstance(data.get("archive"), str):
        raise ValueError("invalid index archive path")
    archive = Path(data["archive"])
    candidates = [archive] if archive.is_absolute() else [ROOT / archive, path.parent / archive]
    if mailbox.resolve() not in [candidate.resolve() for candidate in candidates]:
        raise ValueError("index archive path does not match mailbox")
    for name, expected in facts.items():
        actual = data.get(name)
        if type(actual) is not type(expected) or actual != expected:
            raise ValueError(f"index {name} mismatch")
    expected = [{name: entry[name] for name in ("id", "start_line", "end_line")} for entry in entries]
    actual = data.get("entries")
    if not isinstance(actual, list) or any(
        not isinstance(entry, dict) or set(entry) != {"id", "start_line", "end_line"}
        or type(entry["id"]) is not str or type(entry["start_line"]) is not int
        or type(entry["end_line"]) is not int for entry in actual
    ) or actual != expected:
        raise ValueError("index entry IDs or heading/line addresses mismatch")


def text_chunks(stream, entry):
    stream.seek(entry["start_byte"])
    remaining = entry["end_byte"] - entry["start_byte"]
    decoder = codecs.getincrementaldecoder("utf-8")()
    while remaining:
        block = stream.read(min(CHUNK, remaining))
        if not block:
            raise ValueError("mailbox changed during read")
        remaining -= len(block)
        yield decoder.decode(block, final=remaining == 0)


def read_entry(stream, entry, offset, max_chars, max_lines):
    skip, count_lines, output = offset, 0, []
    for text in text_chunks(stream, entry):
        if skip:
            skipped = min(skip, len(text))
            skip -= skipped
            text = text[skipped:]
        for character in text:
            if len(output) == max_chars or count_lines == max_lines:
                return "".join(output), offset + len(output), False
            output.append(character)
            count_lines += character == "\n"
    if skip:
        raise ValueError("read offset exceeds entry length")
    return "".join(output), offset + len(output), True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", type=Path, default=ROOT / "stigmergicchat.md", help="mailbox or archive path")
    parser.add_argument("--index", type=Path, help="existing immutable archive index; verify before output")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="list a bounded page of exact entry IDs")
    listing.add_argument("--offset", type=bounded_integer(0, sys.maxsize), default=0, help="entry offset")
    listing.add_argument("--limit", type=bounded_integer(1, 20), default=10, help="entries per page (1–20)")
    reading = commands.add_parser("read", help="read one exact ID, including its heading")
    reading.add_argument("id", help="complete mailbox ID; substring matching is never used")
    reading.add_argument("--offset", type=bounded_integer(0, sys.maxsize), default=0, help="Unicode character offset")
    reading.add_argument("--max-chars", type=bounded_integer(1, 12000), default=3200, help="character cap (default 3200)")
    reading.add_argument("--max-lines", type=bounded_integer(1, 80), default=40, help="line cap (default 40)")
    args = parser.parse_args(argv)
    try:
        with args.file.open("rb") as stream:
            descriptor = stream.fileno()
            initial = os.fstat(descriptor)
            entries, facts = scan(stream)
            if args.index:
                verify_index(args.index, args.file, entries, facts)
            if args.command == "list":
                if args.offset > len(entries):
                    raise ValueError("list offset exceeds entry count")
                page = entries[args.offset:args.offset + args.limit]
                next_offset = args.offset + len(page)
                result = "".join(f"{entry['id']} lines={entry['start_line']}-{entry['end_line']}\n" for entry in page)
                header = f"offset={args.offset} next_offset={next_offset} total={len(entries)} complete={str(next_offset == len(entries)).lower()}"
            else:
                entry = next((entry for entry in entries if entry["id"] == args.id), None)
                if entry is None:
                    raise ValueError(f"missing mailbox ID: {args.id[:200]}")
                result, next_offset, complete = read_entry(stream, entry, args.offset, args.max_chars, args.max_lines)
                header = f"entry={entry['id']} offset={args.offset} next_offset={next_offset} complete={str(complete).lower()}"
            final = os.fstat(descriptor)
            if (initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns) != (final.st_size, final.st_mtime_ns, final.st_ctime_ns):
                raise ValueError("mailbox changed during read")
        sys.stdout.write(header + "\n" + result)
        if result and not result.endswith("\n"):
            sys.stdout.write("\n")
        return 0
    except (OSError, ValueError, UnicodeError) as error:
        print(f"error: {str(error)[:300]}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
