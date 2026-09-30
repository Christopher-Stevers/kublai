"""One-time synthetic generalization after a completed development selection."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import time

import numpy as np
from PIL import Image
import torch

from build_data import protected_sites, store_case
from build_sheet_data import sheet_case
from common import HEADS, REPO, VERSION as TRAINING_VERSION, checked_asset, file_hash, private_dir, source_hashes, write_json
from context_evaluate import aggregate, geometry_runtime, geometry_sources, pixel_scores, score, summarize_pixels
from context_predict import context_probabilities, load_context_model, runtime_versions, verify_hashes
from hybrid_native import PRESETS, native_probabilities
from predict import global_rooms
from roi_challenger import PRESETS as ROI_PRESETS, bounded_rooms

CONTRACT = "context-untouched-generalization-v2"
SELECTION_CONTRACT = "context-development-selection-v2"
FIXED = {"boundary": 0.5, "interior": 0.35, "min_area": 25, "pixel": 0.5, "overlap": 128}
INFERENCE_FILES = ("common.py", "network.py", "context_network.py", "context_predict.py", "predict.py")


def inference_settings(roi_preset=None):
    if roi_preset is not None and roi_preset not in ROI_PRESETS:
        raise ValueError("Choose an already scored declared ROI operating point")
    return {**FIXED, **({"boundary": ROI_PRESETS[roi_preset]["boundary"]} if roi_preset is not None else {})}


def inference_hashes(preset, roi_preset=None):
    names = (*INFERENCE_FILES, *(("hybrid_native.py",) if preset is not None else ()),
             *(("roi_challenger.py", "roi_evaluate.py") if roi_preset is not None else ()))
    current = source_hashes()
    return {name: current[name] for name in names}


def manifest_sites(path):
    """Read exclusion metadata only, never an old evaluation image or target."""
    data = json.loads(path.read_text())
    records = data.get("records")
    if data.get("version") != TRAINING_VERSION or not isinstance(records, list) or not records:
        raise ValueError("Supply the complete pilot/context training-and-validation manifests")
    if any(r.get("split") not in ("train", "validation") or not isinstance(r.get("site"), str) or not r["site"] for r in records):
        raise ValueError("Every prior model record must have an explicit site and development split")
    return {str(record["site"]) for record in records}


def exclusion_union(protected, pilot, context):
    geometric = protected_sites(protected)
    if len(geometric) != 89:
        raise ValueError("Supply the complete frozen geometric manifest containing all 89 protected sites")
    return geometric | manifest_sites(pilot) | manifest_sites(context)


def development_rows(report, preset, checkpoint_hash, roi_preset=None):
    if preset is not None and roi_preset is not None:
        raise ValueError("Native and ROI combinations have not been scored; do not invent a new operating point")
    if preset is not None and preset not in PRESETS:
        raise ValueError("Select one declared native preset before generalization")
    settings = inference_settings(roi_preset)
    method = roi_preset if roi_preset is not None else preset if preset is not None else "context"
    rows = report.get("results", {}).get(method, {}).get("cases", [])
    expected_split = "fixed-whole-sheet-model-development" if roi_preset is not None else "new-whole-sheet-model-development"
    if (report.get("split") != expected_split or not rows or
            any(row.get("status") != "ok" or not row.get("metrics") for row in rows)):
        raise ValueError("Selection requires a completed development room-instance report")
    if report.get("checkpoint_sha256") != checkpoint_hash:
        raise ValueError("Selected checkpoint differs from the completed development report")
    overlap = report.get("overlap", report.get("tiling", {}).get("overlap"))
    thresholds = report.get("thresholds")
    if roi_preset is not None:
        if report.get("presets") != ROI_PRESETS:
            raise ValueError("ROI development settings differ from the exact declared table")
        # The fixed ROI evaluator has no overlap/settings override; its source
        # hash is pinned below, including the hardcoded 128-pixel overlap.
        overlap, thresholds = FIXED["overlap"], {key: settings[key] for key in ("boundary", "interior")}
    if preset is not None:
        polygon = report.get("polygon_thresholds")
        if polygon != {"boundary": FIXED["boundary"], "interior": FIXED["interior"], "minArea": FIXED["min_area"]}:
            raise ValueError("Native development polygon settings must be explicit and fixed")
        thresholds = {key: polygon[key] for key in ("boundary", "interior")}
    if overlap != settings["overlap"] or thresholds != {key: settings[key] for key in ("boundary", "interior")}:
        raise ValueError("Development inference must use the fixed predeclared generalization settings")
    infer = inference_hashes(preset, roi_preset)
    if any(report.get("source_hashes", {}).get(name) != digest for name, digest in infer.items()):
        raise ValueError("Selected inference source differs from the development experiment")
    ids = [row["id"] for row in rows]
    if any(not isinstance(ident, str) or not ident for ident in ids) or len(ids) != len(set(ids)) or not ids:
        raise ValueError("Development case identifiers must be unique and nonempty")
    return ids, infer


def freeze_selection(args):
    """Explicitly freeze one already scored candidate; does not open new data."""
    sources = source_hashes()
    frozen = {args.checkpoint: file_hash(args.checkpoint), args.development_report: file_hash(args.development_report)}
    report = json.loads(args.development_report.read_text())
    preset = args.native_preset
    roi_preset = getattr(args, "roi_preset", None)
    ids, infer = development_rows(report, preset, frozen[args.checkpoint], roi_preset)
    verify_hashes(frozen)
    if source_hashes() != sources:
        raise RuntimeError("Sources changed while freezing selection")
    # Keep the exact development report alongside the explicit selection record.
    report_copy = args.output.with_name(args.output.stem + ".development.json")
    with report_copy.open("xb") as handle:
        handle.write(args.development_report.read_bytes())
    report_copy.chmod(0o600)
    verify_hashes(frozen)
    if file_hash(report_copy) != frozen[args.development_report]:
        raise RuntimeError("Development report changed during its private snapshot")
    selection = {"version": SELECTION_CONTRACT, "selection_complete": True,
                 "selection_path": str(args.output.resolve()),
                 "checkpoint_sha256": frozen[args.checkpoint], "development_manifest_sha256": report["manifest_sha256"],
                 "development_report": {"path": report_copy.name, "sha256": frozen[args.development_report]},
                 "development_case_ids": ids, "native_preset": preset,
                 "native_parameters": dict(PRESETS[preset]) if preset is not None else None,
                 "roi_preset": roi_preset, "roi_parameters": dict(ROI_PRESETS[roi_preset]) if roi_preset is not None else None,
                 "inference": inference_settings(roi_preset), "inference_source_hashes": infer, "selection_source_hashes": sources,
                 "limitations": "Candidate selected using development data. New generalization pixels have not been opened."}
    write_json(args.output, selection)
    return selection


def read_selection(path, checkpoint):
    path = path.resolve()
    selection = json.loads(path.read_text())
    if selection.get("version") != SELECTION_CONTRACT or selection.get("selection_complete") is not True:
        raise ValueError("Freeze a completed development selection before building generalization data")
    if selection.get("selection_path") != str(path.resolve()):
        raise ValueError("Selection is bound to its original resolved path; copied selections cannot create another test")
    roi_preset = selection.get("roi_preset")
    if selection.get("inference") != inference_settings(roi_preset) or selection.get("checkpoint_sha256") != file_hash(checkpoint):
        raise ValueError("Generalization is bound to the selected checkpoint and fixed inference settings")
    preset = selection.get("native_preset")
    if preset is not None and (preset not in PRESETS or selection.get("native_parameters") != PRESETS[preset]):
        raise ValueError("Selected native preset changed after development selection")
    if roi_preset is not None and selection.get("roi_parameters") != ROI_PRESETS[roi_preset]:
        raise ValueError("Selected ROI parameters changed after development selection")
    if selection.get("inference_source_hashes") != inference_hashes(preset, roi_preset):
        raise ValueError("Inference changed after candidate selection")
    report_path = checked_asset(path.parent, selection["development_report"]["path"], selection["development_report"]["sha256"])
    report = json.loads(report_path.read_text())
    ids, _ = development_rows(report, preset, selection["checkpoint_sha256"], roi_preset)
    if ids != selection.get("development_case_ids") or report.get("manifest_sha256") != selection.get("development_manifest_sha256"):
        raise ValueError("Selection differs from its immutable completed development report")
    return selection


def build(args):
    # Selection and checkpoint preflight happen before reading MSD geometry.
    sources = source_hashes()
    frozen = {path: file_hash(path) for path in
              (args.selection, args.checkpoint, args.msd, args.protected_manifest, args.pilot_manifest, args.context_manifest)}
    selection = read_selection(args.selection, args.checkpoint)
    selection_path = args.selection.resolve()
    development = checked_asset(selection_path.parent, selection["development_report"]["path"],
                                selection["development_report"]["sha256"])
    frozen[development] = selection["development_report"]["sha256"]
    if selection["development_manifest_sha256"] != frozen[args.context_manifest]:
        raise ValueError("Selected development report used a different context dataset")
    prior = json.loads(args.context_manifest.read_text())
    validation_ids = {r["id"] for r in prior["records"] if r["split"] == "validation"}
    if validation_ids != set(selection["development_case_ids"]):
        raise ValueError("Complete development validation must finish before generalization selection")
    excluded = exclusion_union(args.protected_manifest, args.pilot_manifest, args.context_manifest)
    _, metadata = load_context_model(args.checkpoint, torch.device("cpu"))
    if metadata["manifest_sha256"] != frozen[args.context_manifest]:
        raise ValueError("Selected checkpoint was trained using a different context manifest")
    verify_hashes(frozen)
    private_dir(args.output)
    # The marker is selection-scoped, so another output directory cannot silently
    # generate a second test corpus from the same frozen selection.
    binding_path = selection_path.with_name(selection_path.stem + ".GENERALIZATION_BUILD_STARTED.json")
    binding = {"version": CONTRACT, "selection_sha256": frozen[args.selection],
               "selection_path": str(selection_path),
               "checkpoint_sha256": frozen[args.checkpoint], "output": str(args.output.resolve()),
               "seed": args.seed, "cases": args.cases}
    write_json(binding_path, binding)
    frozen[binding_path] = file_hash(binding_path)
    pools = {}
    with args.msd.open() as source:
        for line in source:
            record = json.loads(line)
            site = str(record["site_id"])
            if site not in excluded:
                pools.setdefault(site, []).append(record)
    verify_hashes(frozen)
    records = []
    sites = sorted(pools, key=lambda site: hashlib.sha256(f"{args.seed}:{site}".encode()).hexdigest())
    for site in sites:
        candidates = sorted(pools[site], key=lambda row: str(row["id"]))
        seed = int(hashlib.sha256(f"generalization:{args.seed}:{site}".encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        for primary in candidates:
            choices = [primary, *rng.sample(candidates, min(2, len(candidates)))]
            try:
                image, target, known, truth, _, _, layouts = sheet_case(choices, seed)
            except (ValueError, TypeError):
                continue
            ident = "generalization-" + hashlib.sha256(site.encode()).hexdigest()[:16]
            records.append(store_case(args.output, ident, image, target, known, truth, site=site,
                                      group=f"unseen-msd-site:{site}", split="generalization", source="synthetic-msd",
                                      seed=seed, constituent_layouts=layouts))
            print(json.dumps({"built": len(records), "requested": args.cases, "distinct_site": site}), flush=True)
            break
        if source_hashes() != sources:
            raise RuntimeError("Generalization rendering source changed; discard this build")
        if len(records) == args.cases:
            break
    if len(records) != args.cases:
        raise ValueError("Not enough valid distinct unseen sites; no smaller/cherry-picked benchmark is emitted")
    verify_hashes(frozen)
    if source_hashes() != sources:
        raise RuntimeError("Generalization rendering source changed before manifest save")
    manifest = {"version": CONTRACT, "heads": list(HEADS), "records": records, "seed": args.seed,
                "excluded_msd_sites": sorted(excluded), "selected_checkpoint_sha256": frozen[args.checkpoint],
                "selected_training_manifest_sha256": frozen[args.context_manifest],
                "selection_sha256": frozen[args.selection], "selection_path": str(args.selection.resolve()),
                "selection_binding_path": str(binding_path.resolve()), "selection_binding_sha256": frozen[binding_path],
                "inference": selection["inference"], "native_preset": selection["native_preset"],
                "roi_preset": selection.get("roi_preset"), "roi_parameters": selection.get("roi_parameters"),
                "geometry_enabled": not args.without_geometry,
                "source_input_hashes": {str(path.resolve()): digest for path, digest in frozen.items()},
                "render_source_hashes": sources, "geometry_source_hashes": geometry_sources(), "runtime": runtime_versions(),
                "license": "Procedural MSD JSON geometry: CC BY 4.0, https://zenodo.org/records/17294451.",
                "limitations": "Distinct untouched synthetic sites, not genuine construction sheets. Corpus may be scored once only; never used for training or threshold selection."}
    write_json(args.output / "manifest.json", manifest)
    return manifest


def read_generalization_manifest(path):
    data = json.loads(path.read_text())
    if (data.get("version") != CONTRACT or data.get("heads") != list(HEADS) or
            data.get("inference") != inference_settings(data.get("roi_preset"))):
        raise ValueError("Use the separately frozen one-time generalization contract")
    excluded, sites, ids = set(data["excluded_msd_sites"]), set(), set()
    if not data.get("records"):
        raise ValueError("Generalization requires nonempty unseen-site records")
    for record in data["records"]:
        site, ident = record["site"], record["id"]
        if not isinstance(site, str) or not site:
            raise ValueError("Generalization records require explicit site identifiers")
        if site in excluded or site in sites:
            raise ValueError("Generalization sites must be distinct and outside every protected/development site")
        if not isinstance(ident, str) or not ident or Path(ident).name != ident or ident in ids:
            raise ValueError("Generalization identifiers must be unique plain filenames")
        if record.get("split") != "generalization":
            raise ValueError("Generalization records cannot be training/development records")
        sites.add(site); ids.add(ident)
    return data


def claim_evaluation(root, selection_path, checkpoint_hash, manifest_hash):
    """An attempted run consumes the corpus even if scoring later fails."""
    selection_marker = selection_path.with_name(selection_path.stem + ".GENERALIZATION_EVALUATION_STARTED.json")
    value = {"version": CONTRACT, "corpus_path": str(root.resolve()),
               "checkpoint_sha256": checkpoint_hash, "manifest_sha256": manifest_hash,
               "policy": "One attempt only. No parameter changes or rescoring of these exposed sites."}
    write_json(selection_marker, value)
    corpus_marker = root / "EVALUATION_STARTED.json"
    write_json(corpus_marker, value)
    return selection_marker, corpus_marker


def evaluate(args):
    sources, reference = source_hashes(), geometry_sources()
    frozen = {args.manifest: file_hash(args.manifest), args.checkpoint: file_hash(args.checkpoint)}
    manifest = read_generalization_manifest(args.manifest)
    if frozen[args.checkpoint] != manifest["selected_checkpoint_sha256"]:
        raise ValueError("A different checkpoint cannot open this generalization corpus")
    selection_path = Path(manifest["selection_path"])
    selection = read_selection(selection_path, args.checkpoint)
    if (manifest["inference"] != selection["inference"] or
            manifest.get("native_preset") != selection.get("native_preset") or
            manifest.get("roi_preset") != selection.get("roi_preset") or
            manifest.get("roi_parameters") != selection.get("roi_parameters")):
        raise ValueError("Manifest operating point differs from the frozen development selection")
    frozen[selection_path] = manifest["selection_sha256"]
    binding_path = Path(manifest["selection_binding_path"])
    frozen[binding_path] = manifest["selection_binding_sha256"]
    verify_hashes({selection_path: frozen[selection_path], binding_path: frozen[binding_path]})
    binding = json.loads(binding_path.read_text())
    canonical_binding = selection_path.resolve().with_name(selection_path.stem + ".GENERALIZATION_BUILD_STARTED.json")
    if (binding_path.resolve() != canonical_binding or binding.get("version") != CONTRACT or
            binding.get("selection_path") != str(selection_path.resolve()) or
            binding.get("selection_sha256") != manifest["selection_sha256"] or
            binding.get("checkpoint_sha256") != frozen[args.checkpoint] or
            binding.get("output") != str(args.manifest.parent.resolve()) or
            binding.get("seed") != manifest["seed"] or binding.get("cases") != len(manifest["records"])):
        raise ValueError("Generalization is bound to its original resolved corpus/selection; copied corpora cannot be scored")
    frozen.update({Path(path): digest for path, digest in manifest["source_input_hashes"].items()})
    if sources != manifest["render_source_hashes"] or reference != manifest["geometry_source_hashes"]:
        raise ValueError("Sources changed after freezing untouched generalization; do not rescore with new code")
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    model, metadata = load_context_model(args.checkpoint, device)
    if metadata["manifest_sha256"] != manifest["selected_training_manifest_sha256"]:
        raise ValueError("Checkpoint training manifest differs from the frozen selection")
    for case in manifest["records"]:
        for name, hash_name in (("image", "image_sha256"), ("targets", "targets_sha256")):
            asset = checked_asset(args.manifest.parent, case[name], case[hash_name])
            frozen[asset] = case[hash_name]
    verify_hashes(frozen)
    reference_runtime = geometry_runtime(args.node) if manifest["geometry_enabled"] else None
    private_dir(args.output)
    markers = claim_evaluation(args.manifest.parent.resolve(), selection_path.resolve(), frozen[args.checkpoint], frozen[args.manifest])
    frozen.update({path: file_hash(path) for path in markers})
    methods = {"selected_model": [], **({"geometry": []} if manifest["geometry_enabled"] else {})}
    for case in manifest["records"]:
        verify_hashes(frozen)
        if source_hashes() != sources or geometry_sources() != reference:
            raise RuntimeError("Sources changed during one-time scoring; this attempted corpus remains consumed")
        target_path = checked_asset(args.manifest.parent, case["targets"], case["targets_sha256"])
        image_path = checked_asset(args.manifest.parent, case["image"], case["image_sha256"])
        with np.load(target_path) as arrays:
            truth, target, known = arrays["truth"].copy(), arrays["target"].copy(), arrays["known"].copy()
        with Image.open(image_path) as source:
            image = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
        if (target.shape != (len(HEADS), *truth.shape) or known.shape != target.shape or
                truth.shape != image.shape[:2] or not np.all(known == 1) or not np.isin(target, (0, 1)).all()):
            raise ValueError("One-time all-room scoring requires intact dense synthetic supervision")
        verify_hashes({image_path: case["image_sha256"], target_path: case["targets_sha256"]})
        started = time.monotonic()
        probability, _ = context_probabilities(model, image, metadata["tile"], FIXED["overlap"], metadata["overview"], device)
        diagnostics = None
        if selection["native_preset"] is not None:
            probability, diagnostics = native_probabilities(image, probability, selection["native_preset"])
        if selection.get("roi_preset") is not None:
            labels, rooms, diagnostics = bounded_rooms(probability, selection["roi_preset"])
        else:
            settings = selection["inference"]
            labels, rooms = global_rooms(probability, settings["boundary"], settings["interior"], settings["min_area"])
        methods["selected_model"].append({"id": case["id"], "group": case["group"], "status": "ok",
                                          "metrics": score(truth, labels), "pixel_metrics": pixel_scores(probability, target, known),
                                          "exported_polygons": len(rooms), "native_diagnostics": diagnostics,
                                          "timing": {"wall_ms": (time.monotonic() - started) * 1000}})
        if manifest["geometry_enabled"]:
            mask, request = args.output / f"{case['id']}.geometry.i32", args.output / f"{case['id']}.request.json"
            write_json(request, {"image": str(image_path.resolve()), "output": str(mask.resolve()), "mode": "complete", "seeds": []})
            verify_hashes({image_path: case["image_sha256"]})
            started = time.monotonic()
            error, predicted = None, np.zeros_like(truth)
            try:
                subprocess.run([args.node, "--max-old-space-size=768", "--import", "tsx", "scripts/rooms/complete/predict.ts", str(request.resolve())],
                               cwd=REPO, capture_output=True, text=True, check=True, timeout=180)
                predicted = np.fromfile(mask, dtype="<i4").reshape(truth.shape)
            except (subprocess.SubprocessError, OSError, ValueError) as failure:
                error = type(failure).__name__
            verify_hashes({image_path: case["image_sha256"], target_path: case["targets_sha256"]})
            methods["geometry"].append({"id": case["id"], "group": case["group"], "status": "error" if error else "ok",
                                        "error_type": error, "metrics": score(truth, predicted),
                                        "timing": {"wall_ms": (time.monotonic() - started) * 1000}})
        print(json.dumps({"one_time_cases": len(methods["selected_model"]), "total": len(manifest["records"])}), flush=True)
    verify_hashes(frozen)
    if source_hashes() != sources or geometry_sources() != reference:
        raise RuntimeError("Source changed before one-time report save")
    if reference_runtime is not None and geometry_runtime(args.node) != reference_runtime:
        raise RuntimeError("Geometry runtime changed during one-time scoring")
    report = {"version": CONTRACT, "split": "once-only-new-sites-generalization", "manifest_sha256": frozen[args.manifest],
              "checkpoint_sha256": frozen[args.checkpoint], "selection_sha256": manifest["selection_sha256"],
              "inference": selection["inference"], "native_preset": selection["native_preset"],
              "roi_preset": selection.get("roi_preset"), "roi_parameters": selection.get("roi_parameters"), "source_hashes": sources,
              "geometry_source_hashes": reference, "geometry_runtime": reference_runtime, "runtime": runtime_versions(),
              "ids": [case["id"] for case in manifest["records"]], "sites": [case["site"] for case in manifest["records"]],
              "results": {name: {"cases": rows, "summary": aggregate(rows),
                                  **({"pixel_summary": summarize_pixels(rows)} if name == "selected_model" else {})}
                          for name, rows in methods.items()}, "approved_for_production": False,
              "limitations": "One-time untouched synthetic sites only. No production/real-sheet completeness claim; no tuning or rescoring on exposed sites."}
    write_json(args.output / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    select = commands.add_parser("freeze-selection")
    select.add_argument("--development-report", type=Path, required=True)
    select.add_argument("--checkpoint", type=Path, required=True)
    select.add_argument("--native-preset", choices=list(PRESETS))
    select.add_argument("--roi-preset", choices=list(ROI_PRESETS))
    select.add_argument("--output", type=Path, required=True)
    create = commands.add_parser("build")
    for name in ("msd", "protected-manifest", "pilot-manifest", "context-manifest", "selection", "checkpoint", "output"):
        create.add_argument("--" + name, type=Path, required=True)
    create.add_argument("--cases", type=int, default=20)
    create.add_argument("--seed", type=int, default=2026093048)
    create.add_argument("--without-geometry", action="store_true")
    run = commands.add_parser("evaluate-once")
    for name in ("manifest", "checkpoint", "output"):
        run.add_argument("--" + name, type=Path, required=True)
    run.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    run.add_argument("--threads", type=int, default=4)
    run.add_argument("--node", default="node")
    args = parser.parse_args()
    if args.command == "build" and args.cases < 1 or args.command == "evaluate-once" and args.threads < 1:
        parser.error("Positive case/thread limits are required")
    os.umask(0o077)
    function = {"freeze-selection": freeze_selection, "build": build, "evaluate-once": evaluate}[args.command]
    result = function(args)
    print(json.dumps({"command": args.command, "version": result["version"],
                      "cases": len(result.get("records", result.get("ids", [])))}))


if __name__ == "__main__":
    main()
