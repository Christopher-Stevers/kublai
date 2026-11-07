"""Fixed, local-only true-opening experiment; no independent room truth."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import math

ROOT = Path(__file__).resolve().parent
MODELS = ROOT.parent / "models"
PARTITION = ROOT.parent / "partition" / "partition.py"
sys.path.insert(0, str(MODELS))
from common import HEADS, checked_asset, file_hash, write_json
from context_train import read_context_manifest
from context_predict import runtime_versions

DATA = Path("/home/tim/datasets/foremanhq-room-detection/models/data-swiss-true-openings-v4-20260930/manifest.json")
DATA_SHA = "619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b"
V3_SHA = "cc5695d917f4602be043262a48df5de18eed68dfb3876cd5b3815f17465a36f4"
OLD = Path("/home/tim/datasets/foremanhq-room-detection/models/train-context-long-20260930/best.pt")
OLD_SHA = "aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313"
ACTUAL = MODELS.parents[2] / ".tmp/a511-source-textfree.png"
ACTUAL_SHA = "0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828"
PARTITION_SHA = "49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713"
PRIOR_SHA = {
    "0a87fe76626ceb927efbe65e63067591fc48e3e780583cb25cf4f8e5816e1d82",
    "ce022ade7db2a97e5c31658c40926eef98b6c2e08e44520a5e6fe60fbdafe30d",
    "79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac",
    "f8cb98efb4c35bfc87d27f4c616f82a7b69cc03fa646d960f043f7d490f0d593",
}
CONFIG = dict(epochs=48, tile=512, batch=2, patches=4, base=16,
              context_base=8, context_weight=.5, lr=.001,
              seed=20260930, threads=4, device="cuda")
CLAIM = DATA.parent.parent / "swiss-true-opening-single-trial-20260930.claim.json"
FALSE_FIELDS = ("physical_room_ground_truth_certified", "all_space_scoring_eligible", "human_completeness_evidence")
WALL_STYLES = {**{f"solid-{g}": {"fill": g, "outline": None, "line_pixels": 0} for g in (0,35,75,180,220)},
               "paired-white-1": {"fill":255,"outline":35,"line_pixels":1},
               "paired-white-2": {"fill":255,"outline":75,"line_pixels":2},
               "paired-gray-1": {"fill":240,"outline":180,"line_pixels":1},
               "paired-gray-2": {"fill":245,"outline":220,"line_pixels":2}}


def validate_metadata(data, counts=None):
    """Metadata only: never resolve previous/protected corpus asset paths."""
    counts = counts or {"train": 80, "validation": 20}
    if data.get("dataset_contract") != "swiss-true-openings-ink-v4" or data.get("overview") != 512:
        raise ValueError("Not the declared true-opening dataset")
    if data.get("ink_baseline_manifest_sha256") != V3_SHA or data.get("ink_only_change_verified") is not True or data.get("target_overview_reference_assets_identical_to_v3") is not True:
        raise ValueError("v4 must preserve the v3 source split and semantic targets")
    if data.get("wall_ink_styles_predeclared") != WALL_STYLES or data.get("simulated_nuisance_policy", {}).get("changes_source_targets_or_references") is not False:
        raise ValueError("Only the declared wall-ink/nuisance renderer is allowed")
    if any(data.get(k) is not False for k in FALSE_FIELDS) or data.get("approved_for_production") is not False:
        raise ValueError("Derived source interiors cannot certify physical room completeness")
    if data.get("validation_is_development") is not True:
        raise ValueError("Only the original declared development split is allowed")
    prior = data.get("prior_manifests", [])
    if len(prior) != 4 or {p["sha256"] for p in prior} != PRIOR_SHA:
        raise ValueError("All four previous role manifests must be pinned")
    excluded = set(data["excluded_msd_sites"])
    if excluded != set().union(*(set(p["sites"]) for p in prior)) or len(excluded) != 173:
        raise ValueError("The entire 173-site exclusion union must remain intact")
    found = {key: 0 for key in counts}
    ids, aliases, groups, images, styles = set(), set(), set(), {}, {}
    for row in data["records"]:
        ident = row["id"]
        if not isinstance(ident, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", ident) or ident in ids:
            raise ValueError("Unique plain case IDs are required")
        ids.add(ident)
        if row["source"] != "swiss-dwellings-real-geometry" or row["split"] not in found:
            raise ValueError("Only the declared Swiss train/development records are allowed")
        found[row["split"]] += 1
        component = set(row["component_aliases"])
        if not component or aliases & component or row["group"] in groups:
            raise ValueError("Source alias/site components must be completely disjoint")
        aliases |= component; groups.add(row["group"])
        if str(row["site"]) in excluded or {f"site:{s}" for s in excluded} & component:
            raise ValueError("A prior/protected site or alias entered the new data")
        if images.setdefault(row["image_sha256"], row["split"]) != row["split"]:
            raise ValueError("Input image crosses splits")
        stats = row["render_stats"]
        style = stats.get("wall_ink_style")
        if style not in WALL_STYLES or stats.get("wall_ink_parameters") != WALL_STYLES[style] or stats.get("nuisance_ink_changes_targets") is not False:
            raise ValueError("Per-case ink must leave genuine semantic targets unchanged")
        styles[style] = styles.get(style, 0) + 1
        if any(stats.get(k) is not False for k in FALSE_FIELDS) or stats.get("generated_geometry_pixel_development_eligible") is not True:
            raise ValueError("Every case must remain head-only, algorithm-derived supervision")
        if not stats.get("real_door_coordinates") or stats.get("functional_area_outlines_used_as_barriers") is not False:
            raise ValueError("Targets must use physical source openings and walls")
    if found != counts or data.get("counts") != counts:
        raise ValueError("Missing/extra original train or development cases")
    if styles != data.get("wall_ink_style_counts"):
        raise ValueError("Declared wall-style coverage differs from the case metadata")


def freeze_paths(paths):
    return {str(Path(p).resolve()): file_hash(Path(p)) for p in paths}


def verify(frozen):
    for name, expected in frozen.items():
        if file_hash(Path(name)) != expected:
            raise RuntimeError(f"Frozen byte binding changed: {name}")


def verify_runtime(expected):
    if runtime_versions() != expected:
        raise RuntimeError("Frozen Python/library/CUDA runtime changed")


def claim_trial(output, runtime, sources):
    """One experiment-scoped atomic claim, independent of --output aliases."""
    write_json(CLAIM, {"contract": "swiss-single-trial-v1", "output": str(output.resolve()),
               "manifest_sha256": DATA_SHA, "config": CONFIG, "runtime": runtime,
               "source_bindings": sources})
    return file_hash(CLAIM)


def source_paths(names):
    return [ROOT / n for n in names] + [p for p in sorted(MODELS.glob("*.py")) if not p.name.startswith("test_")]


def validate_arrays(target, known, expected_shape):
    import numpy as np
    if target.shape != expected_shape or known.shape != expected_shape:
        raise ValueError("Masked head dimensions differ")
    if not np.isin(target, (0, 1)).all() or not np.isin(known, (0, 1)).all():
        raise ValueError("Targets/masks must be finite binary arrays")
    # Positive boundary/opening pixels within unknown areas are allowed; they
    # must be masked in both loss and evaluation, never converted to negatives.


def preflight():
    import numpy as np
    from PIL import Image
    for path, sha in ((DATA, DATA_SHA), (OLD, OLD_SHA), (ACTUAL, ACTUAL_SHA), (PARTITION, PARTITION_SHA)):
        if file_hash(path) != sha:
            raise ValueError(f"Declared experiment identity differs: {path.name}")
    raw = json.loads(DATA.read_text())
    validate_metadata(raw)
    data = read_context_manifest(DATA)  # unchanged trainer compatibility check
    assets = {str(DATA): DATA_SHA, str(OLD): OLD_SHA, str(ACTUAL): ACTUAL_SHA, str(PARTITION): PARTITION_SHA}
    unknown, unknown_openings = 0, 0
    for row in data["records"]:
        paths = {}
        for key in ("image", "targets", "overview", "references"):
            path = checked_asset(DATA.parent, row[key], row[key + "_sha256"])
            assets[str(path)] = row[key + "_sha256"]; paths[key] = path
        with Image.open(paths["image"]) as im:
            if im.mode != "RGB" or im.width * im.height > 30_000_000:
                raise ValueError("Expected bounded RGB rendered page")
            shape = (len(HEADS), im.height, im.width)
        with np.load(paths["targets"], allow_pickle=False) as z:
            target, known = z["target"], z["known"]
            validate_arrays(target, known, shape)
            unknown += int((known == 0).any())
            unknown_openings += int(np.count_nonzero((target[2] > 0) & (known[2] == 0)))
            # Deliberately do not read z['truth']: provisional instances are not GT.
        with np.load(paths["overview"], allow_pickle=False) as z:
            validate_arrays(z["target"], z["known"], (len(HEADS), 512, 512))
    verify(assets)
    return data, assets, {"cases_with_unknown_pixels": unknown, "unsupervised_positive_opening_pixels": unknown_openings,
                          "unchanged_trainer_compatible": True, "all_space_scoring_eligible": False}


def archive_sources(folder, paths):
    folder.mkdir(mode=0o700)
    hashes = {}
    for path in paths:
        relative = ("models" if path.parent == MODELS else "swiss-model") + "/" + path.name
        dest = folder / relative; dest.parent.mkdir(mode=0o700, exist_ok=True)
        shutil.copyfile(path, dest); dest.chmod(0o600)
        hashes[relative] = file_hash(path)
        if file_hash(dest) != hashes[relative]:
            raise RuntimeError("Source snapshot differs")
    write_json(folder / "hashes.json", hashes)
    return hashes


def read_training_binding(path):
    value = json.loads(path.read_text())
    if value.get("contract") != "swiss-true-opening-training-v1" or value.get("config") != CONFIG:
        raise ValueError("Not this fixed one-trial binding")
    if value["assets"].get(str(DATA)) != DATA_SHA or value["assets"].get(str(OLD)) != OLD_SHA:
        raise ValueError("Binding dataset/baseline identity differs")
    if Path(value["output"]).resolve() != path.parent.resolve():
        raise ValueError("Training binding is attached to its original claimed attempt directory")
    verify(value["assets"]); verify(value["source_bindings"])
    if value["assets"].get(str(CLAIM)) != file_hash(CLAIM):
        raise ValueError("Training is not attached to the single experiment-scoped claim")
    claim = json.loads(CLAIM.read_text())
    if claim.get("output") != value["output"] or claim.get("config") != CONFIG or claim.get("manifest_sha256") != DATA_SHA:
        raise ValueError("Single-trial claim identity differs")
    verify_runtime(value["runtime"])
    for relative, sha in value["archived_sources"].items():
        archived = path.parent / "frozen_sources" / relative
        if file_hash(archived) != sha:
            raise ValueError("Archived execution source changed")
    return value


def validate_completion(run, saved, binding):
    """Completed epoch/selection/config/source identity, before model inference."""
    if len(run["history"]) != 48 or [r["epoch"] for r in run["history"]] != list(range(1, 49)):
        raise ValueError("All 48 original epochs must be present")
    for row in run["history"]:
        if any(not math.isfinite(row["loss"][s]) for s in ("train", "validation")):
            raise ValueError("Training loss is nonfinite")
    selected = min(run["history"], key=lambda r: r["loss"]["validation"])["epoch"]
    model_sources = {Path(k).name: v for k, v in binding["archived_sources"].items() if k.startswith("models/")}
    for metadata in (run, saved):
        if any(metadata["config"].get(k) != v for k, v in CONFIG.items()):
            raise ValueError("Only the completed fixed-default 48-epoch configuration is allowed")
        if metadata.get("manifest_sha256") != DATA_SHA or metadata.get("source_hashes") != model_sources:
            raise ValueError("Completed checkpoint source/dataset identity differs")
        if metadata.get("parameters") != 2456454 or metadata.get("heads") != list(HEADS):
            raise ValueError("Declared unchanged architecture differs")
        if metadata["runtime"]["torch"] != binding["runtime"]["torch"] or metadata["runtime"]["cuda"] != binding["runtime"]["cuda"]:
            raise ValueError("Training runtime differs from original binding")
    if saved["selected_epoch"] != selected:
        raise ValueError("Checkpoint is not the lowest development-loss epoch")


def completed_checkpoint(binding_path):
    import torch
    completion_path = binding_path.parent / "completed.json"
    frozen = freeze_paths((binding_path, completion_path))
    binding = read_training_binding(binding_path)
    completed = json.loads(completion_path.read_text())
    if completed["binding_sha256"] != file_hash(binding_path):
        raise ValueError("Completed run binding changed")
    run = binding_path.parent / "training/run.json"
    checkpoint = binding_path.parent / "training/best.pt"
    frozen.update({str(run): completed["run_sha256"], str(checkpoint): completed["checkpoint_sha256"]})
    verify(frozen)
    result = json.loads(run.read_text())
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    metadata = json.loads(saved["metadata_json"])
    validate_completion(result, metadata, binding)
    if result["manifest_sha256"] != DATA_SHA or result["checkpoint_sha256"] != completed["checkpoint_sha256"]:
        raise ValueError("Completed checkpoint dataset identity differs")
    verify(frozen); verify(binding["assets"]); verify(binding["source_bindings"]); verify_runtime(binding["runtime"])
    return binding, checkpoint, result
