"""Bounded CPU audit of two already exposed page-18 saved Raster2Seq trials only."""
import argparse
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

from ink import CONFIG, profile

SOURCE = "0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828"
PDF = "17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f"
REPORTS = {"0be1853222df3b17428996e4f00c1cbe9cfaf62acde590b507041ea3babd7f12",
           "c71963142151144323ab83578cb81cfb2834f59547d138a93e7e2a385bf68eb7"}
PAGE_SIZE = (5000, 3750)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024*1024):
            h.update(chunk)
    return h.hexdigest()


def checked(path, expected, pins):
    if digest(path) != expected:
        raise ValueError("Frozen input bytes changed")
    pins[str(path.resolve())] = expected
    return path


def read(path, pins, expected=None):
    if path.stat().st_size > 32*1024*1024:
        raise ValueError("JSON budget exceeded")
    checked(path, expected or digest(path), pins)
    return json.loads(path.read_bytes())


def unchanged(pins):
    for name, expected in pins.items():
        checked(Path(name), expected, {})


def run(trial, output):
    pins = {str(p.resolve()): digest(p) for p in (Path(__file__), Path(__file__).with_name("ink.py"))}
    runtime = {"python": sys.version, **{k: version(k) for k in ("numpy", "Pillow", "shapely")}}
    report_hash = digest(trial / "report.json")
    if report_hash not in REPORTS:
        raise ValueError("Only the two fixed exposed page18 reports are allowed")
    report = read(trial / "report.json", pins, report_hash)
    plan = read(trial / "plan.json", pins, report["plan_sha256"])
    if (report.get("status") != "completed-qualitative-only" or
            plan.get("output") != str(trial.resolve()) or plan.get("source_sha256") != SOURCE or
            plan.get("pdf_sha256") != PDF or plan.get("pdf_page_one_based", plan.get("page_one_based")) != 18 or
            plan.get("pdf_page_index", plan.get("page_index")) != 17 or
            plan.get("approved_for_production") is not False or plan.get("all_space_scoring_eligible") is not False):
        raise ValueError("Wrong source page or unsupported trial scope")
    source_path = checked(Path(plan["source"]), SOURCE, pins)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir(mode=0o700)  # Original output claim before native pixel decoding.
    archive = output / "sources"
    archive.mkdir(mode=0o700)
    archived = {}
    for path in (Path(__file__), Path(__file__).with_name("ink.py")):
        destination = archive / path.name
        destination.write_bytes(path.read_bytes())
        destination.chmod(0o600)
        checked(destination, pins[str(path.resolve())], archived)
    page = Image.open(source_path).convert("RGB")
    if page.size != PAGE_SIZE:
        raise ValueError("Unexpected native source frame")
    rows, views = [], []
    for case in report["cases"]:
        ident = case["id"]
        if not isinstance(ident, str) or not all(c.isalnum() or c == "-" for c in ident):
            raise ValueError("Unsafe case identity")
        case_path, image_path = trial / f"{ident}.json", trial / f"{ident}-source.png"
        data = read(case_path, pins, report["emitted"][case_path.name])
        checked(image_path, report["emitted"][image_path.name], pins)
        box = case["pixel_box"]
        if data["pixel_box"] != box or len(box) != 4 or any(type(x) is not int for x in box):
            raise ValueError("Case geometry frame changed")
        raw = Image.open(image_path).convert("RGB")
        crop = page.crop(tuple(box))
        if raw.size != crop.size or not np.array_equal(np.asarray(raw), np.asarray(crop)):
            raise ValueError("Evidence image is not an exact raw-source crop")
        rgb = np.asarray(raw)
        counts = {"audited": 0, "invalid": 0, "lines": 0, "outside_crop": 0}
        for candidate in data["predictions"]:
            if candidate["kind"] != "polygon":
                counts["lines"] += 1
                continue
            if not candidate["valid_polygon"]:
                counts["invalid"] += 1
                continue
            if candidate.get("outside_crop"):
                counts["outside_crop"] += 1
                continue
            points = [(x*page.width-box[0], y*page.height-box[1]) for x, y in candidate["full_page_normalized_points"]]
            evidence = profile(rgb, points)
            rows.append({"view": ident, "proposal_id": candidate["id"], "model_label_unverified": candidate["label"],
                         "full_page_normalized_points": candidate["full_page_normalized_points"],
                         "crop_pixel_points": points, **evidence})
            counts["audited"] += 1
        views.append({"id": ident, "pixel_box": box, "counts": counts})
    unchanged({**pins, **archived})
    if runtime != {"python": sys.version, **{k: version(k) for k in ("numpy", "Pillow", "shapely")}}:
        raise ValueError("Runtime drift")
    result = {"contract": "raw-source-ink-diagnostic-v1", "source_pdf_sha256": PDF, "original_page_one_based": 18,
              "source_png_sha256": SOURCE, "trial_report_sha256": report_hash, "config": CONFIG,
              "runtime": runtime, "input_and_source_hashes": pins, "views": views, "proposals": rows,
              "archived_source_hashes": archived,
              "accuracy_measured": False, "all_space_scoring_eligible": False, "approved_for_production": False,
              "limitations": ["Ink strokes are not certified walls; furniture, grids, dimensions and hall markings can match them.",
                 "Axis-aligned longest runs omit angled or interrupted barriers; no bridging is performed.",
                 "Boundary support measures nearby ink, not correct room boundaries or doors.",
                 "Profiles use original raw RGB only, retaining faint gray and colored evidence; no learned-input gamma is applied.",
                 "Overlapping views are one drawing, not independent ground truth or floors.",
                 "Invalid and out-of-crop proposals are counted and not repaired/clipped; absence of contradiction never certifies a room."]}
    # Explicit, per-view inspection order. This is raw stroke evidence, never
    # an estimated probability of a merge or a wall; grids can rank just as high.
    result["review_priority"] = [{"view": view["id"], "key": "achromatic luminance<=224 maximum interior axis-run / bbox axis",
        "proposal_ids": [r["proposal_id"] for r in sorted([r for r in rows if r["view"] == view["id"]],
        key=lambda r: max(next(p for p in r["profiles"] if p["channels"] == "achromatic" and p["luminance_le"] == 224)[k]
                          for k in ("horizontal_bbox_fraction", "vertical_bbox_fraction")), reverse=True)]} for view in views]
    destination = output / "report.json"
    with destination.open("x") as f:
        json.dump(result, f, indent=2, allow_nan=False)
        f.write("\n")
    destination.chmod(0o600)
    emitted = digest(destination)
    unchanged({**pins, **archived, str(destination.resolve()): emitted})
    with (output / "completed.json").open("x") as f:
        json.dump({"output": str(output.resolve()), "report_sha256": emitted,
                   "input_and_source_hashes": pins, "diagnostic_only": True}, f, indent=2)
        f.write("\n")
    (output / "completed.json").chmod(0o600)
    unchanged({**pins, **archived, str(destination.resolve()): emitted})
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--trial", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    a = p.parse_args()
    result = run(a.trial, a.out)
    print(json.dumps({"views": result["views"], "diagnostic_only": True}))
