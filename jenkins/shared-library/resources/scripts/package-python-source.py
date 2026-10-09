#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
from pathlib import Path


ROOT = Path.cwd()
ARTIFACT_DIR = ROOT / "artifact"
SOURCE_DIR = ARTIFACT_DIR / "source"

EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".nox",
    "dist",
    "build",
    "htmlcov",
    ".eggs",
    ".central-cicd",
    "artifact",
}

EXCLUDED_FILE_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.test",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
}

EXCLUDED_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".pyd",
    ".pem",
    ".key",
    ".secret",
    ".p12",
    ".pfx",
}


def should_exclude(path: Path) -> bool:
    name = path.name
    if name in EXCLUDED_DIRS or name in EXCLUDED_FILE_NAMES:
        return True
    if name.startswith(".env."):
        return True
    if name.endswith(".egg-info"):
        return True
    return path.is_file() and path.suffix in EXCLUDED_SUFFIXES


def copy_source() -> None:
    if ARTIFACT_DIR.exists():
        shutil.rmtree(ARTIFACT_DIR)
    SOURCE_DIR.mkdir(parents=True)

    for current_root, dir_names, file_names in os.walk(ROOT, topdown=True, followlinks=False):
        current = Path(current_root)

        dir_names[:] = [
            name for name in dir_names
            if not should_exclude(current / name) and not (current / name).is_symlink()
        ]

        if ARTIFACT_DIR in current.parents or current == ARTIFACT_DIR:
            dir_names[:] = []
            continue

        relative_root = current.relative_to(ROOT)
        destination_root = SOURCE_DIR / relative_root
        destination_root.mkdir(parents=True, exist_ok=True)

        for name in file_names:
            source = current / name
            if should_exclude(source) or source.is_symlink():
                continue
            shutil.copy2(source, destination_root / name)


if __name__ == "__main__":
    copy_source()
