#!/usr/bin/env python3
"""Stage the public SPACEFORTRESS files for GitHub Pages."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile


ROOT_ASSETS = (
    "index.html",
    "style.css",
    "elements.html",
    "elements.css",
    "LICENSE",
)
SOURCE_SUFFIXES = frozenset({".js", ".css"})
GIT_SHA_RE = re.compile(r"[0-9a-fA-F]{40}")
JS_MODULE_RE = re.compile(
    r"^\s*(?:import|export)\s+(?:[^'\"\n;]*?\s+from\s+)?"
    r"(?P<quote>['\"])(?P<path>[^'\"]+)(?P=quote)",
    re.MULTILINE,
)
DYNAMIC_MODULE_RE = re.compile(
    r"\bimport\s*\(\s*(?P<quote>['\"])(?P<path>[^'\"]+)(?P=quote)\s*\)"
)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\(\s*)?(?P<quote>['\"]?)(?P<path>[^'\"\s);]+)(?P=quote)"
)


class BuildError(RuntimeError):
    """Raised when a safe, complete Pages artifact cannot be built."""


class _SourceReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: set[str] = set()

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in {"href", "src"} and value:
                self.references.add(value)


def _regular_file(path: Path, label: str) -> None:
    if path.is_symlink():
        raise BuildError(f"{label} must not be a symbolic link: {path}")
    try:
        mode = path.stat(follow_symlinks=False).st_mode
    except FileNotFoundError as error:
        raise BuildError(f"missing required {label}: {path}") from error
    if not stat.S_ISREG(mode):
        raise BuildError(f"{label} must be a regular file: {path}")


def _manifest_sources(project_root: Path) -> list[tuple[Path, Path]]:
    manifest_path = project_root / "tools" / "pages-assets.json"
    _regular_file(manifest_path, "Pages asset manifest")
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BuildError(f"invalid Pages asset manifest: {manifest_path}") from error
    entries = document.get("sourceAssets") if isinstance(document, dict) else None
    if not isinstance(entries, list) or not entries:
        raise BuildError("Pages asset manifest must contain a non-empty sourceAssets list")

    source_root = project_root / "src"
    if source_root.is_symlink() or not source_root.is_dir():
        raise BuildError(f"source directory must be a real directory: {source_root}")

    sources: list[tuple[Path, Path]] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, str) or not entry:
            raise BuildError("Pages asset entries must be non-empty strings")
        if "\\" in entry:
            raise BuildError(f"Pages asset path must use forward slashes: {entry}")
        relative = PurePosixPath(entry)
        if (
            relative.is_absolute()
            or relative.as_posix() != entry
            or not relative.parts
            or relative.parts[0] != "src"
            or any(part in {".", ".."} or part.startswith(".") for part in relative.parts)
        ):
            raise BuildError(f"unsafe Pages asset path: {entry}")
        if relative.suffix.lower() not in SOURCE_SUFFIXES:
            raise BuildError(f"unsupported Pages asset type: {entry}")
        if entry in seen:
            raise BuildError(f"duplicate Pages asset path: {entry}")
        seen.add(entry)

        source = project_root.joinpath(*relative.parts)
        parent = project_root
        for part in relative.parts[:-1]:
            parent /= part
            if parent.is_symlink():
                raise BuildError(f"Pages asset parent must not be a symbolic link: {parent}")
        _regular_file(source, "Pages source asset")
        resolved = source.resolve(strict=True)
        if not resolved.is_relative_to(source_root):
            raise BuildError(f"Pages asset escapes the source directory: {entry}")
        sources.append((resolved, Path(*relative.parts)))

    _validate_runtime_closure(project_root, sources, seen)
    return sorted(sources, key=lambda pair: pair[1].as_posix())


def _validate_runtime_closure(
    project_root: Path,
    sources: list[tuple[Path, Path]],
    manifest_entries: set[str],
) -> None:
    for name in ("index.html", "elements.html"):
        parser = _SourceReferenceParser()
        parser.feed((project_root / name).read_text(encoding="utf-8"))
        for reference in parser.references:
            if reference.startswith("src/") and reference not in manifest_entries:
                raise BuildError(f"HTML references an unlisted Pages asset: {reference}")

    for source, _relative in sources:
        text = source.read_text(encoding="utf-8")
        patterns = (
            (JS_MODULE_RE, DYNAMIC_MODULE_RE)
            if source.suffix.lower() == ".js"
            else (CSS_IMPORT_RE,)
        )
        references = {
            match.group("path")
            for pattern in patterns
            for match in pattern.finditer(text)
        }
        for reference in references:
            if not reference.startswith(".") or any(
                token in reference for token in ("?", "#", "%", "\\")
            ):
                raise BuildError(f"source import is not a plain relative path: {reference}")
            dependency = (source.parent / reference).resolve(strict=False)
            try:
                dependency_entry = dependency.relative_to(project_root).as_posix()
            except ValueError as error:
                raise BuildError(f"source import escapes the project: {reference}") from error
            if dependency_entry not in manifest_entries:
                raise BuildError(
                    f"source import is absent from Pages asset manifest: {dependency_entry}"
                )


def _source_files(project_root: Path) -> list[tuple[Path, Path]]:
    files: list[tuple[Path, Path]] = []
    for name in ROOT_ASSETS:
        source = project_root / name
        _regular_file(source, "public asset")
        files.append((source, Path(name)))

    files.extend(_manifest_sources(project_root))

    return sorted(files, key=lambda pair: pair[1].as_posix())


def _package_version(project_root: Path) -> str:
    package_path = project_root / "package.json"
    _regular_file(package_path, "package manifest")
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BuildError(f"invalid package manifest: {package_path}") from error
    version = package.get("version") if isinstance(package, dict) else None
    if not isinstance(version, str) or not version.strip():
        raise BuildError("package.json must contain a non-empty string version")
    return version


def _resolve_output(project_root: Path, output: str | os.PathLike[str]) -> Path:
    requested = Path(output).expanduser()
    if not requested.is_absolute():
        requested = project_root / requested
    resolved = requested.resolve(strict=False)
    source_root = project_root / "src"
    if resolved == project_root or project_root.is_relative_to(resolved):
        raise BuildError("output path must not be the project root or contain it")
    if resolved == source_root or resolved.is_relative_to(source_root):
        raise BuildError("output path must not be inside the source directory")
    if requested.exists() or requested.is_symlink():
        raise BuildError(f"output path already exists: {requested}")
    return resolved


def build_pages(
    project_root: str | os.PathLike[str],
    output: str | os.PathLike[str] = ".pages-site",
    git_sha: str | None = None,
) -> Path:
    """Build a new Pages directory and return its absolute path.

    Relative output paths are based at ``project_root``. Existing destinations are
    refused so this tool never removes or overwrites an unrelated directory.
    """

    root = Path(project_root).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise BuildError(f"project root is not a directory: {root}")
    destination = _resolve_output(root, output)
    sources = _source_files(root)
    version = _package_version(root)

    sha = git_sha.strip() if git_sha else None
    if sha is not None and GIT_SHA_RE.fullmatch(sha) is None:
        raise BuildError("git SHA must be exactly 40 hexadecimal characters")

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}-", dir=destination.parent)
    )
    try:
        for source, relative in sources:
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target, follow_symlinks=False)

        (staging / ".nojekyll").write_bytes(b"")
        manifest: dict[str, str] = {"version": version}
        if sha is not None:
            manifest["gitSha"] = sha.lower()
        (staging / "version.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        staging.rename(destination)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return destination


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-root",
        default=Path(__file__).resolve().parent.parent,
        help="project directory (default: repository containing this tool)",
    )
    parser.add_argument(
        "--output",
        default=".pages-site",
        help="new output directory; relative paths are based at the project root",
    )
    parser.add_argument(
        "--git-sha",
        default=os.environ.get("GITHUB_SHA"),
        help="40-character deployed Git commit SHA (default: GITHUB_SHA)",
    )
    return parser


def main() -> int:
    parser = _parser()
    arguments = parser.parse_args()
    try:
        output = build_pages(
            arguments.project_root,
            output=arguments.output,
            git_sha=arguments.git_sha,
        )
    except (BuildError, OSError) as error:
        parser.error(str(error))
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
