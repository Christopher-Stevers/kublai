"""Private, reproducible room overlay and probability diagnostics."""
from __future__ import annotations

import argparse
import colorsys
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from common import HEADS, file_hash, private_dir, write_json


def run(args):
    source_hash = file_hash(args.image)
    prediction_path = args.prediction / "prediction.json"
    prediction_hash = file_hash(prediction_path)
    result = json.loads(prediction_path.read_text())
    if result["input_sha256"] != source_hash:
        raise ValueError("Overlay source image differs from the predicted input")
    image = Image.open(args.image).convert("RGB")
    if image.size != (result["width"], result["height"]):
        raise ValueError("Prediction/source dimensions differ")
    labels = np.fromfile(args.prediction / "labels.i32", dtype="<i4").reshape(image.height, image.width)
    if set(np.unique(labels)) - {0} != {r["label"] for r in result["rooms"]}:
        raise ValueError("Mask and exported room IDs differ")
    private_dir(args.output)
    colors = np.zeros((int(labels.max()) + 1, 3), dtype=np.float32)
    for ident in range(1, len(colors)):
        colors[ident] = np.array(colorsys.hsv_to_rgb((ident * 0.61803398875) % 1, 0.8, 0.95)) * 255
    pixels = np.asarray(image).astype(np.float32)
    positive = labels > 0
    pixels[positive] = pixels[positive] * 0.65 + colors[labels[positive]] * 0.35
    canvas = Image.fromarray(pixels.astype(np.uint8))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=max(12, image.width // 180))
    for room in result["rooms"]:
        for ring in [room["shape"]["points"], *room["shape"].get("holes", [])]:
            points = [(p["x"] * image.width, p["y"] * image.height) for p in ring]
            draw.line(points + [points[0]], fill="blue", width=max(1, image.width // 1600))
    for ident, region in enumerate(ndimage.find_objects(labels), 1):
        if region is None:
            continue
        distance = ndimage.distance_transform_edt(labels[region] == ident)
        y, x = np.unravel_index(np.argmax(distance), distance.shape)
        draw.text((int(x + region[1].start), int(y + region[0].start)), str(ident),
                  fill="black", stroke_fill="white", stroke_width=2, font=font)
    canvas.save(args.output / "overlay-native.png")
    canvas.thumbnail((args.preview, round(args.preview * image.height / image.width)))
    canvas.save(args.output / "overlay-preview.png")
    with np.load(args.prediction / "probabilities.npz") as arrays:
        for name, probability in zip(HEADS, arrays["probability"]):
            heatmap = Image.fromarray(np.uint8(np.clip(probability, 0, 1) * 255), mode="L")
            heatmap.thumbnail((args.preview, round(args.preview * image.height / image.width)))
            heatmap.save(args.output / f"{name}-probability.png")
        if "overview_interior" in arrays:
            overview = arrays["overview_interior"]
            for name, probability in (("overview", overview), ("local", 2 * arrays["probability"][0] - overview)):
                heatmap = Image.fromarray(np.uint8(np.clip(probability, 0, 1) * 255), mode="L")
                heatmap.thumbnail((args.preview, round(args.preview * image.height / image.width)))
                heatmap.save(args.output / f"{name}-interior-probability.png")
    if file_hash(args.image) != source_hash or file_hash(prediction_path) != prediction_hash:
        raise RuntimeError("Input/prediction changed during visualization")
    write_json(args.output / "overlay.json", {"input_sha256": source_hash, "prediction_sha256": prediction_hash,
               "rooms": len(result["rooms"]), "rooms_with_holes": sum(bool(r["shape"].get("holes")) for r in result["rooms"]),
               "approved_for_production": False})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True); parser.add_argument("--prediction", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True); parser.add_argument("--preview", type=int, default=1800)
    args = parser.parse_args()
    if args.preview < 100:
        parser.error("Preview must have at least 100 pixels")
    os.umask(0o077); run(args)
