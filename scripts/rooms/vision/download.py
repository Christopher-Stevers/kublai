"""Explicit download of a pinned official Qwen checkpoint into a private directory.

This is not called by inference. It downloads public model files only; it never
reads drawings, credentials or other application configuration.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.request

MODEL = "Qwen/Qwen3-VL-2B-Instruct"
REVISION = "89644892e4d85e24eaac8bacfd4f463576704203"
WEIGHTS_SHA256 = "7de1838c87a5349b016c26a1c3f7d2bc400a3d485f95ef39a7059ffd734977a0"
FILES = (
    "README.md", "chat_template.json", "config.json", "generation_config.json",
    "merges.txt", "model.safetensors", "preprocessor_config.json", "tokenizer.json",
    "tokenizer_config.json", "video_preprocessor_config.json", "vocab.json",
)
# SHA256 and sizes independently checked against the pinned official revision.
# Nonweight bytes also matched Hugging Face's Git blob IDs in the pilot audit.
PINNED_FILES = {
    "README.md": (7136, "5fc5be1ca9a3910399bd6239ee5086ab5d82a2a59c5d2b00e887a8835cc110e4"),
    "chat_template.json": (5502, "6f8a6a55027e3da5160105556cda5dd69f6423f1c32645f6730d32de7773d0c4"),
    "config.json": (1505, "bec4b3d446efa05807365c9e1cec03ac590836879d02f3a6da879971154bdd3b"),
    "generation_config.json": (269, "1e241830b48b397cb0900101421df5450baddc7adf01e5fc86b5615865f3bae4"),
    "merges.txt": (1671839, "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3"),
    "model.safetensors": (4255140312, WEIGHTS_SHA256),
    "preprocessor_config.json": (390, "27225450ac9c6529872ee1924fcb0962ff5634834f817040f444118116f4e516"),
    "tokenizer.json": (7032403, "a5d85b6dcc535e6b93115a9ef287e6132fdbf30270da6218194ba742261173c7"),
    "tokenizer_config.json": (10868, "c2da771801886ad9ae98181793ffd3dfb7f1af30f6f7c6a4e15d7dbba52e2399"),
    "video_preprocessor_config.json": (385, "7768af27c1fafa9cc9011c1dc20067e03f8915e03b63504550e11d5066986d13"),
    "vocab.json": (2776833, "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"),
}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verified_asset(path: Path, name: str) -> None:
    expected_size, expected_hash = PINNED_FILES[name]
    if path.is_symlink() or not path.is_file() or path.stat().st_size != expected_size or file_hash(path) != expected_hash:
        raise ValueError("Model asset is not the pinned official byte sequence")


def verified_provenance(value: dict) -> None:
    if not isinstance(value, dict) or set(value) != {"model", "revision", "license", "files"}:
        raise ValueError("Invalid model provenance schema")
    if (value["model"], value["revision"], value["license"]) != (MODEL, REVISION, "apache-2.0"):
        raise ValueError("Official model identity/revision/license mismatch")
    expected = {name: {"bytes": size, "sha256": digest} for name, (size, digest) in PINNED_FILES.items()}
    if value["files"] != expected:
        raise ValueError("Every pinned model asset must be declared exactly")


def download(output: Path) -> None:
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output, 0o700)
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true", timeout=30) as response:
        metadata = json.load(response)
    if metadata["sha"] != REVISION or metadata.get("cardData", {}).get("license") != "apache-2.0":
        raise ValueError("Official revision/license no longer matches")
    sizes = {f["rfilename"]: f["size"] for f in metadata["siblings"]}
    if any(sizes[name] != PINNED_FILES[name][0] for name in FILES):
        raise ValueError("Official file size differs from frozen integrity map")
    if sum(sizes[name] for name in FILES) > 5_000_000_000:
        raise ValueError("Pinned download exceeds five GB bound")
    for name in FILES:
        final = output / name
        if final.exists():
            verified_asset(final, name)
            continue
        partial = output / f"{name}.partial"
        downloaded = 0
        with urllib.request.urlopen(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}", timeout=60) as response:
            descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                while block := response.read(1024 * 1024):
                    downloaded += len(block)
                    if downloaded > sizes[name]:
                        raise ValueError("Download exceeded pinned file size")
                    stream.write(block)
                    if name == "model.safetensors" and downloaded % (256 * 1024 * 1024) == 0:
                        print(json.dumps({"downloaded_mib": downloaded // (1024 * 1024)}), flush=True)
        if downloaded != sizes[name]:
            raise ValueError(f"Incomplete {name}; retained partial file")
        verified_asset(partial, name)
        partial.rename(final)
        print(json.dumps({"downloaded": name, "bytes": downloaded}), flush=True)
    provenance = {"model": MODEL, "revision": REVISION, "license": "apache-2.0",
                  "files": {name: {"bytes": sizes[name], "sha256": file_hash(output / name)} for name in FILES}}
    verified_provenance(provenance)
    if (output / "download-provenance.json").exists():
        existing = json.loads((output / "download-provenance.json").read_text())
        verified_provenance(existing)
        return
    descriptor = os.open(output / "download-provenance.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(provenance, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    download(parser.parse_args().output)
