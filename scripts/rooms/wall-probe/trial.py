"""ONE fixed five-view raw-source wall/opening probe, no polygons or training."""
from __future__ import annotations

import argparse
import json
import platform
import resource
import signal
import time
from pathlib import Path

from adapter import (CASES, CHECKPOINT_SHA, COMMIT, SOURCE_SHA, digest,
                     load_model, preprocess, split_heads, unpad)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    receipt = json.loads((args.cache / "source-receipt.json").read_text())
    if receipt["commit"] != COMMIT or digest(args.source) != SOURCE_SHA:
        raise ValueError("Source revision/image identity")
    bindings = {}
    for relative, expected in receipt["sourceFiles"].items():
        path = (args.cache / "source" / relative).resolve()
        if not path.is_relative_to((args.cache / "source").resolve()) or digest(path) != expected:
            raise ValueError("Source receipt mismatch")
        bindings[str(path)] = expected
    own = Path(__file__).resolve().parent
    for path in [*own.glob("*.py"), args.cache / "source-receipt.json", args.cache / "checkpoint-receipt.json"]:
        bindings[str(path.resolve())] = digest(path)
    checkpoint = args.cache / "model_best_val_loss_var.pkl"
    if digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("Checkpoint identity")
    args.output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    import numpy as np
    from PIL import Image
    import torch
    torch.set_num_threads(4)
    torch.manual_seed(42)
    np.random.seed(42)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.cuda.set_per_process_memory_fraction(.5)
    plan = {
        "upstream_commit": COMMIT, "checkpoint_sha256": CHECKPOINT_SHA,
        "source_sha256": SOURCE_SHA,
        "pdf_sha256": "17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f",
        "pdf_page_one_based": 18, "pdf_page_index": 17, "cases": CASES,
        "source_bindings": bindings,
        "runtime": {"python": platform.python_version(), "torch": torch.__version__,
                    "numpy": np.__version__, "cuda": torch.version.cuda,
                    "gpu": torch.cuda.get_device_name()},
        "limits": {"gpu_fraction": .5, "view_seconds": 90, "external_timeout_seconds": 600,
                   "longest_image_side": 1024, "batch_size": 1, "views": 5},
        "preprocessing_departure": "Bound to 1024 longest side with bilinear resize, square pad to next multiple256 with normalized zero. Author evaluates native raster size; no rotation ensemble here.",
        "heads": {"0:21": "sigmoid heatmap activations (not logits)", "21:33": "room logits; wall index2", "33:44": "icon logits; window index1, door index2"},
        "overlay": "Room-head argmax==wall and icon-head argmax==window/door. Display priority door,window,wall; no morphology or confidence tuning.",
        "colors": {"wall": [255, 35, 35], "door": [245, 145, 15], "window": [0, 135, 255]},
        "qualitative_only": True, "approved_for_production": False, "training": False,
    }
    write_json(args.output / "plan.json", plan)
    # Preserve every executed source and reviewed upstream evidence before loading.
    for filename in bindings:
        path = Path(filename)
        relative = path.relative_to(args.cache.resolve()) if path.is_relative_to(args.cache.resolve()) else Path("adapter") / path.name
        archived = args.output / "sources" / relative
        archived.parent.mkdir(parents=True, exist_ok=True)
        archived.write_bytes(path.read_bytes())
        if digest(archived) != bindings[filename]:
            raise ValueError("Source archive mismatch")
    model, load_metadata = load_model(args.cache / "source/floortrans/models/hg_furukawa_original.py", checkpoint)
    model = model.to("cuda")
    page = Image.open(args.source).convert("RGB")
    emitted, cases = {}, []
    for name, roi in CASES:
        box = tuple(round(value * page.size[index % 2]) for index, value in enumerate(roi))
        crop = page.crop(box)
        tensor, padded, transform = preprocess(crop)
        crop.save(args.output / f"{name}-source.png")
        padded.save(args.output / f"{name}-input.png")
        torch.cuda.reset_peak_memory_stats()
        def timeout_handler(_signum, _frame):
            raise TimeoutError("CubiCasa view exceeded 90 seconds")
        previous = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(90)
        begin = time.perf_counter()
        try:
            with torch.inference_mode():
                output = model(tensor.to("cuda"))
                heatmaps, rooms, icons = split_heads(output)
                if output.shape[-2:] != tensor.shape[-2:]:
                    raise ValueError("Unexpected model canvas geometry")
                room_probability, icon_probability = rooms.softmax(0), icons.softmax(0)
                values = {
                    "wall_logits": rooms[2].cpu().numpy(),
                    "window_logits": icons[1].cpu().numpy(),
                    "door_logits": icons[2].cpu().numpy(),
                    "wall_probability": room_probability[2].cpu().numpy(),
                    "window_probability": icon_probability[1].cpu().numpy(),
                    "door_probability": icon_probability[2].cpu().numpy(),
                    "opening_heatmap_activations": heatmaps[13:17].cpu().numpy(),
                    "room_argmax": rooms.argmax(0).to(torch.uint8).cpu().numpy(),
                    "icon_argmax": icons.argmax(0).to(torch.uint8).cpu().numpy(),
                }
            torch.cuda.synchronize()
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)
        seconds = time.perf_counter() - begin
        np.savez_compressed(args.output / f"{name}-outputs.npz", **values)
        room_ids, icon_ids = unpad(values["room_argmax"], transform), unpad(values["icon_argmax"], transform)
        label = np.zeros_like(room_ids)
        label[room_ids == 2], label[icon_ids == 1], label[icon_ids == 2] = 1, 2, 3
        labels = np.array(Image.fromarray(label).resize(crop.size, Image.Resampling.NEAREST))
        palette = np.array([[0, 0, 0], [255, 35, 35], [0, 135, 255], [245, 145, 15]])
        alpha = (labels > 0)[..., None] * .6
        overlay = (np.array(crop) * (1 - alpha) + palette[labels] * alpha).astype(np.uint8)
        Image.fromarray(overlay).save(args.output / f"{name}-overlay.png")
        for head in ("wall", "window", "door"):
            probability = unpad(values[f"{head}_probability"], transform)
            Image.fromarray(np.rint(probability * 255).astype(np.uint8)).save(args.output / f"{name}-{head}-probability.png")
        case = {"id": name, "roi": roi, "pixel_box": box, "transform": transform,
                "seconds": seconds, "gpu_peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20,
                "gpu_peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20,
                "argmax_pixels": {"wall": int((room_ids == 2).sum()), "window": int((icon_ids == 1).sum()), "door": int((icon_ids == 2).sum())},
                "counts_are_not_accuracy": True}
        write_json(args.output / f"{name}.json", case)
        cases.append(case)
        for path in args.output.glob(f"{name}*"):
            emitted[path.name] = digest(path)
        print(json.dumps({"id": name, "seconds": seconds, "gpu_mib": case["gpu_peak_allocated_mib"]}), flush=True)
        del output, heatmaps, rooms, icons, room_probability, icon_probability, values, tensor
    if any(digest(Path(path)) != expected for path, expected in bindings.items()):
        raise ValueError("Sources changed during inference")
    if digest(args.source) != SOURCE_SHA or digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("Inputs changed during inference")
    if any(digest(args.output / name) != expected for name, expected in emitted.items()):
        raise ValueError("Outputs changed during inference")
    write_json(args.output / "report.json", {
        "status": "completed-qualitative-only", "plan_sha256": digest(args.output / "plan.json"),
        "checkpoint_load": load_metadata, "cases": cases, "emitted": emitted,
        "elapsed_seconds": time.perf_counter() - started,
        "rss_peak_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
        "approved_for_production": False, "all_space_scoring_eligible": False,
    })


if __name__ == "__main__":
    main()
