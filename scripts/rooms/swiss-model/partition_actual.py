"""CPU replay of the preselected hierarchical preset on the verified actual map."""
from __future__ import annotations
import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "partition"))
import partition
from partition import partition_rooms

ACTUAL_SHA = "0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828"
PARTITION_SHA = "49cfc8ea71eadab40428801beb260e7dd03262422233bdf5ae0dc7278fd3d713"


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""): h.update(block)
    return h.hexdigest()


def verify(binding):
    for name, sha in binding.items():
        if digest(name) != sha: raise ValueError(f"Frozen qualitative bytes changed: {name}")


def runtime():
    return {"python": sys.version.split()[0], **{p: version(p) for p in ("numpy", "Pillow", "scipy", "shapely", "scikit-image")}}


def validate_probe_claim(p, folder, claim):
    if Path(p["output"]).resolve() != folder.resolve() or claim.get("output") != p["output"]:
        raise ValueError("Copied qualitative directories may not make another CPU attempt")
    expected_claim = Path(p["checkpoint"]).parent.parent / "actual_probe_claim.json"
    if Path(p["actual_probe_claim"]).resolve() != expected_claim.resolve():
        raise ValueError("Probe claim is not in the original training attempt")
    if claim.get("input_sha256") != ACTUAL_SHA or claim.get("checkpoint_sha256") != p["checkpoint_sha256"] or claim.get("source_bindings") != p["source_bindings"]:
        raise ValueError("Original actual claim input/checkpoint/source identity differs")
    if claim.get("fixed_presets") != ["plain-.4","hierarchical_basins"]:
        raise ValueError("Fixed qualitative presets changed")


def validate_required_assets(p, folder):
    assets = p["asset_bindings"]
    required = {p["input"]:ACTUAL_SHA,p["checkpoint"]:p["checkpoint_sha256"],
                p["head_report"]:p["head_report_sha256"],p["actual_probe_claim"]:p["actual_probe_claim_sha256"]}
    if any(assets.get(name) != sha for name,sha in required.items()):
        raise ValueError("Mandatory actual input/model/original claim/head-report bindings are missing")
    emitted = {str(folder / "probabilities.npz"):p["probabilities_sha256"],
               str(folder / "plain.json"):p["plain_sha256"],str(folder / "plain-labels.i32"):p["plain_labels_sha256"]}
    if p["emitted_bindings"] != emitted:
        raise ValueError("All original emitted probability/plain output bindings are mandatory")


def read_probe(folder):
    path = folder / "probe_binding.json"
    initial = {str(path): digest(path), str(folder / "probe_completed.json"): digest(folder / "probe_completed.json")}
    completed = json.loads((folder / "probe_completed.json").read_text())
    if digest(path) != completed["probe_binding_sha256"]:
        raise ValueError("Probe completion binding changed")
    p = json.loads(path.read_text())
    if Path(p["output"]).resolve() != folder.resolve():
        raise ValueError("Copied probe directory is not the original attempt")
    validate_required_assets(p, folder)
    claim_path = Path(p["actual_probe_claim"])
    if digest(claim_path) != p["actual_probe_claim_sha256"]:
        raise ValueError("Actual probe claim bytes changed")
    validate_probe_claim(p, folder, json.loads(claim_path.read_text()))
    if p.get("contract") != "swiss-actual-qualitative-probe-v1" or p.get("input_sha256") != ACTUAL_SHA:
        raise ValueError("This is not the authorized clean actual-sheet probe")
    if p.get("partition_source_sha256") != PARTITION_SHA or p.get("hierarchical_preset") != "hierarchical_basins":
        raise ValueError("Only the preselected hierarchical core/preset is allowed")
    if digest(partition.__file__) != PARTITION_SHA or p["source_bindings"].get(str(Path(__file__).resolve())) != digest(__file__):
        raise ValueError("Loaded partition/CPU adapter differs from the GPU-frozen source binding")
    if p.get("all_space_scoring_eligible") is not False or p.get("approved_for_production") is not False:
        raise ValueError("Actual probe has no complete physical-room reference")
    if completed.get("emitted_bindings") != p["emitted_bindings"]:
        raise ValueError("Original emitted outputs differ from probe completion")
    frozen = {**p["asset_bindings"], **p["source_bindings"], **initial,
              **p["emitted_bindings"],str(claim_path):p["actual_probe_claim_sha256"],
              str(folder / "probabilities.npz"): p["probabilities_sha256"],
              str(folder / "plain.json"): p["plain_sha256"], str(folder / "plain-labels.i32"): p["plain_labels_sha256"],
              str(Path(__file__).resolve()): digest(__file__)}
    verify(frozen)
    return p, frozen


def overlay(image, labels, rooms, output, emitted=None):
    colors = np.zeros((*labels.shape, 4), np.uint8)
    rng = np.random.default_rng(20260930)
    palette = rng.integers(50, 220, (int(labels.max())+1, 3), dtype=np.uint8)
    colors[:,:,:3] = palette[labels]; colors[:,:,3] = np.where(labels > 0, 70, 0)
    canvas = Image.alpha_composite(image.convert("RGBA"), Image.fromarray(colors))
    draw = ImageDraw.Draw(canvas)
    for room in rooms:
        points = [(p["x"]*canvas.width, p["y"]*canvas.height) for p in room["shape"]["points"]]
        draw.line(points + points[:1], fill=(0,100,255,255), width=2)
        for hole in room["shape"].get("holes", []):
            hp = [(p["x"]*canvas.width, p["y"]*canvas.height) for p in hole]
            draw.line(hp + hp[:1], fill=(210,50,60,255), width=2)
    canvas.convert("RGB").save(output)
    if emitted is not None: emitted[str(output)] = digest(output)
    preview = output.with_name(output.stem + "-preview.png")
    canvas.thumbnail((2000,2000)); canvas.convert("RGB").save(preview)
    if emitted is not None: emitted[str(preview)] = digest(preview)


def run(folder):
    p, frozen = read_probe(folder)
    versions = runtime(); started = time.monotonic()
    claim_path = folder / "hierarchical_probe_claim.json"
    with claim_path.open("x") as f:
        json.dump({"output":str(folder / "hierarchical"),"probe_binding_sha256":digest(folder / "probe_binding.json"),
                   "probabilities_sha256":p["probabilities_sha256"],"preset":"hierarchical_basins","runtime":versions},f)
    frozen[str(claim_path)] = digest(claim_path)
    output = folder / "hierarchical"; output.mkdir(mode=0o700, exist_ok=False)
    with np.load(folder / "probabilities.npz", allow_pickle=False) as z: probability = z["probability"].copy()
    if probability.shape != (3, p["height"], p["width"]): raise ValueError("Actual probability dimensions differ")
    verify(frozen)
    labels, rooms, diagnostics = partition_rooms(probability, "hierarchical_basins")
    labels.astype("<i4").tofile(output / "labels.i32")
    emitted = {str(output / "labels.i32"):digest(output / "labels.i32")}
    with Image.open(p["input"]) as im:
        overlay(im, labels, rooms, output / "overlay.png",emitted)
        plain = json.loads((folder / "plain.json").read_text())
        plain_labels = np.fromfile(folder / "plain-labels.i32", dtype="<i4").reshape(p["height"], p["width"])
        overlay(im, plain_labels, plain["rooms"], folder / "plain-overlay.png",emitted)
    for index, name in enumerate(("interior", "boundary", "opening")):
        heat = Image.fromarray(np.uint8(np.clip(probability[index],0,1)*255))
        heat.thumbnail((2000,2000)); dest = folder / (name + "-probability-preview.png"); heat.save(dest)
        emitted[str(dest)] = digest(dest)
    verify(frozen); verify(emitted)
    if runtime() != versions: raise RuntimeError("Partition runtime changed during probe")
    areas = np.bincount(labels.ravel())[1:]
    result = {"contract": "swiss-fixed-hierarchical-qualitative-v1", "preset": "hierarchical_basins", "rooms": rooms,
              "proposals": len(rooms), "holes": sum(len(r["shape"].get("holes",[])) for r in rooms), "diagnostics": diagnostics,
              "largest_proposal_pixel_area":int(areas.max()) if len(areas) else 0,
              "largest_proposal_page_fraction":float(areas.max()/labels.size) if len(areas) else 0,
              "width": p["width"], "height": p["height"], "asset_source_bindings": frozen, "output_bindings":emitted,"runtime": versions,
              "wall_seconds": time.monotonic()-started, "approved_for_production": False, "all_space_scoring_eligible": False,
              "limitations": "Fixed qualitative probe with inferred-only markers; no actual room precision/recall or completeness evidence."}
    with (output / "prediction.json").open("x") as f: json.dump(result, f, indent=2, allow_nan=False)
    prediction_sha = digest(output / "prediction.json")
    verify(frozen); verify(emitted)
    if runtime() != versions: raise RuntimeError("Partition runtime changed before completion")
    with (output / "completed.json").open("x") as f:
        json.dump({"prediction_sha256":prediction_sha,"output_bindings":emitted,
                   "claim_sha256":frozen[str(claim_path)],"probe_binding_sha256":digest(folder / "probe_binding.json")},f,indent=2)
    print(json.dumps({"proposals":len(rooms), "holes":result["holes"], "wall_seconds":result["wall_seconds"]}), flush=True)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument("--probe",type=Path,required=True)
    args=parser.parse_args(); os.umask(0o077); run(args.probe.resolve())
