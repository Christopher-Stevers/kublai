"""One qualitative actual-sheet probe of the development-ranked partition."""
from __future__ import annotations

import argparse
import colorsys
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from evaluate import aggregate, checked_probabilities, completeness_metrics, digest, pinned_json, rank, read_binding, sources, verify, versions, write
from partition import FIXED, PRESETS, VERSION, partition_rooms

ALLOWED_PARTITION_REPORT = "707cbd22107cedea09bfc018da2f64b0cb30f9b485125271f95d3aa4a56a9e03"


def verify_development_report(report, binding, binding_hash):
    if (report["binding_sha256"] != binding_hash or report["binding_path"] != binding["binding_path"]
            or report["presets"] != PRESETS or report["fixed"] != FIXED
            or report["source_hashes"] != binding["source_hashes"] or report["input_hashes"] != binding["input_hashes"]
            or report["runtime"] != versions() or report["version"] != VERSION):
        raise ValueError("Use the exact completed three-setting development comparison and runtime")
    expected = {row["id"] for row in binding["cases"]}
    if set(report["results"]) != set(PRESETS) | {"historical_normal_barrier_04"}:
        raise ValueError("Declared development method coverage differs")
    for preset in PRESETS:
        group = report["results"][preset]
        rows = group["cases"]
        if len(rows) != 20 or {row["id"] for row in rows} != expected:
            raise ValueError("Each method must cover all unique original development IDs")
        if group["summary"] != aggregate(rows) or group["completeness"] != completeness_metrics(rows):
            raise ValueError("Development summary disagrees with complete case metrics")
    if report["results"]["historical_normal_barrier_04"] != binding["baseline"]:
        raise ValueError("Historical baseline changed")


def verify_support_sources(expected):
    if sources() != expected:
        raise RuntimeError("Support adapter source changed during actual probing")


def probe(args):
    support_sources = sources()
    binding, binding_hash = read_binding(args.binding, historical_support=True)
    report_hash = ALLOWED_PARTITION_REPORT
    report = pinned_json(args.development_report, report_hash)
    verify_development_report(report, binding, binding_hash)
    preset = rank(report)
    actual = binding["actual"]
    path = Path(actual["probabilities"])
    probability = checked_probabilities(path, binding["input_hashes"][str(path)])
    if probability.shape != (3, actual["height"], actual["width"]):
        raise ValueError("Actual image/cache dimensions differ")
    labels, rooms, diagnostics = partition_rooms(probability, preset)
    verify(binding, historical_support=True)
    if digest(args.development_report) != report_hash:
        raise RuntimeError("Development ranking changed during actual probe")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    labels.astype("<i4").tofile(args.output / "labels.i32")
    with Image.open(actual["image"]) as source:
        image = source.convert("RGB")
    if image.size != (actual["width"], actual["height"]):
        raise ValueError("Actual source dimensions differ")
    colors = np.zeros((len(rooms) + 1, 3), dtype=np.float32)
    for ident in range(1, len(colors)):
        colors[ident] = np.array(colorsys.hsv_to_rgb((ident * 0.61803398875) % 1, 0.8, 0.95)) * 255
    pixels = np.asarray(image).astype(np.float32)
    positive = labels > 0
    pixels[positive] = pixels[positive] * 0.65 + colors[labels[positive]] * 0.35
    canvas = Image.fromarray(pixels.astype(np.uint8))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=max(12, image.width // 180))
    for room in rooms:
        for ring in [room["shape"]["points"], *room["shape"].get("holes", [])]:
            points = [(p["x"] * image.width, p["y"] * image.height) for p in ring]
            draw.line(points + [points[0]], fill="blue", width=max(1, image.width // 1600))
    for ident, region in enumerate(ndimage.find_objects(labels), 1):
        distance = ndimage.distance_transform_edt(labels[region] == ident)
        y, x = np.unravel_index(np.argmax(distance), distance.shape)
        draw.text((int(x + region[1].start), int(y + region[0].start)), str(ident),
                  fill="black", stroke_fill="white", stroke_width=2, font=font)
    canvas.save(args.output / "overlay-native.png")
    canvas.thumbnail((1800, round(1800 * image.height / image.width)))
    canvas.save(args.output / "overlay-preview.png")
    areas = np.bincount(labels.ravel())[1:]
    result = {"version": VERSION, "preset": preset, "binding_sha256": binding_hash,
              "development_report_sha256": report_hash, "input_sha256": binding["input_hashes"][actual["image"]],
              "probabilities_sha256": binding["input_hashes"][actual["probabilities"]],
              "checkpoint_sha256": binding["checkpoint_sha256"], "source_hashes": binding["source_hashes"],
              "support_adapter_source_hashes": support_sources,
              "width": image.width, "height": image.height, "rooms": rooms, "diagnostics": diagnostics,
              "rooms_with_holes": sum(bool(r["shape"].get("holes")) for r in rooms),
              "largest_component_pixels": int(areas.max()) if len(areas) else 0,
              "largest_component_page_fraction": float(areas.max() / labels.size) if len(areas) else 0,
              "runtime": versions(), "approved_for_production": False,
              "limitations": "Qualitative actual-sheet falsification only; no full reference exists, so counts are not precision/recall."}
    verify(binding, historical_support=True)
    verify_support_sources(support_sources)
    if digest(args.binding) != binding_hash or digest(args.development_report) != report_hash:
        raise RuntimeError("Probe metadata changed")
    write(args.output / "prediction.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binding", "development-report", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    result = probe(args)
    print(json.dumps({"preset": result["preset"], "rooms": len(result["rooms"]),
                      "largest_component_page_fraction": result["largest_component_page_fraction"]}))
