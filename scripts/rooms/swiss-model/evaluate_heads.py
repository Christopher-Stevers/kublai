"""Paired masked pixel heads, never room-instance scoring or inferred completeness."""
from __future__ import annotations

import argparse
import gc
import json
import os
from pathlib import Path
import time

import numpy as np
from PIL import Image
import torch

from contract import (DATA, DATA_SHA, OLD, OLD_SHA, HEADS, archive_sources, checked_asset, completed_checkpoint,
                      file_hash, freeze_paths, read_context_manifest, runtime_versions, source_paths,
                      validate_arrays, validate_metadata, verify, verify_runtime, write_json)
from context_predict import context_probabilities, load_context_model

THRESHOLD = .5


def head_counts(probability, target, known):
    validate_arrays(target, known, probability.shape)
    if probability.ndim != 3 or probability.shape[0] != 3 or not np.isfinite(probability).all() or np.min(probability) < 0 or np.max(probability) > 1:
        raise ValueError("Expected three finite probability heads")
    output = {}
    for index, name in enumerate(HEADS):
        use = known[index].astype(bool)
        truth = target[index].astype(bool)
        predicted = probability[index] >= THRESHOLD
        output[name] = dict(tp=int(np.count_nonzero(use & truth & predicted)),
                            fp=int(np.count_nonzero(use & ~truth & predicted)),
                            fn=int(np.count_nonzero(use & truth & ~predicted)),
                            tn=int(np.count_nonzero(use & ~truth & ~predicted)),
                            known=int(np.count_nonzero(use)), unknown=int(np.count_nonzero(~use)))
    return output


def summarize(rows):
    output = {}
    for head in HEADS:
        counts = {key: sum(r["heads"][head][key] for r in rows) for key in ("tp", "fp", "fn", "tn", "known", "unknown")}
        tp, fp, fn = (counts[k] for k in ("tp", "fp", "fn"))
        if counts["known"] != sum(counts[k] for k in ("tp", "fp", "fn", "tn")):
            raise ValueError("Masked confusion counts do not account for known pixels")
        output[head] = {**counts, "pixel_iou": tp / (tp + fp + fn) if tp + fp + fn else None,
                        "pixel_precision": tp / (tp + fp) if tp + fp else None,
                        "pixel_recall": tp / (tp + fn) if tp + fn else None}
    return output


def coverage(rows, expected):
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)) or set(ids) != set(expected):
        raise ValueError("Paired method lacks exact unique original development case coverage")


def run(binding_path, output):
    sources = freeze_paths(source_paths(("contract.py", "evaluate_heads.py")))
    runtime = runtime_versions()
    binding, new_checkpoint, training = completed_checkpoint(binding_path)
    data = read_context_manifest(DATA); validate_metadata(data)
    cases = [r for r in data["records"] if r["split"] == "validation"]
    expected = binding["development_ids"]
    if [r["id"] for r in cases] != expected or len(expected) != 20:
        raise ValueError("The declared original 20 development cases changed")
    frozen = {**binding["assets"], str(binding_path.resolve()): file_hash(binding_path),
              str(new_checkpoint): file_hash(new_checkpoint),
              str(binding_path.parent / "training/run.json"): file_hash(binding_path.parent / "training/run.json")}
    claim_path = binding_path.parent / "head_evaluation_claim.json"
    write_json(claim_path, {"output":str(output.resolve()),
               "manifest_sha256":DATA_SHA, "new_checkpoint_sha256":frozen[str(new_checkpoint)],
               "source_bindings":sources, "runtime":runtime})
    frozen[str(claim_path)] = file_hash(claim_path)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    archived = archive_sources(output / "frozen_sources", source_paths(("contract.py", "evaluate_heads.py")))
    write_json(output / "evaluation_started.json", {"manifest_sha256": DATA_SHA, "case_ids": expected,
               "model_sha256": {"frozen_long48": OLD_SHA, "true_opening48": frozen[str(new_checkpoint)]},
               "source_bindings": sources, "asset_bindings": frozen, "threshold": THRESHOLD,
               "runtime": runtime, "archived_sources": archived,
               "metric_scope": "Native stitched/fused heads on known target pixels only. No truth/instance arrays opened."})
    torch.set_num_threads(4)
    device = torch.device("cuda")
    if not torch.cuda.is_available(): raise RuntimeError("CUDA is required for this bounded paired run")
    results = {}; caches = {}
    for name, checkpoint in (("frozen_long48", OLD), ("true_opening48", new_checkpoint)):
        verify(frozen); verify(sources); verify_runtime(runtime)
        model, metadata = load_context_model(checkpoint, device)
        if metadata["tile"] != 512 or metadata["overview"] != 512:
            raise ValueError("Declared architecture/inference dimensions changed")
        method_dir = output / name; method_dir.mkdir(mode=0o700)
        rows = []; started = time.monotonic(); torch.cuda.reset_peak_memory_stats()
        for row in cases:
            image_path = checked_asset(DATA.parent, row["image"], row["image_sha256"])
            target_path = checked_asset(DATA.parent, row["targets"], row["targets_sha256"])
            with Image.open(image_path) as im: image = np.asarray(im.convert("RGB"), dtype=np.float32) / 255
            with np.load(target_path, allow_pickle=False) as z: target, known = z["target"].copy(), z["known"].copy()
            checked_asset(DATA.parent, row["image"], row["image_sha256"])
            checked_asset(DATA.parent, row["targets"], row["targets_sha256"])
            case_started = time.monotonic()
            probability, overview = context_probabilities(model, image, 512, 128, 512, device)
            counts = head_counts(probability, target, known)
            cache = method_dir / (row["id"] + ".npz")
            np.savez_compressed(cache, probability=probability, overview_interior=overview)
            rows.append({"id": row["id"], "site": row["site"], "image_sha256": row["image_sha256"],
                         "targets_sha256": row["targets_sha256"], "probabilities": str(cache.relative_to(output)),
                         "probabilities_sha256": file_hash(cache), "heads": counts,
                         "wall_ink_style":row["render_stats"]["wall_ink_style"],
                         "wall_seconds": time.monotonic() - case_started})
            caches[str(cache)] = rows[-1]["probabilities_sha256"]
            verify({str(image_path): row["image_sha256"], str(target_path): row["targets_sha256"]})
            print(json.dumps({"method": name, "case": row["id"], "known_pixel_iou": summarize([rows[-1]])}), flush=True)
        coverage(rows, expected)
        results[name] = {"cases": rows, "heads": summarize(rows), "checkpoint_sha256": frozen[str(checkpoint)],
                         "heads_by_wall_style": {style:{"cases":sum(r["wall_ink_style"]==style for r in rows),
                             "heads":summarize([r for r in rows if r["wall_ink_style"]==style])}
                             for style in sorted({r["wall_ink_style"] for r in rows})},
                         "training_manifest_sha256": metadata["manifest_sha256"],
                         "wall_seconds": time.monotonic() - started,
                         "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated() / 2 ** 20}
        verify(frozen); verify(sources); verify_runtime(runtime); verify(caches)
        del model; gc.collect(); torch.cuda.empty_cache()
    verify(frozen); verify(sources); verify_runtime(runtime); verify(caches)
    report = {"contract": "swiss-paired-masked-head-evaluation-v1", "methods": results,
              "manifest_sha256": DATA_SHA, "training_binding_sha256": frozen[str(binding_path.resolve())],
              "threshold": THRESHOLD, "inference": {"tile": 512, "overlap": 128, "overview": 512,
              "interior_fusion": "mean of native local and aligned overview"},
              "source_bindings": sources, "asset_bindings": frozen, "cache_bindings": caches, "runtime": runtime,
              "approved_for_production": False, "all_space_scoring_eligible": False,
              "limitations": "Generated pixels from original geometry, not real drawing images or independent physical-room GT. Old model learned centerlines and arbitrary gaps; new targets are actual wall/door/window footprints. Head scores do not establish complete-room detection."}
    write_json(output / "report.json", report)
    write_json(output / "evaluation_completed.json", {"report_sha256":file_hash(output / "report.json"),
               "started_sha256":file_hash(output / "evaluation_started.json")})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); os.umask(0o077); run(args.binding.resolve(), args.output)
