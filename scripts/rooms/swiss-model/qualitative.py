"""One fixed actual-sheet qualitative probe; no real completeness metric."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import time
import numpy as np
from PIL import Image
import torch
from contract import (ACTUAL, ACTUAL_SHA, DATA_SHA, PARTITION, PARTITION_SHA, archive_sources, completed_checkpoint,
                      file_hash, freeze_paths, runtime_versions, source_paths, verify, verify_runtime, write_json)
from context_predict import context_probabilities, load_context_model
from predict import global_rooms


def run(binding_path, head_report, output):
    binding, checkpoint, _ = completed_checkpoint(binding_path)
    report_hash = file_hash(head_report)
    report = json.loads(head_report.read_text())
    head_completion = head_report.parent / "evaluation_completed.json"
    complete = json.loads(head_completion.read_text())
    head_claim_path = binding_path.parent / "head_evaluation_claim.json"
    claim = json.loads(head_claim_path.read_text())
    started_path = head_report.parent / "evaluation_started.json"
    started = json.loads(started_path.read_text())
    if complete["report_sha256"] != report_hash or Path(claim["output"]).resolve() != head_report.parent.resolve():
        raise ValueError("The head report must be the completed original paired check")
    if complete["started_sha256"] != file_hash(started_path) or started["asset_bindings"].get(str(head_claim_path)) != file_hash(head_claim_path):
        raise ValueError("Paired evaluation claim/start binding changed")
    if report.get("contract") != "swiss-paired-masked-head-evaluation-v1" or report.get("manifest_sha256") != DATA_SHA:
        raise ValueError("The paired head check must finish first")
    if report["methods"]["true_opening48"]["checkpoint_sha256"] != file_hash(checkpoint):
        raise ValueError("This is not the single evaluated checkpoint")
    if claim.get("manifest_sha256") != DATA_SHA or claim.get("new_checkpoint_sha256") != file_hash(checkpoint) or claim.get("source_bindings") != report["source_bindings"]:
        raise ValueError("Original paired claim dataset/checkpoint/source identity differs")
    verify(report["source_bindings"]); verify(report["asset_bindings"]); verify(report["cache_bindings"])
    if file_hash(ACTUAL) != ACTUAL_SHA or file_hash(PARTITION) != PARTITION_SHA:
        raise ValueError("Actual clean RGB/selected partition core identity changed")
    names = ("contract.py", "qualitative.py", "partition_actual.py")
    sources = freeze_paths(source_paths(names) + [PARTITION])
    runtime = runtime_versions()
    frozen = {str(ACTUAL): ACTUAL_SHA, str(checkpoint): file_hash(checkpoint), str(head_report): report_hash,
              str(binding_path): file_hash(binding_path),str(head_completion):file_hash(head_completion),
              str(head_claim_path):file_hash(head_claim_path),str(started_path):file_hash(started_path)}
    actual_claim_path = binding_path.parent / "actual_probe_claim.json"
    write_json(actual_claim_path, {"output":str(output.resolve()),
               "input_sha256":ACTUAL_SHA,"checkpoint_sha256":frozen[str(checkpoint)],"source_bindings":sources,
               "fixed_presets":["plain-.4","hierarchical_basins"]})
    frozen[str(actual_claim_path)] = file_hash(actual_claim_path)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    archived = archive_sources(output / "frozen_sources", source_paths(names))
    (output / "frozen_sources/partition.py").write_bytes(PARTITION.read_bytes())
    if file_hash(output / "frozen_sources/partition.py") != PARTITION_SHA:
        raise RuntimeError("Partition source snapshot differs")
    torch.set_num_threads(4); device = torch.device("cuda")
    with Image.open(ACTUAL) as im: image = np.asarray(im.convert("RGB"), dtype=np.float32) / 255
    verify(frozen); verify(sources); verify_runtime(runtime)
    model, metadata = load_context_model(checkpoint, device)
    started = time.monotonic(); torch.cuda.reset_peak_memory_stats()
    probability, overview = context_probabilities(model, image, 512, 128, 512, device)
    np.savez_compressed(output / "probabilities.npz", probability=probability, overview_interior=overview)
    emitted = {str(output / "probabilities.npz"):file_hash(output / "probabilities.npz")}
    labels, rooms = global_rooms(probability, .4, .35, 25)
    labels.astype("<i4").tofile(output / "plain-labels.i32")
    emitted[str(output / "plain-labels.i32")] = file_hash(output / "plain-labels.i32")
    write_json(output / "plain.json", {"rooms": rooms, "width": image.shape[1], "height": image.shape[0],
               "thresholds": {"boundary": .4, "interior": .35, "min_area": 25},
               "approved_for_production": False, "all_space_scoring_eligible": False})
    emitted[str(output / "plain.json")] = file_hash(output / "plain.json")
    verify(frozen); verify(sources); verify_runtime(runtime); verify(emitted)
    probe = {"contract": "swiss-actual-qualitative-probe-v1", "input": str(ACTUAL), "input_sha256": ACTUAL_SHA,
             "checkpoint": str(checkpoint), "checkpoint_sha256": frozen[str(checkpoint)], "training_manifest_sha256": DATA_SHA,
             "head_report": str(head_report), "head_report_sha256": report_hash,
             "output":str(output.resolve()),"actual_probe_claim":str(actual_claim_path),"actual_probe_claim_sha256":frozen[str(actual_claim_path)],
             "source_bindings": sources, "asset_bindings": frozen, "archived_sources": archived, "runtime": runtime,
             "partition_source": str(PARTITION), "partition_source_sha256": PARTITION_SHA,
             "probabilities_sha256": emitted[str(output / "probabilities.npz")], "plain_sha256": emitted[str(output / "plain.json")],
             "plain_labels_sha256": emitted[str(output / "plain-labels.i32")], "emitted_bindings":emitted,"plain_proposals": len(rooms),
             "hierarchical_preset": "hierarchical_basins", "width": image.shape[1], "height": image.shape[0],
             "wall_seconds": time.monotonic() - started, "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated() / 2**20,
             "approved_for_production": False, "all_space_scoring_eligible": False,
             "limitations": "One clean text-free construction sheet, no independent complete reference. Visual falsification only; proposals and holes do not establish actual recall."}
    write_json(output / "probe_binding.json", probe)
    verify(frozen); verify(sources); verify_runtime(runtime); verify(emitted)
    write_json(output / "probe_completed.json", {"probe_binding_sha256": file_hash(output / "probe_binding.json"),"emitted_bindings":emitted})
    print(json.dumps({"plain_proposals": len(rooms), "wall_seconds": probe["wall_seconds"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding", type=Path, required=True); parser.add_argument("--head-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); os.umask(0o077); run(args.binding.resolve(), args.head_report.resolve(), args.output)
