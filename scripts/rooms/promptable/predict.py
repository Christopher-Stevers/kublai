"""Offline tap-to-outline experiment. Output is always an unapproved candidate."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from common import SAM_COMMIT, TINY_SHA256, file_hash, harness_hashes, mask_polygons, write_json
from runtime import LocalSAM


def overlay(image, mask, taps):
    rgb = np.asarray(image).copy()
    rgb[mask] = (rgb[mask].astype(float) * .55 + np.array([10, 180, 240]) * .45).astype(np.uint8)
    result = Image.fromarray(rgb); draw = ImageDraw.Draw(result)
    radius = max(5, int(max(image.size) / 180))
    for x, y, value in taps:
        color = "#00b040" if value else "#ff2020"
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=color, outline="black", width=2)
    result.thumbnail((1800, 1800))
    return result


def run(args):
    args.output.mkdir(parents=True, exist_ok=False); args.output.chmod(0o700)
    source_hash = file_hash(args.image); sources = harness_hashes()
    image = Image.open(args.image).convert("RGB")
    taps = json.loads(args.taps)
    box = json.loads(args.box) if args.box else None
    origin = [0, 0]
    if args.crop:
        crop = json.loads(args.crop)
        if (len(crop) != 4 or any(type(v) is not int for v in crop) or
                not (0 <= crop[0] < crop[2] <= image.width and 0 <= crop[1] < crop[3] <= image.height)):
            raise ValueError("Crop must contain four integer pixel bounds inside the source")
        origin = crop[:2]; image = image.crop(crop)
        taps = [[x-origin[0], y-origin[1], label] for x, y, label in taps]
        if box is not None:
            box = [box[0]-origin[0], box[1]-origin[1], box[2]-origin[0], box[3]-origin[1]]
    model = LocalSAM(args.checkpoint, args.device, args.gpu_fraction)
    encoder_ms = model.set_image(np.asarray(image))
    prediction = model.predict(taps, box)
    if file_hash(args.image) != source_hash:
        raise RuntimeError("Source changed during prediction")
    Image.fromarray(prediction["mask"].astype(np.uint8) * 255).save(args.output / "mask.png")
    overlay(image, prediction["mask"], taps).save(args.output / "overlay.png")
    result = {"version": "sam2.1-tiny-promptable-unapproved-v1", "approved": False,
              "harness_source_hashes": sources, "runtime": model.runtime,
              "source_sha256": source_hash, "checkpoint_sha256": TINY_SHA256,
              "official_code_commit": SAM_COMMIT, "image_size": list(image.size),
              "crop_origin": origin, "taps_in_crop": taps, "box_in_crop": box,
              "predicted_iou_score": prediction["score"],
              "score_is_room_accuracy": False,
              "mask_area_pixels": int(prediction["mask"].sum()),
              "polygons_in_crop": mask_polygons(prediction["mask"]),
              "encoder_ms": encoder_ms, "decoder_ms": prediction["decoder_ms"],
              "peak_gpu_mib": model.peak_gpu_mib(),
              "limitations": "A prompt-conditioned draft, not automatic all-room detection or approval."}
    if sources != harness_hashes():
        raise RuntimeError("Prompt harness source changed during prediction")
    write_json(args.output / "prediction.json", result)
    print(json.dumps({k: result[k] for k in ("mask_area_pixels", "predicted_iou_score", "encoder_ms", "decoder_ms", "peak_gpu_mib")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--taps", required=True, help='JSON pixel taps [[x,y,1],[x,y,0]]')
    parser.add_argument("--box", help="Optional JSON pixel box [left,top,right,bottom]")
    parser.add_argument("--crop", help="Optional integer pixel crop; taps/box stay in source coordinates")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--gpu-fraction", type=float, default=.2)
    os.umask(0o077); run(parser.parse_args())
