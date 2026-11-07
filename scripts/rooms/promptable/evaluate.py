"""Prompted development evaluation; simulated human taps use ground truth."""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_closing, binary_dilation, label

from common import (SAM_COMMIT, TINY_SHA256, checked_records, correction_tap,
                    file_hash, harness_hashes, interior_tap, mask_iou,
                    mask_polygons, rasterize_polygons, write_json)
from predict import overlay
from runtime import LocalSAM


def fixtures(output: Path):
    cases = []
    for name, door in (("closed-room", False), ("open-door-room", True)):
        image = Image.new("RGB", (512, 512), "white"); draw = ImageDraw.Draw(image)
        draw.rectangle((80, 80, 450, 350), outline="black", width=5)
        draw.line((300, 80, 300, 350), fill="black", width=5)
        if door:
            draw.line((300, 185, 300, 240), fill="white", width=7)
            draw.line((300, 185, 350, 185), fill="black", width=2)
            draw.arc((250, 135, 350, 235), 0, 90, fill="black", width=2)
        draw.rectangle((100, 110, 135, 135), outline="#808080", width=1)
        image.save(output / f"{name}.png")
        truth = np.zeros((512, 512), bool); truth[85:346, 85:298] = True
        cases.append((name, np.asarray(image), truth))
    image = Image.new("RGB", (512, 512), "white"); draw = ImageDraw.Draw(image)
    outer = [(60, 60), (450, 60), (450, 160), (180, 160), (180, 450), (60, 450)]
    draw.polygon(outer, fill="white", outline="black", width=4)
    draw.rectangle((93, 200, 145, 320), fill="white", outline="black", width=4)
    draw.line((280, 60, 318, 60), fill="white", width=6)
    draw.line((280, 60, 280, 100), fill="black", width=2)
    truth_im = Image.new("1", (512, 512), 0); td = ImageDraw.Draw(truth_im)
    td.polygon(outer, fill=1); td.rectangle((93, 200, 145, 320), fill=0)
    truth = np.asarray(truth_im).copy()
    image.save(output / "unlabelled-l-hallway.png")
    cases.append(("unlabelled-l-hallway", np.asarray(image), truth))
    return cases


def crop_bounds(truth: np.ndarray) -> tuple[int, int, int, int]:
    y, x = np.nonzero(truth); h, w = truth.shape
    left, top, right, bottom = int(x.min()), int(y.min()), int(x.max())+1, int(y.max())+1
    pad = max(48, int(max(right-left, bottom-top) * .65))
    return max(0, left-pad), max(0, top-pad), min(w, right+pad), min(h, bottom+pad)


def rough_box(truth: np.ndarray):
    y, x = np.nonzero(truth); h, w = truth.shape
    pad = max(4, int(max(x.max()-x.min(), y.max()-y.min()) * .07))
    return [max(0, int(x.min())-pad), max(0, int(y.min())-pad),
            min(w, int(x.max())+pad+1), min(h, int(y.max())+pad+1)]


def flood_baseline(image: np.ndarray, tap: tuple[int, int]) -> np.ndarray:
    """Simple fixed dark-ink closure followed by the tapped white component."""
    barrier = image.min(axis=2) < 210
    barrier = binary_closing(barrier, structure=np.ones((9, 9), bool))
    barrier = binary_dilation(barrier, iterations=1)
    regions, _ = label(~barrier)
    x, y = tap; selected = regions[y, x]
    return regions == selected if selected else np.zeros(regions.shape, bool)


def evaluate_target(model: LocalSAM, image: np.ndarray, truth: np.ndarray,
                    mode: str, output: Path, name: str):
    if mode != "sheet-taps":
        left, top, right, bottom = crop_bounds(truth)
        image = image[top:bottom, left:right]
        truth = truth[top:bottom, left:right]
        encoder_ms = model.set_image(image)
    else:
        encoder_ms = 0.0  # Shared image encoding is charged once per sheet.
    box = rough_box(truth) if mode == "crop-box-taps" else None
    x, y = interior_tap(truth); taps = [[x, y, 1]]
    baseline = mask_iou(truth, flood_baseline(image, (x, y)))
    history = []; mask_input = None
    for click_count in range(1, 6):
        predicted = model.predict(taps, box, mask_input)
        score = mask_iou(truth, predicted["mask"])
        history.append({"clicks": click_count, "iou": score,
                        "predicted_iou_score": predicted["score"],
                        "decoder_ms": predicted["decoder_ms"]})
        if click_count == 5 or score >= .98:
            break
        correction = correction_tap(truth, predicted["mask"])
        if correction is None:
            break
        if list(correction) in taps:
            break
        taps.append(list(correction)); mask_input = predicted["logits"]
    polygons = mask_polygons(predicted["mask"])
    emitted = rasterize_polygons(polygons, truth.shape)
    if not np.array_equal(emitted, predicted["mask"]):
        raise RuntimeError("Emitted pixel-edge polygons do not round-trip the predicted mask")
    overlay(Image.fromarray(image), predicted["mask"], taps).save(output / f"{name}-{mode}.png")
    return {"mode": mode, "initial_iou": history[0]["iou"],
            "final_iou": history[-1]["iou"], "clicks": len(history),
            "final_emitted_iou": mask_iou(truth, emitted), "emitted_components": len(polygons),
            "history": history, "taps": taps, "box": box,
            "flood_initial_iou": baseline, "encoder_ms": encoder_ms}


def summarize(rows: list[dict]) -> dict:
    result = {}
    for mode in sorted({row["mode"] for row in rows}):
        subset = [row for row in rows if row["mode"] == mode]
        first = np.array([row["initial_iou"] for row in subset])
        final = np.array([row["final_iou"] for row in subset])
        emitted = np.array([row["final_emitted_iou"] for row in subset])
        decoder = [step["decoder_ms"] for row in subset for step in row["history"]]
        result[mode] = {"targets": len(subset), "mean_initial_iou": float(first.mean()),
                        "mean_final_iou": float(final.mean()),
                        "mean_final_emitted_iou": float(emitted.mean()),
                        "emitted_final_at_85": int((emitted >= .85).sum()),
                        "initial_at_85": int((first >= .85).sum()),
                        "final_at_85": int((final >= .85).sum()),
                        "final_at_75": int((final >= .75).sum()),
                        "mean_clicks": float(np.mean([row["clicks"] for row in subset])),
                        "mean_flood_initial_iou": float(np.mean([row["flood_initial_iou"] for row in subset])),
                        "decoder_median_ms": float(np.median(decoder)),
                        "decoder_p95_ms": float(np.quantile(decoder, .95))}
    return result


def select_truth_regions(labels: np.ndarray, limit: int):
    """Include extreme shape/size cases, then deterministic diversity. No model scores."""
    candidates = []
    for room_id in np.unique(labels):
        if room_id <= 0:
            continue
        ys, xs = np.nonzero(labels == room_id)
        if len(xs) < 100:
            continue
        aspect = max(xs.max()-xs.min()+1, ys.max()-ys.min()+1) / max(1, min(xs.max()-xs.min()+1, ys.max()-ys.min()+1))
        candidates.append((int(room_id), len(xs), float(aspect)))
    if not candidates:
        return []
    ordered = sorted(candidates, key=lambda item: item[1])
    choices = [ordered[0], ordered[-1], max(candidates, key=lambda item: item[2])]
    for index in np.linspace(0, len(ordered)-1, limit+2, dtype=int):
        choices.append(ordered[int(index)])
    result = []; seen = set()
    for item in choices:
        if item[0] not in seen:
            result.append(item); seen.add(item[0])
        if len(result) == limit:
            break
    return result


def run(args):
    args.output.mkdir(parents=True, exist_ok=False); args.output.chmod(0o700)
    start = time.monotonic(); sources = harness_hashes()
    model = LocalSAM(args.checkpoint, args.device)
    modes = ["sheet-taps", "crop-taps", "crop-box-taps"]
    fixture_rows = []
    for name, image, truth in fixtures(args.output):
        for mode in modes:
            model.set_image(image)
            result = evaluate_target(model, image, truth, mode, args.output, name)
            fixture_rows.append({"name": name, **result})
    rows = []; manifest_hash = None; sheet_encoders = []
    if args.manifest:
        manifest_hash = file_hash(args.manifest)
        manifest, records = checked_records(args.manifest, args.sheets)
        for record in records:
            image_path = args.manifest.parent / record["image"]
            target_path = args.manifest.parent / record["targets"]
            if file_hash(image_path) != record["image_sha256"] or file_hash(target_path) != record["targets_sha256"]:
                raise RuntimeError("Development image or targets changed")
            image = np.asarray(Image.open(image_path).convert("RGB"))
            with np.load(target_path) as data:
                labels = data["truth"].copy()
            selected = select_truth_regions(labels, args.rooms_per_sheet)
            for mode in modes:
                if mode == "sheet-taps":
                    sheet_encoders.append(model.set_image(image))
                for room_id, area, aspect in selected:
                    name = f"{record['id']}-room-{room_id}"
                    result = evaluate_target(model, image, labels == room_id, mode, args.output, name)
                    rows.append({"sheet": record["id"], "site": str(record["site"]),
                                 "room_id": room_id, "pixels": area, "bbox_aspect": aspect, **result})
            if file_hash(image_path) != record["image_sha256"] or file_hash(target_path) != record["targets_sha256"]:
                raise RuntimeError("Development inputs changed during evaluation")
        if file_hash(args.manifest) != manifest_hash:
            raise RuntimeError("Development manifest changed during evaluation")
    report = {"version": "prompted-development-only-v1", "approved": False,
              "harness_source_hashes": sources, "runtime": model.runtime,
              "checkpoint_sha256": TINY_SHA256, "official_code_commit": SAM_COMMIT,
              "development_manifest_sha256": manifest_hash,
              "geometry_export": "Exact pixel-edge row-span union, area conservation and mask round-trip checked; no shape repair or hole filling.",
              "fixture_summary": summarize(fixture_rows), "development_summary": summarize(rows),
              "fixtures": fixture_rows, "development_cases": rows,
              "sheet_encoder_median_ms": float(np.median(sheet_encoders)) if sheet_encoders else None,
              "peak_gpu_mib": model.peak_gpu_mib(), "elapsed_seconds": time.monotonic()-start,
              "protocol": "GT generates initial maximum-clearance and corrective largest-error taps only; candidate selection uses prompt compliance and the model score, never measured IoU. Up to 5 taps. Crop/box extents use GT to simulate human viewport/rough box, so this is an optimistic interaction experiment. Stops at IoU .98.",
              "limitations": "Not automatic room recall. Synthetic drawings and three handcrafted fixtures; only selected rooms scored. No real A511 ground truth. No protected holdout used."}
    if sources != harness_hashes():
        raise RuntimeError("Prompt harness source changed during evaluation")
    write_json(args.output / "report.json", report)
    print(json.dumps({"fixture_summary": report["fixture_summary"],
                      "development_summary": report["development_summary"],
                      "peak_gpu_mib": report["peak_gpu_mib"], "elapsed_seconds": report["elapsed_seconds"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sheets", type=int, default=4)
    parser.add_argument("--rooms-per-sheet", type=int, default=6)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    args = parser.parse_args()
    if args.sheets < 1 or args.rooms_per_sheet < 1 or args.rooms_per_sheet > 20:
        parser.error("Positive bounded sample counts required")
    os.umask(0o077); run(args)
