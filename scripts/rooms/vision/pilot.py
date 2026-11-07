"""Frozen development-only local census pilot. Ground truth never enters generation.

Freeze -> infer -> score are separate commands. The exact same prompt is used
on whole images and dimension-only quadrants. No proposals are room outlines.
"""
from __future__ import annotations

import argparse
import importlib.metadata
import io
import json
import os
from pathlib import Path
import platform
import time

from common import (PROMPT, VERSION, checked_bytes, checked_development_records, file_hash, parse_census, point_coverage,
                    regular_viewports, source_coordinates, source_hashes, verify_hashes, write_json)
from download import FILES, MODEL, REVISION, WEIGHTS_SHA256, verified_asset, verified_provenance

GREEDY_SETTINGS = {"max_pixels": 786432, "min_pixels": 65536, "max_new_tokens": 3072,
                   "max_time_seconds": 120, "gpu_allocated_limit_gib": 7, "seed": 0,
                   "sampling": "greedy", "precision": "bfloat16", "attention": "sdpa"}
SAMPLING_SETTINGS = {**GREEDY_SETTINGS, "sampling": "official-reference-fixed-seed", "temperature": .7,
                     "top_p": .8, "top_k": 20, "presence_penalty": 1.5, "repetition_penalty": 1.0}


def freeze(args):
    from PIL import Image
    original_manifest_hash = file_hash(args.manifest)
    manifest = json.loads(args.manifest.read_text())
    # Reject protected/foreign contracts before opening any image/target asset.
    records = checked_development_records(manifest)
    cases = []
    inputs = {str(args.manifest.resolve()): original_manifest_hash}
    for index, record in enumerate(records):
        paths = {}
        for kind in ("image", "targets"):
            path = (args.manifest.parent / record[kind]).resolve()
            if not path.is_relative_to(args.manifest.parent.resolve()):
                raise ValueError("Asset escapes manifest directory")
            verify_hashes({path: record[f"{kind}_sha256"]})
            inputs[str(path)] = record[f"{kind}_sha256"]
            paths[kind] = str(path)
        with Image.open(paths["image"]) as image:
            dimensions = list(image.size)
        cases.append({"id": record["id"], "type": "synthetic-development",
                      **paths, "dimensions": dimensions,
                      "viewports": regular_viewports(*dimensions) if index == 0 else regular_viewports(*dimensions)[:1],
                      "selection_rule": "first two validation records in frozen manifest order"})
    a511 = args.a511.resolve()
    inputs[str(a511)] = file_hash(a511)
    with Image.open(a511) as image:
        dimensions = list(image.size)
    cases.append({"id": "a511", "type": "qualitative-no-complete-ground-truth", "image": str(a511),
                  "dimensions": dimensions, "targets": None, "viewports": regular_viewports(*dimensions),
                  "selection_rule": "user-requested drawing; crops fixed from image dimensions"})
    verify_hashes(inputs)
    write_json(args.output, {"version": VERSION, "model": MODEL, "revision": REVISION,
               "manifest": str(args.manifest.resolve()),
               "checkpoint_sha256": WEIGHTS_SHA256, "source_hashes": source_hashes(), "inputs": inputs,
               "prompt": PROMPT, "prompt_sha256": __import__("hashlib").sha256(PROMPT.encode()).hexdigest(),
               "inference": dict(GREEDY_SETTINGS),
               "cases": cases, "supplied_seeds": [], "ground_truth_used_for_prompts": False,
               "metric": "one-to-one point-in-room coverage; not polygon/boundary accuracy"})
    print(json.dumps({"frozen_cases": len(cases), "viewports": sum(len(c["viewports"]) for c in cases)}))


def load_plan(path):
    plan = json.loads(path.read_text())
    if (plan["version"] != VERSION or plan["model"] != MODEL or plan["revision"] != REVISION or
            plan["checkpoint_sha256"] != WEIGHTS_SHA256 or plan["source_hashes"] != source_hashes() or
            plan["prompt"] != PROMPT or plan["supplied_seeds"] or plan["ground_truth_used_for_prompts"] or
            plan["inference"] not in (GREEDY_SETTINGS, SAMPLING_SETTINGS)):
        raise ValueError("Frozen plan does not match source/protocol")
    manifest = Path(plan["manifest"])
    if str(manifest) not in plan["inputs"]:
        raise ValueError("Frozen development manifest is required")
    # Check the contract/exclusions before reading any image or target bytes.
    verify_hashes({manifest: plan["inputs"][str(manifest)]})
    records = checked_development_records(json.loads(manifest.read_text()))
    if len(plan["cases"]) != 3:
        raise ValueError("Exactly the declared two development cases and one qualitative case required")
    for index, record in enumerate(records):
        case = plan["cases"][index]
        if (case["id"] != record["id"] or case["type"] != "synthetic-development" or
                case["image"] != str((manifest.parent / record["image"]).resolve()) or
                case["targets"] != str((manifest.parent / record["targets"]).resolve())):
            raise ValueError("Development case differs from frozen manifest selection")
        for name in ("image", "targets"):
            if plan["inputs"].get(case[name]) != record[f"{name}_sha256"]:
                raise ValueError("Plan asset hash differs from source manifest")
    if plan["cases"][2]["id"] != "a511" or plan["cases"][2]["type"] != "qualitative-no-complete-ground-truth" or plan["cases"][2]["targets"] is not None:
        raise ValueError("Qualitative input must not have a ground-truth target")
    for index, case in enumerate(plan["cases"]):
        dims = case["dimensions"]
        if not isinstance(dims, list) or len(dims) != 2 or any(type(n) is not int for n in dims) or dims[0] * dims[1] > 30_000_000:
            raise ValueError("Invalid frozen source dimensions")
        expected = regular_viewports(*dims)
        if case["viewports"] != (expected[:1] if index == 1 else expected):
            raise ValueError("Crops must remain the dimension-only frozen policy")
    expected_inputs = {str(manifest), plan["cases"][2]["image"],
                       *(case[name] for case in plan["cases"][:2] for name in ("image", "targets"))}
    parent = plan.get("control_parent_plan_path")
    if parent:
        if plan["inference"] != SAMPLING_SETTINGS or plan["inputs"].get(parent) != plan.get("control_parent_plan_sha256"):
            raise ValueError("Control parent byte binding is required")
        expected_inputs.add(parent)
    if set(plan["inputs"]) != expected_inputs:
        raise ValueError("Only declared manifest, development assets and qualitative input may be read")
    verify_hashes(plan["inputs"])
    return plan


def freeze_control(args):
    # The original source snapshot remains private and immutable. Only generation
    # parameters change; case order, viewports, prompt and input hashes are reused.
    plan = load_plan(args.parent)
    if plan["prompt"] != PROMPT or plan["revision"] != REVISION or plan["inference"]["sampling"] != "greedy":
        raise ValueError("Control requires the declared greedy pilot")
    verify_hashes(plan["inputs"])
    plan["control_parent_plan_sha256"] = file_hash(args.parent)
    plan["control_parent_plan_path"] = str(args.parent.resolve())
    plan["inputs"][str(args.parent.resolve())] = file_hash(args.parent)
    plan["source_hashes"] = source_hashes()
    plan["inference"] = dict(SAMPLING_SETTINGS)
    write_json(args.output, plan)


class PresencePenalty:
    """Subtract a fixed logit penalty once for each previously generated token.

    Matches vLLM's output-mask definition; prompt tokens are not penalized. Kept
    separate from repetition penalty, which uses a different multiplicative rule.
    """
    def __init__(self, prompt_length: int, penalty: float):
        self.prompt_length, self.penalty = prompt_length, penalty

    def __call__(self, input_ids, scores):
        import torch
        output = input_ids[:, self.prompt_length:]
        present = torch.zeros_like(scores, dtype=torch.bool)
        present.scatter_(1, output, True)
        return scores - present.to(scores.dtype) * self.penalty


def checked_model(path):
    path = path.resolve()
    provenance_path = path / "download-provenance.json"
    if provenance_path.is_symlink() or not provenance_path.is_file():
        raise ValueError("Model provenance must be an ordinary private file")
    raw = provenance_path.read_bytes()
    provenance = json.loads(raw)
    verified_provenance(provenance)
    files = {str(provenance_path): __import__("hashlib").sha256(raw).hexdigest()}
    for name in FILES:
        asset = path / name
        if asset.parent != path:
            raise ValueError("Model filename escapes directory")
        verified_asset(asset, name)
        files[str(asset)] = provenance["files"][name]["sha256"]
    verify_hashes(files)
    return files


def runtime_versions():
    import torch
    return {"python": platform.python_version(), "gpu": torch.cuda.get_device_name(),
            **{name: importlib.metadata.version(name) for name in
               ("torch", "torchvision", "transformers", "huggingface-hub", "safetensors", "pillow", "numpy")}}


def result_paths(plan, output):
    return [output / f"{case['id']}-viewport-{index}.json" for case in plan["cases"]
            for index in range(len(case["viewports"]))]


def finalize_run(plan_path, plan, model_path, model_files, runtime, output, original_plan_hash, emitted_hashes):
    # Called only after an unbounded-by-count run has emitted every planned view.
    if file_hash(plan_path) != original_plan_hash or load_plan(plan_path) != plan or runtime_versions() != runtime:
        raise ValueError("Final source/plan/runtime fence failed")
    if checked_model(model_path) != model_files:
        raise ValueError("Final complete model/provenance byte fence failed")
    expected = {str(path.resolve()) for path in result_paths(plan, output)}
    if set(emitted_hashes) != expected:
        raise ValueError("Every planned result must have an original emitted-byte hash")
    hashes = dict(emitted_hashes)
    verify_hashes(plan["inputs"])
    verify_hashes(model_files)
    verify_hashes(hashes)
    write_json(output / "completed-run.json", {"version": VERSION, "status": "finalized",
               "plan_sha256": original_plan_hash, "source_hashes": plan["source_hashes"],
               "inputs": plan["inputs"], "model_directory": str(model_path.resolve()),
               "model_files": model_files, "runtime": runtime, "result_hashes": hashes})


def checked_completion(plan_path, plan, output):
    completion_path = output / "completed-run.json"
    if completion_path.is_symlink() or not completion_path.is_file():
        raise ValueError("Only a finalized complete run can be scored")
    marker_hash = file_hash(completion_path)
    marker = json.loads(completion_path.read_text())
    if (marker.get("version") != VERSION or marker.get("status") != "finalized" or
            marker.get("plan_sha256") != file_hash(plan_path) or marker.get("source_hashes") != plan["source_hashes"]
            or marker.get("inputs") != plan["inputs"]):
        raise ValueError("Completed-run provenance does not match plan")
    expected = {str(path.resolve()) for path in result_paths(plan, output)}
    if set(marker.get("result_hashes", {})) != expected:
        raise ValueError("Completion must bind exactly every frozen result")
    if checked_model(Path(marker["model_directory"])) != marker["model_files"]:
        raise ValueError("Complete model files changed after finalization")
    verify_hashes(marker["result_hashes"])
    verify_hashes({completion_path: marker_hash})
    return marker, marker_hash


def infer(args):
    # Offline mode applies even to optional Transformers lookups. PIL images are
    # passed directly; no URL, provider, access token or application config is read.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from PIL import Image
    from transformers import AutoModelForImageTextToText, AutoProcessor, LogitsProcessorList

    plan = load_plan(args.plan)
    plan_hash = file_hash(args.plan)
    model_files = checked_model(args.model)
    settings = plan["inference"]
    torch.set_num_threads(4)
    torch.manual_seed(settings["seed"])
    if not torch.cuda.is_available():
        raise ValueError("This bounded pilot requires the locally measured CUDA runtime")
    total = torch.cuda.get_device_properties(0).total_memory
    torch.cuda.set_per_process_memory_fraction(settings["gpu_allocated_limit_gib"] * 2 ** 30 / total)
    runtime = runtime_versions()
    started = time.monotonic()
    model = AutoModelForImageTextToText.from_pretrained(
        str(args.model.resolve()), local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, attn_implementation="sdpa").eval().to("cuda")
    processor = AutoProcessor.from_pretrained(str(args.model.resolve()), local_files_only=True,
                                             trust_remote_code=False)
    processor.image_processor.size = {"shortest_edge": settings["min_pixels"], "longest_edge": settings["max_pixels"]}
    torch.cuda.synchronize()
    load_ms = (time.monotonic() - started) * 1000
    count = 0
    emitted_hashes = {}
    for case in plan["cases"]:
        for index, viewport in enumerate(case["viewports"]):
            name = f"{case['id']}-viewport-{index}"
            output = args.output / f"{name}.json"
            if output.exists():
                raise ValueError("Results are immutable; use a new experiment plan/output")
            if source_hashes() != plan["source_hashes"] or file_hash(args.plan) != plan_hash:
                raise ValueError("Source/plan changed during generation")
            verify_hashes({case["image"]: plan["inputs"][case["image"]]})
            raw_image = checked_bytes(Path(case["image"]), plan["inputs"][case["image"]])
            with Image.open(io.BytesIO(raw_image)) as source:
                if list(source.size) != case["dimensions"] or source.width * source.height > 30_000_000:
                    raise ValueError("Source dimensions changed or exceed bound")
                image = source.convert("RGB").crop(viewport)
            messages = [{"role": "user", "content": [{"type": "image", "image": image},
                                                        {"type": "text", "text": plan["prompt"]}]}]
            torch.cuda.synchronize()
            start = time.monotonic()
            result = {"id": case["id"], "viewport_index": index, "viewport_source_px": viewport,
                      "plan_sha256": plan_hash, "source_image_sha256": plan["inputs"][case["image"]],
                      "source_hashes": plan["source_hashes"], "checkpoint_sha256": WEIGHTS_SHA256,
                      "runtime": runtime, "supplied_seeds": [], "status": "failed", "census": None}
            try:
                inputs = processor.apply_chat_template(messages, tokenize=True, add_generation_prompt=True,
                                                       return_dict=True, return_tensors="pt").to("cuda")
                result["input_tokens"] = int(inputs.input_ids.shape[1])
                result["image_grid_thw"] = inputs.image_grid_thw.cpu().tolist()
                generation = {"do_sample": False}
                if settings["sampling"] == "official-reference-fixed-seed":
                    # Reset the seed per viewport so case order does not change
                    # the declared control's random stream.
                    torch.manual_seed(settings["seed"])
                    generation = {"do_sample": True, "temperature": settings["temperature"],
                                  "top_p": settings["top_p"], "top_k": settings["top_k"],
                                  "repetition_penalty": settings["repetition_penalty"],
                                  "logits_processor": LogitsProcessorList([
                                      PresencePenalty(inputs.input_ids.shape[1], settings["presence_penalty"])])}
                with torch.inference_mode():
                    tokens = model.generate(**inputs, **generation, max_new_tokens=settings["max_new_tokens"],
                                            max_time=settings["max_time_seconds"])
                new = tokens[0, inputs.input_ids.shape[1]:]
                result["output_tokens"] = int(new.numel())
                result["raw_text"] = processor.decode(new, skip_special_tokens=True, clean_up_tokenization_spaces=False)
                eos = model.generation_config.eos_token_id
                eos = eos if isinstance(eos, list) else [eos]
                if int(new[-1]) not in eos:
                    raise ValueError("Generation truncated or timed out; no partial census accepted")
                result["census"] = source_coordinates(parse_census(result["raw_text"]), viewport, case["dimensions"])
                result["status"] = "ok"
            except (ValueError, RuntimeError, json.JSONDecodeError) as error:
                # Messages contain local paths but no credentials. Preserve the
                # failure, without retrying or silently repairing model output.
                result["error"] = str(error)[:500]
            torch.cuda.synchronize()
            result["wall_ms"] = (time.monotonic() - start) * 1000
            result["model_load_ms"] = load_ms
            result["peak_gpu_allocated_mib"] = torch.cuda.max_memory_allocated() / 2 ** 20
            result["peak_gpu_reserved_mib"] = torch.cuda.max_memory_reserved() / 2 ** 20
            if result["peak_gpu_allocated_mib"] > settings["gpu_allocated_limit_gib"] * 1024:
                raise ValueError("GPU cap exceeded")
            verify_hashes({case["image"]: plan["inputs"][case["image"]]})
            write_json(output, result)
            emitted_hashes[str(output.resolve())] = file_hash(output)
            print(json.dumps({"case": name, "status": result["status"],
                              "points": len(result["census"]["spaces"]) if result["census"] else None,
                              "wall_ms": result["wall_ms"], "peak_gpu_mib": result["peak_gpu_allocated_mib"]}), flush=True)
            count += 1
            if args.limit and count >= args.limit:
                verify_hashes(model_files)
                verify_hashes(plan["inputs"])
                # Partial/debug invocations deliberately do not finalize even
                # when limit happens to equal the planned view count.
                return
    finalize_run(args.plan, plan, args.model, model_files, runtime, args.output, plan_hash, emitted_hashes)


def score_results(args):
    import numpy as np
    plan = load_plan(args.plan)
    plan_hash = file_hash(args.plan)
    completion, completion_hash = checked_completion(args.plan, plan, args.results)
    rows = []
    result_hashes = {}
    # Require the complete frozen run before decoding any ground-truth target.
    for case in plan["cases"]:
        for index in range(len(case["viewports"])):
            if not (args.results / f"{case['id']}-viewport-{index}.json").exists():
                raise ValueError("Missing inference result; do not score a partial run")
    for case in plan["cases"]:
        results = []
        for index in range(len(case["viewports"])):
            path = args.results / f"{case['id']}-viewport-{index}.json"
            if not path.exists():
                raise ValueError("Missing inference result; do not score a partial run")
            result_hashes[str(path)] = file_hash(path)
            result = json.loads(path.read_text())
            if (result["plan_sha256"] != plan_hash or result["source_hashes"] != plan["source_hashes"] or
                    result["checkpoint_sha256"] != WEIGHTS_SHA256 or result["id"] != case["id"] or
                    result["viewport_index"] != index or result["status"] not in {"ok", "failed"} or
                    result["runtime"] != completion["runtime"] or
                    result["source_image_sha256"] != plan["inputs"][case["image"]] or
                    result["viewport_source_px"] != case["viewports"][index] or result["supplied_seeds"]):
                raise ValueError("Inference result provenance mismatch")
            if result["status"] == "ok":
                expected = source_coordinates(parse_census(result["raw_text"]), case["viewports"][index], case["dimensions"])
                if result["census"] != expected:
                    raise ValueError("Saved census does not match raw output/coordinate transform")
            elif result["census"] is not None:
                raise ValueError("Failed output cannot contain a salvaged census")
            results.append(result)
        # Targets are decoded only here, after every viewport result exists. They
        # never define input prompts, points, regions, crops or stopping criteria.
        truth = None
        if case["targets"]:
            target_bytes = checked_bytes(Path(case["targets"]), plan["inputs"][case["targets"]])
            with np.load(io.BytesIO(target_bytes)) as arrays:
                truth = arrays["truth"].copy()
            if list(truth.shape[::-1]) != case["dimensions"]:
                raise ValueError("Truth/source dimensions mismatch")
        for label, selected in (("whole", results[:1]), ("fixed-quadrants", results[1:])):
            if not selected:
                continue
            failed = sum(r["status"] != "ok" for r in selected)
            points = [space["source_point_px"] for result in selected if result["census"]
                      for space in result["census"]["spaces"]]
            row = {"id": case["id"], "type": case["type"], "view": label,
                   "failed_viewports": failed, "predicted_points": len(points),
                   "metrics": None if truth is None else point_coverage(truth, points),
                   "total_wall_ms": sum(r["wall_ms"] for r in selected),
                   "peak_gpu_allocated_mib": max(r["peak_gpu_allocated_mib"] for r in selected)}
            if failed:
                row["status"] = "failed-incomplete-census"
                # Missing viewports cannot be represented as successful recall.
                if row["metrics"]:
                    row["metrics"]["zero_missed_rooms"] = False
            else:
                row["status"] = "ok"
            rows.append(row)
    verify_hashes(result_hashes)
    verify_hashes(plan["inputs"])
    verify_hashes({args.results / "completed-run.json": completion_hash})
    write_json(args.output, {"version": VERSION, "plan_sha256": plan_hash,
               "completion_sha256": completion_hash, "model_files": completion["model_files"],
               "runtime": completion["runtime"],
               "result_hashes": result_hashes, "source_hashes": plan["source_hashes"], "cases": rows,
               "limitations": ["Only inferred interior-point coverage is scored; no outlines are generated.",
                               "Kinds and coarse building boxes are unvalidated model interpretations.",
                               "A511 has no complete ground truth; it receives no accuracy score.",
                               "This small synthetic development pilot is not a holdout or deployment gate."]})
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("freeze")
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--a511", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.set_defaults(run=freeze)
    p = sub.add_parser("freeze-control")
    p.add_argument("--parent", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.set_defaults(run=freeze_control)
    p = sub.add_parser("infer")
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--limit", type=int, default=0)
    p.set_defaults(run=infer)
    p = sub.add_parser("score")
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--results", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.set_defaults(run=score_results)
    parsed = parser.parse_args()
    parsed.run(parsed)
