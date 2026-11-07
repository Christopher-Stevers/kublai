"""One fixed topology probe on saved wall-model outputs; no inference or approval."""
from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path

import cv2
import numpy as np
import PIL
import scipy
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import Polygon
from shapely.validation import explain_validity

from adapter import digest, model_pixel_to_page, unpad

TRIAL_SHA = "ccc0844b4bdff42ae1faf3c87e451b0a6ab241415517135e38a13a97bb4abd3d"
CONFIG = {"barrier": "room argmax wall OR icon argmax window/door",
          "closing_square_side_model_pixels": 3, "free_connectivity": 4,
          "minimum_candidate_model_pixels": 25,
          "border_components": "unresolved, not certified exterior",
          "polygonization": "OpenCV CCOMP pixel-center contours, no smoothing/repair"}


def partition(room_ids, icon_ids):
    if (room_ids.shape != icon_ids.shape or room_ids.ndim != 2 or
            not 0 < room_ids.size <= 1024**2 or
            not np.issubdtype(room_ids.dtype, np.integer) or
            not np.issubdtype(icon_ids.dtype, np.integer) or
            (room_ids < 0).any() or (room_ids > 11).any() or
            (icon_ids < 0).any() or (icon_ids > 10).any()):
        raise ValueError("Expected matching bounded model head arrays")
    barrier = (room_ids == 2) | (icon_ids == 1) | (icon_ids == 2)
    # Pad with the source edge values so closing does not delete the outer
    # image boundary. No inferred wall is added around the crop itself.
    padded = np.pad(barrier, 2, mode="edge")
    closed = ndimage.binary_closing(padded, structure=np.ones((3, 3), bool))[2:-2, 2:-2]
    labels, count = ndimage.label(~closed)  # scipy default is 4-neighbour in 2D.
    edge_ids = set(np.unique(np.r_[labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    records = []
    for label in range(1, count + 1):
        row = {"component_id": label, "model_pixels": int(sizes[label]),
               "touches_crop_edge": label in edge_ids, "approved": False}
        if label in edge_ids:
            row["status"] = "unresolved-crop-edge"
        elif sizes[label] < CONFIG["minimum_candidate_model_pixels"]:
            row["status"] = "below-declared-pixel-floor"
        else:
            contours, hierarchy = cv2.findContours((labels == label).astype(np.uint8),
                                                    cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            parents = [] if hierarchy is None else [i for i, h in enumerate(hierarchy[0]) if h[3] < 0]
            if len(parents) != 1:
                row.update(status="quarantined-contour-topology", contour_roots=len(parents))
            else:
                outer = parents[0]
                points = contours[outer][:, 0, :].tolist()
                holes = [contour[:, 0, :].tolist() for i, contour in enumerate(contours)
                         if hierarchy[0][i][3] == outer]
                row.update(points=points, holes=holes)
                if len(points) < 3 or any(len(hole) < 3 for hole in holes):
                    row["status"] = "quarantined-degenerate-contour"
                else:
                    geometry = Polygon(points, holes)
                    valid = geometry.is_valid and not geometry.is_empty and geometry.area > 0
                    row.update(status="unreviewed-proposal" if valid else "quarantined-invalid-ring",
                               validity=explain_validity(geometry))
        records.append(row)
    return records, closed, {"raw_barrier_pixels": int(barrier.sum()),
        "added_barrier_pixels": int((closed & ~barrier).sum()),
        "removed_barrier_pixels": int((barrier & ~closed).sum()),
        "component_count": count}


def run(trial, destination):
    if digest(trial / "report.json") != TRIAL_SHA:
        raise ValueError("Only the declared saved raw5 trial is allowed")
    report = json.loads((trial / "report.json").read_text())
    plan_path = trial / "plan.json"
    if digest(plan_path) != report["plan_sha256"]:
        raise ValueError("Trial plan changed")
    plan = json.loads(plan_path.read_text())
    if (plan["pdf_page_one_based"] != 18 or plan["pdf_page_index"] != 17 or
            report["status"] != "completed-qualitative-only"):
        raise ValueError("Wrong original source page or incomplete producer")
    pins = {str(trial / "report.json"): TRIAL_SHA, str(plan_path): report["plan_sha256"]}
    for name, expected in report["emitted"].items():
        path = trial / name
        if path.name != name or digest(path) != expected:
            raise ValueError("Emitted source or model output changed")
        pins[str(path)] = expected
    own = [Path(__file__).resolve(), Path(__file__).with_name("adapter.py").resolve()]
    pins.update({str(path): digest(path) for path in own})
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    (destination / "sources").mkdir()
    archived = {}
    for path in own:
        saved = destination / "sources" / path.name
        saved.write_bytes(path.read_bytes())
        archived[str(saved)] = pins[str(path)]
    runtime = {"python": platform.python_version(), "numpy": np.__version__,
               "Pillow": PIL.__version__, "opencv": cv2.__version__,
               "scipy": scipy.__version__, "shapely": shapely.__version__}
    (destination / "plan.json").write_text(json.dumps({"config": CONFIG, "input_pins": pins,
        "runtime": runtime, "source_pdf_sha256": plan["pdf_sha256"], "original_page_one_based": 18,
        "inference": False, "training": False, "accuracy_measured": False}, indent=2) + "\n")
    cases = []
    for case in report["cases"]:
        name, transform = case["id"], case["transform"]
        with np.load(trial / f"{name}-outputs.npz", allow_pickle=False) as saved:
            room_ids = unpad(saved["room_argmax"], transform)
            icon_ids = unpad(saved["icon_argmax"], transform)
        records, barrier, stats = partition(room_ids, icon_ids)
        source = Image.open(trial / f"{name}-source.png").convert("RGB")
        image = source.copy()
        draw = ImageDraw.Draw(image, "RGBA")
        for row in records:
            if row["status"] != "unreviewed-proposal":
                continue
            def to_page(points):
                return [model_pixel_to_page(x + transform["left"], y + transform["top"],
                        transform, case["pixel_box"], (5000, 3750)) for x, y in points]
            row["full_page_normalized_points"] = to_page(row["points"])
            row["full_page_normalized_holes"] = [to_page(hole) for hole in row["holes"]]
            # Outline-only plot keeps the source and all holes visible.
            color = ((row["component_id"] * 73) % 210, 20, (row["component_id"] * 37) % 210, 255)
            for ring in [row["full_page_normalized_points"], *row["full_page_normalized_holes"]]:
                pts = [(x * 5000 - case["pixel_box"][0], y * 3750 - case["pixel_box"][1]) for x, y in ring]
                draw.line([*pts, pts[0]], fill=color, width=3)
            x, y = row["points"][0]
            draw.text(((x + .5) * source.width / room_ids.shape[1],
                       (y + .5) * source.height / room_ids.shape[0]),
                      str(row["component_id"]), fill=color, stroke_width=1, stroke_fill="white")
        image.save(destination / f"{name}-proposals.png")
        Image.fromarray(barrier.astype(np.uint8) * 255).save(destination / f"{name}-barrier.png")
        counts = {status: sum(r["status"] == status for r in records) for status in sorted({r["status"] for r in records})}
        cases.append({"id": name, "pixel_box": case["pixel_box"], "stats": stats,
                      "counts": counts, "components": records})
        print(json.dumps({"id": name, "counts": counts}), flush=True)
    for filename, expected in {**pins, **archived}.items():
        if digest(filename) != expected:
            raise ValueError("Input or producer changed during partition")
    output = {"status": "completed-qualitative-only", "config": CONFIG, "input_pins": pins,
              "runtime": runtime, "archived_source_pins": archived,
              "source_pdf_sha256": plan["pdf_sha256"], "original_page_one_based": 18,
              "cases": cases, "approved_for_production": False, "accuracy_measured": False,
              "limits": ["Every crop is separate; proposals are not a stitched full-floor result.",
                         "Closing may falsely seal a gap; added pixels are recorded, not source walls.",
                         "Enclosure is not proof of a room. Furniture or exterior regions may be enclosed.",
                         "Edge components may contain real rooms; they are unresolved rather than discarded as outside.",
                         "Pixel-center polygons shrink the free pixel footprint and are not precise source-wall edges.",
                         "No polygons are human reviewed; this cannot establish room recall or completeness."]}
    (destination / "report.json").write_text(json.dumps(output, indent=2, allow_nan=False) + "\n")
    emitted = {p.name: digest(p) for p in destination.iterdir() if p.is_file()}
    (destination / "completed.json").write_text(json.dumps({"output": str(destination.resolve()), "emitted": emitted}, indent=2) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trial", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    run(args.trial, args.out)
