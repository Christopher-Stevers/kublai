"""One fixed overlapping raw256 proposal probe, not a room accuracy evaluator."""
from __future__ import annotations

import argparse
import json
import math
import platform
import resource
import signal
import subprocess
import time
from pathlib import Path
from numbers import Real

from adapter import CHECKPOINT_SHA, SOURCE_SHA, UPSTREAM_COMMIT, digest, load_model, preprocess, unpad_point
from trial import CASES, CONFIG_SHA, LABELS, source_pins, write_json

WINDOW = 640
STRIDE = 480
BASELINE_SHA = "0be1853222df3b17428996e4f00c1cbe9cfaf62acde590b507041ea3babd7f12"
DEDUP_IOU = .85
PARENT_CONTAINMENT = .9
CONFLICT_MIN_AREA_OVERLAP = .25


def finite_number(value):
    if not isinstance(value, Real) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except (TypeError, ValueError, OverflowError):
        return False


def coordinate_ring(points):
    """Check shape/finiteness before GEOS; malformed rings are not repairable."""
    return isinstance(points, (list, tuple)) and 3 <= len(points) <= 512 and all(
        isinstance(point, (list, tuple)) and len(point) == 2 and all(finite_number(v) for v in point)
        for point in points
    )


def checked_polygon(points):
    from shapely.errors import GEOSException
    from shapely.geometry import Polygon
    from shapely.validation import explain_validity
    if not coordinate_ring(points):
        return None, "malformed or nonfinite coordinate ring"
    try:
        geom = Polygon(points)
        if not geom.is_valid or geom.is_empty or not math.isfinite(geom.area) or geom.area <= 0:
            return None, explain_validity(geom) if not geom.is_valid else "empty, degenerate or nonfinite polygon area"
        return geom, None
    except (GEOSException, TypeError, ValueError, OverflowError):
        return None, "geometry construction failed"


def starts(length, window=WINDOW, stride=STRIDE):
    if length < window or not 0 < stride <= window:
        raise ValueError("undeclared tile dimensions")
    return sorted(set(list(range(0, length - window + 1, stride)) + [length - window]))


def tiles(page_size=(5000, 3750)):
    if tuple(page_size) != (5000, 3750):
        raise ValueError("fixed source dimensions")
    output = []
    for name, roi in CASES[1:]:
        parent_box = [round(v * page_size[i % 2]) for i, v in enumerate(roi)]
        for yi, dy in enumerate(starts(parent_box[3] - parent_box[1])):
            for xi, dx in enumerate(starts(parent_box[2] - parent_box[0])):
                box = [parent_box[0] + dx, parent_box[1] + dy, parent_box[0] + dx + WINDOW, parent_box[1] + dy + WINDOW]
                output.append({"id": f"{name}-y{yi}-x{xi}", "parent_id": name, "box": box})
    if len(output) != 18:
        raise ValueError("fixed tile count")
    return output


def classify(points, box, page_size=(5000, 3750)):
    """Never repair rings; crop-edge flags express possible truncation only."""
    if not isinstance(box, (list, tuple)) or len(box) != 4 or not all(finite_number(v) for v in box) or box[2] - box[0] != WINDOW or box[3] - box[1] != WINDOW:
        raise ValueError("invalid fixed crop metadata")
    if not isinstance(page_size, (list, tuple)) or len(page_size) != 2 or not all(finite_number(v) and v > 0 for v in page_size):
        raise ValueError("invalid page dimensions")
    geom, reason = checked_polygon(points)
    if geom is None:
        return {"valid_polygon": False, "invalid_reason": reason, "outside_crop": False, "possible_crop_truncation": True, "boundary_margin_native_px": None, "export_status": "quarantined-invalid"}
    local = [(x * page_size[0] - box[0], y * page_size[1] - box[1]) for x, y in points]
    if not all(finite_number(v) for point in local for v in point):
        return {"valid_polygon": False, "invalid_reason": "nonfinite source-coordinate transform", "outside_crop": False, "possible_crop_truncation": True, "boundary_margin_native_px": None, "export_status": "quarantined-invalid"}
    margin = min(min(x, y, WINDOW - 1 - x, WINDOW - 1 - y) for x, y in local)
    outside = margin < -.5
    contact = margin <= WINDOW / 256  # one model pixel, explicitly a warning
    return {"valid_polygon": True, "invalid_reason": None, "outside_crop": outside, "possible_crop_truncation": contact, "boundary_margin_native_px": margin, "export_status": "quarantined-outside-crop" if outside else "unreviewed"}


def deduplicate(records):
    """Stable representative comparisons only; no transitive union/geometry edit."""
    from shapely.strtree import STRtree
    if not isinstance(records, (list, tuple)):
        raise ValueError("invalid proposal collection")
    ids, usable, verified = set(), [], {}
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"] or row["id"] in ids:
            raise ValueError("missing or duplicate proposal ID")
        ids.add(row["id"])
        if not isinstance(row.get("tile_id"), str) or not row["tile_id"] or type(row.get("label_id")) is not int or not isinstance(row.get("kind"), str) or row["kind"] not in {"line", "polygon"}:
            raise ValueError("invalid proposal identity metadata")
        if row["kind"] == "line":
            pts = row.get("full_page_normalized_points")
            if not isinstance(pts, (list, tuple)) or len(pts) != 2 or not all(isinstance(p, (list, tuple)) and len(p) == 2 and all(finite_number(v) for v in p) for p in pts):
                raise ValueError("malformed or nonfinite line")
            continue
        if any(type(row.get(flag)) is not bool for flag in ("valid_polygon", "outside_crop", "possible_crop_truncation")):
            raise ValueError("invalid polygon metadata flags")
        geom, reason = checked_polygon(row.get("full_page_normalized_points"))
        if not row["valid_polygon"]:
            continue  # conservatively quarantined input never reaches the index
        if geom is None:
            raise ValueError("declared valid polygon failed geometry validation: " + reason)
        margin = row.get("boundary_margin_native_px")
        if not finite_number(margin):
            raise ValueError("nonfinite polygon boundary margin")
        if row["outside_crop"] != (margin < -.5) or row["possible_crop_truncation"] != (margin <= WINDOW / 256):
            raise ValueError("inconsistent polygon crop metadata")
        if not row["outside_crop"]:
            usable.append(row)
            verified[row["id"]] = geom
    usable.sort(key=lambda r: (-r["boundary_margin_native_px"], r["id"]))
    geoms = [verified[r["id"]] for r in usable]
    tree = STRtree(geoms)
    selected, mapping, duplicate_groups = set(), {}, {}
    for i, row in enumerate(usable):
        candidates = []
        if not row["possible_crop_truncation"]:
            for j in tree.query(geoms[i]):
                j = int(j)
                other = usable[j]
                if j not in selected or row["tile_id"] == other["tile_id"] or other["possible_crop_truncation"]:
                    continue
                intersection = geoms[i].intersection(geoms[j]).area
                iou = intersection / (geoms[i].area + geoms[j].area - intersection)
                if iou >= DEDUP_IOU:
                    candidates.append((iou, other["id"], j))
        if candidates:
            iou, _, j = sorted(candidates, key=lambda v: (-v[0], v[1]))[0]
            representative = usable[j]
            mapping[row["id"]] = representative["id"]
            duplicate_groups[representative["id"]].append({"id": row["id"], "iou_to_representative": iou, "class_disagreement": row["label_id"] != representative["label_id"]})
        else:
            selected.add(i)
            mapping[row["id"]] = row["id"]
            duplicate_groups[row["id"]] = []
    representatives = [usable[i] for i in sorted(selected)]
    conflicts = []
    for i in sorted(selected):
        for j in tree.query(geoms[i]):
            j = int(j)
            if j <= i or j not in selected:
                continue
            intersection = geoms[i].intersection(geoms[j]).area
            ratio = intersection / min(geoms[i].area, geoms[j].area)
            if ratio >= CONFLICT_MIN_AREA_OVERLAP:
                conflicts.append({"ids": [usable[i]["id"], usable[j]["id"]], "overlap_of_smaller": ratio, "same_tile": usable[i]["tile_id"] == usable[j]["tile_id"], "requires_review": True})
    return {"representatives": representatives, "mapping": mapping, "duplicate_groups": duplicate_groups, "overlap_disagreements": conflicts}


def parent_relations(row, parent_records):
    child, _ = checked_polygon(row.get("full_page_normalized_points"))
    if child is None:
        return []
    relations = []
    for parent in parent_records:
        if parent["kind"] != "polygon" or not parent["valid_polygon"]:
            continue
        geom, _ = checked_polygon(parent.get("full_page_normalized_points"))
        if geom is None:
            continue
        ratio = child.intersection(geom).area / child.area
        if ratio >= PARENT_CONTAINMENT:
            relations.append({"parent_proposal_id": parent["id"], "child_overlap_fraction": ratio, "parent_label_id": parent["label_id"], "class_disagreement": parent["label_id"] != row["label_id"], "hypothesis_only": True})
    return relations


def main():
    p = argparse.ArgumentParser()
    for name in ("upstream", "model", "source", "baseline", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    a = p.parse_args()
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=a.upstream, text=True).strip() != UPSTREAM_COMMIT or subprocess.check_output(["git", "status", "--porcelain"], cwd=a.upstream, text=True).strip():
        raise ValueError("upstream identity")
    if digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA or digest(a.baseline / "report.json") != BASELINE_SHA:
        raise ValueError("source/model/baseline identity")
    baseline = json.loads((a.baseline / "report.json").read_text())
    baseline_emissions = baseline["emitted"]
    for file, sha in baseline_emissions.items():
        if digest(a.baseline / file) != sha:
            raise ValueError("baseline emission identity")
    a.output.mkdir(parents=True, exist_ok=False)
    own = Path(__file__).resolve().parent
    pins = source_pins(a.upstream, own)
    started = time.perf_counter()
    import numpy as np
    import torch
    import torchvision
    from PIL import Image, ImageDraw, ImageFont
    from shapely.geometry import box as geom_box
    from shapely.ops import unary_union
    torch.set_num_threads(4)
    torch.manual_seed(42)
    np.random.seed(42)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.cuda.set_per_process_memory_fraction(.5)
    runtime = {"python": platform.python_version(), "torch": torch.__version__, "torchvision": torchvision.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(), "numpy": np.__version__}
    declarations = tiles()
    plan = {"profile": "fixed overlapping raw256 closer looks", "cases": declarations, "window_native_px": WINDOW, "stride_native_px": STRIDE, "edge_alignment": True, "possible_truncation_margin_native_px": WINDOW / 256, "dedup_iou": DEDUP_IOU, "parent_containment_ratio": PARENT_CONTAINMENT, "conflict_min_area_overlap": CONFLICT_MIN_AREA_OVERLAP, "source_bindings": pins, "runtime": runtime, "source_sha256": SOURCE_SHA, "checkpoint_sha256": CHECKPOINT_SHA, "config_sha256": CONFIG_SHA, "upstream_commit": UPSTREAM_COMMIT, "baseline_report_sha256": BASELINE_SHA, "baseline_emissions": baseline_emissions, "source": str(a.source.resolve()), "output": str(a.output.resolve()), "page_one_based": 18, "page_index": 17, "qualitative_only": True, "approved_for_production": False, "all_space_scoring_eligible": False, "training": False, "repair": False, "limits": {"gpu_fraction": .5, "view_seconds": 90, "external_process_seconds": 600}}
    emitted = {"plan.json": write_json(a.output / "plan.json", plan)}
    for name, sha in pins.items():
        src = Path(name)
        rel = src.relative_to(a.upstream) if src.is_relative_to(a.upstream) else Path("adapter") / src.name
        dest = a.output / "sources" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        if digest(dest) != sha:
            raise ValueError("source archive drift")
    t = time.perf_counter()
    model, generate, args = load_model(a.upstream, a.model / "checkpoint.pth", json.loads((a.model / "config.json").read_text()))
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - t
    page = Image.open(a.source).convert("RGB")
    if page.size != (5000, 3750):
        raise ValueError("source dimensions")
    parents = {name: json.loads((a.baseline / (name + ".json")).read_text())["predictions"] for name, roi in CASES[1:]}
    all_records, summaries = [], []
    for tile in declarations:
        name, box = tile["id"], tile["box"]
        crop = page.crop(box)
        x, padded, transform = preprocess(crop)
        for suffix, image in (("-source.png", crop), ("-input256.png", padded)):
            file = name + suffix
            image.save(a.output / file)
            emitted[file] = digest(a.output / file)
        torch.cuda.reset_peak_memory_stats()
        raw = {}
        forward = model.forward_inference
        def capture(*inputs, **kwargs):
            result = forward(*inputs, **kwargs)
            raw.update(result)
            return result
        model.forward_inference = capture
        def timeout_handler(signum, frame):
            raise TimeoutError("view budget")
        old_signal = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(90)
        t = time.perf_counter()
        try:
            with torch.inference_mode():
                result = generate(model, x, semantic_rich=True, poly2seq=True, use_cache=True, per_token_sem_loss=True, drop_wd=False)
            torch.cuda.synchronize()
        finally:
            model.forward_inference = forward
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_signal)
        seconds = time.perf_counter() - t
        if seconds > 90:
            raise TimeoutError("view budget")
        records = []
        for idx, (poly, label) in enumerate(zip(result["room"][0], result["labels"][0])):
            points = [unpad_point(pt, transform, box, page.size) for pt in poly]
            row = {"id": f"{name}-p{idx}", "tile_id": name, "parent_region_id": tile["parent_id"], "model_proposal_id": idx, "label_id": int(label), "label": LABELS.get(int(label), "unknown"), "kind": "polygon" if len(points) >= 3 else "line", "model_pixel_points": poly.tolist(), "full_page_normalized_points": points}
            if row["kind"] == "polygon":
                row.update(classify(points, box))
                row["parent_relations"] = parent_relations(row, parents[tile["parent_id"]])
            records.append(row)
        tokens = len(raw["gen_out"][0])
        data = {**tile, "transform": transform, "seconds": seconds, "gpu_peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20, "gpu_peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20, "token_count": tokens, "reached_sequence_cap": tokens >= args.seq_len, "polygon_proposals": sum(r["kind"] == "polygon" for r in records), "strict_valid_polygons": sum(r["kind"] == "polygon" and r["valid_polygon"] for r in records), "strict_contained_polygons": sum(r["kind"] == "polygon" and r["valid_polygon"] and not r["possible_crop_truncation"] for r in records), "predictions": records, "raw_generation": [int(item) if isinstance(item, (int, np.integer)) else [float(v) for v in item] for item in raw["gen_out"][0]], "raw_semantic_logits": raw["pred_room_logits"][0].cpu().tolist(), "no_ground_truth": True}
        file = name + ".json"
        emitted[file] = write_json(a.output / file, data)
        all_records.extend(records)
        summaries.append({k: v for k, v in data.items() if k not in {"predictions", "raw_generation", "raw_semantic_logits"}})
        print(json.dumps(summaries[-1]), flush=True)
        del raw, result, x
    grouped = deduplicate(all_records)
    file = "valid-proposals.json"
    emitted[file] = write_json(a.output / file, {"raw_records": all_records, **grouped, "no_ground_truth": True, "approved_for_production": False})
    overlay = page.copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    font = ImageFont.load_default(size=15)
    for i, row in enumerate(grouped["representatives"]):
        pts = [(x * page.width, y * page.height) for x, y in row["full_page_normalized_points"]]
        rgb = (225, 80, 30) if row["possible_crop_truncation"] else ((i * 73 + 30) % 220, (i * 131 + 55) % 220, (i * 43 + 100) % 220)
        draw.polygon(pts, fill=(*rgb, 28), outline=(*rgb, 255), width=5)
        if pts:
            draw.text(pts[0], f"{i}:{row['label']}" + (" EDGE" if row["possible_crop_truncation"] else ""), font=font, fill=(0, 0, 0, 255), stroke_width=1, stroke_fill=(255, 255, 255, 255))
    file = "full-page-valid-overlay.png"
    overlay.save(a.output / file)
    emitted[file] = digest(a.output / file)
    regions = [geom_box(*[round(v * page.size[j % 2]) for j, v in enumerate(roi)]) for name, roi in CASES[1:]]
    diagnostics = {"raw_polygon_proposals": sum(r["kind"] == "polygon" for r in all_records), "strict_valid_polygon_count": sum(r["kind"] == "polygon" and r["valid_polygon"] for r in all_records), "invalid_polygon_count": sum(r["kind"] == "polygon" and not r["valid_polygon"] for r in all_records), "outside_crop_valid_count": sum(r["kind"] == "polygon" and r["valid_polygon"] and r["outside_crop"] for r in all_records), "possible_truncation_valid_count": sum(r["kind"] == "polygon" and r["valid_polygon"] and r["possible_crop_truncation"] for r in all_records), "strict_contained_before_dedup": sum(r["kind"] == "polygon" and r["valid_polygon"] and not r["possible_crop_truncation"] for r in all_records), "valid_representatives": len(grouped["representatives"]), "duplicates_removed": sum(len(v) for v in grouped["duplicate_groups"].values()), "duplicate_class_disagreements": sum(d["class_disagreement"] for v in grouped["duplicate_groups"].values() for d in v), "overlap_disagreement_pairs": len(grouped["overlap_disagreements"]), "declared_crop_union_page_area_fraction": unary_union(regions).area / (page.width * page.height), "outside_declared_regions_not_analyzed": True, "uncovered_pixels_are_not_room_misses": True, "prediction_agreement_is_not_accuracy": True}
    if source_pins(a.upstream, own) != pins or digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA or digest(a.baseline / "report.json") != BASELINE_SHA:
        raise ValueError("producer/input/model drift")
    for file, sha in baseline_emissions.items():
        if digest(a.baseline / file) != sha:
            raise ValueError("baseline drift")
    for file, sha in emitted.items():
        if digest(a.output / file) != sha:
            raise ValueError("emission drift")
    write_json(a.output / "report.json", {"status": "completed-qualitative-only", "plan_sha256": emitted["plan.json"], "cases": summaries, "diagnostics": diagnostics, "emitted": emitted, "model_load_seconds": load_seconds, "elapsed_seconds": time.perf_counter() - started, "rss_peak_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, "approved_for_production": False, "all_space_scoring_eligible": False})


if __name__ == "__main__":
    main()
