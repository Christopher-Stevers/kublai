"""Small local-only contracts shared by the structural-model challenger."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HEADS = ("interior", "boundary", "opening_closure")
VERSION = "structural-room-challenger-v1"


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source_hashes() -> dict[str, str]:
    return {p.name: file_hash(p) for p in sorted(ROOT.glob("*.py")) if not p.name.startswith("test_")}


def private_dir(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=False)


def write_json(path: Path, value: Any) -> None:
    with path.open("x") as handle:
        json.dump(value, handle, indent=2, allow_nan=False)
    path.chmod(0o600)


def checked_asset(root: Path, name: str, sha256: str) -> Path:
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError("Asset must be a relative local path")
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Asset escapes the local manifest")
    if file_hash(path) != sha256:
        raise ValueError(f"Asset hash changed: {name}")
    return path


def read_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text())
    if manifest.get("version") != VERSION or manifest.get("heads") != list(HEADS):
        raise ValueError("Unsupported structural-model manifest")
    groups: dict[str, str] = {}
    excluded = set(manifest.get("excluded_msd_sites", []))
    for record in manifest["records"]:
        if record["split"] not in ("train", "validation"):
            raise ValueError("Training manifests may not contain protected holdout data")
        if groups.setdefault(record["group"], record["split"]) != record["split"]:
            raise ValueError("One site/project occurs in both training and validation")
        if record["source"] == "synthetic-msd" and record["site"] in excluded:
            raise ValueError("Protected MSD site entered training data")
        checked_asset(path.parent, record["image"], record["image_sha256"])
        checked_asset(path.parent, record["targets"], record["targets_sha256"])
    return manifest
