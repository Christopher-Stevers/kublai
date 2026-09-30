"""One fixed 48-epoch random-init trial using the byte-identical context trainer."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from contract import CLAIM, CONFIG, DATA, archive_sources, claim_trial, file_hash, freeze_paths, preflight, read_training_binding, runtime_versions, source_paths, verify, verify_runtime, write_json


def run(output):
    paths = source_paths(("contract.py", "train_trial.py"))
    sources = freeze_paths(paths)
    runtime = runtime_versions()
    data, assets, compatibility = preflight()
    verify(sources); verify_runtime(runtime)
    claim_hash = claim_trial(output, runtime, sources)
    assets[str(CLAIM)] = claim_hash
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    # The experiment-scoped atomic CLAIM prevents another output alias/run.
    # Directory creation also refuses overwriting previous artifacts.
    archived = archive_sources(output / "frozen_sources", paths)
    binding = {"contract": "swiss-true-opening-training-v1", "output": str(output.resolve()),
               "config": CONFIG, "assets": assets, "source_bindings": sources, "archived_sources": archived,
               "runtime": runtime, "compatibility": compatibility,
               "development_ids": [r["id"] for r in data["records"] if r["split"] == "validation"],
               "selection": "One random-initialized fixed-default 48-epoch trial; lowest declared development loss.",
               "approved_for_production": False, "all_space_scoring_eligible": False}
    write_json(output / "binding.json", binding)
    verify(assets); verify(sources); verify_runtime(runtime)
    command = [sys.executable, str(output / "frozen_sources/models/context_train.py"),
               "--manifest", str(DATA), "--output", str(output / "training")]
    for name, value in CONFIG.items():
        command += ["--" + name.replace("_", "-"), str(value)]
    with (output / "training.stdout.jsonl").open("x") as log:
        completed = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=False)
    verify(assets); verify(sources); verify_runtime(runtime)
    if completed.returncode:
        write_json(output / "failure.json", {"returncode": completed.returncode, "command": command})
        raise RuntimeError("Frozen training failed; preserve this attempt and do not silently retry")
    read_training_binding(output / "binding.json")
    write_json(output / "completed.json", {"command": command, "returncode": 0, "binding": "binding.json",
               "binding_sha256": file_hash(output / "binding.json"),
               "run_sha256": file_hash(output / "training/run.json"),
               "checkpoint_sha256": file_hash(output / "training/best.pt")})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); os.umask(0o077); run(args.output)
