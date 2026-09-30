"""Private qualitative probe from human-authored taps; never claims room accuracy."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image

from common import SAM_COMMIT, TINY_SHA256, file_hash, harness_hashes, mask_polygons, write_json
from predict import overlay
from runtime import LocalSAM


def run(args):
    args.output.mkdir(parents=True, exist_ok=False); args.output.chmod(0o700)
    source_hash = file_hash(args.image); cases_hash = file_hash(args.cases); sources = harness_hashes()
    source = np.asarray(Image.open(args.image).convert("RGB"))
    cases = json.loads(args.cases.read_text())
    model = LocalSAM(args.checkpoint, args.device)
    rows = []
    for mode in ("sheet-one-tap", "crop-one-tap", "crop-corrections", "crop-box-corrections"):
        if mode.startswith("sheet"):
            shared_encoder_ms = model.set_image(source)
        for case in cases:
            if mode.startswith("sheet"):
                image = source; taps = case["taps"][:1]; box = None
                crop_origin = [0, 0]; encoder_ms = shared_encoder_ms
            else:
                left, top, right, bottom = case["crop"]
                image = source[top:bottom, left:right]; crop_origin = [left, top]
                taps = [[x-left, y-top, value] for x, y, value in case["taps"]]
                if mode == "crop-one-tap":
                    taps = taps[:1]
                box = case.get("box") if mode == "crop-box-corrections" else None
                if box:
                    box = [box[0]-left, box[1]-top, box[2]-left, box[3]-top]
                encoder_ms = model.set_image(image)
            result = model.predict(taps, box)
            name = f"{case['name']}-{mode}"
            overlay(Image.fromarray(image), result["mask"], taps).save(args.output / f"{name}.png")
            Image.fromarray(result["mask"].astype(np.uint8)*255).save(args.output / f"{name}-mask.png")
            polygons = mask_polygons(result["mask"])
            rows.append({"case": case["name"], "mode": mode, "taps": taps, "box": box,
                         "crop_origin": crop_origin, "image_size": [image.shape[1], image.shape[0]],
                         "mask_area_fraction": float(result["mask"].mean()),
                         "predicted_iou_score": result["score"], "score_is_measured_accuracy": False,
                         "polygon_count": len(polygons), "polygons_in_crop": polygons,
                         "encoder_ms": encoder_ms, "decoder_ms": result["decoder_ms"]})
    if source_hash != file_hash(args.image) or cases_hash != file_hash(args.cases):
        raise RuntimeError("Probe source changed")
    report = {"approved": False, "source_sha256": source_hash, "cases_sha256": cases_hash,
              "harness_source_hashes": sources, "runtime": model.runtime,
              "official_code_commit": SAM_COMMIT, "checkpoint_sha256": TINY_SHA256,
              "results": rows, "peak_gpu_mib": model.peak_gpu_mib(),
              "limitations": "Hand-authored taps/viewport/rough boxes provide spatial guidance. No quantitative real-sheet room ground truth; model score is not completeness or room accuracy."}
    if sources != harness_hashes():
        raise RuntimeError("Prompt harness source changed during qualitative probe")
    write_json(args.output / "report.json", report)
    print(json.dumps({"cases": len(cases), "modes": 4, "peak_gpu_mib": report["peak_gpu_mib"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    os.umask(0o077); run(parser.parse_args())
