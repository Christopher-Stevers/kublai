"""Fixed qualitative development-only pilot. No app, database or GT access."""
from __future__ import annotations

import argparse
import json
import os
import platform
import resource
import signal
import subprocess
import time
from pathlib import Path

from adapter import CHECKPOINT_SHA, SOURCE_SHA, UPSTREAM_COMMIT, digest, load_model, preprocess, unpad_point

CASES = [
    ("full-sheet", [0, 0, 1, 1]),
    ("west-upper", [.105, .12, .315, .40]),
    ("west-lower", [.105, .42, .315, .70]),
    ("north-common", [.33, .10, .65, .34]),
    ("east-upper", [.665, .12, .875, .40]),
]
LABELS = {0: "Outdoor", 1: "Kitchen", 2: "Living Room", 3: "Bed Room", 4: "Bath", 5: "Entry", 6: "Storage", 7: "Garage", 8: "Undefined", 9: "Window", 10: "Door"}
CONFIG_SHA = "6367f59326b4c8acdb046b0f08be15b1d62dd20d8fe364ad0061d7a3783ccefc"


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    return digest(path)


def source_pins(root, own):
    paths = list(root.rglob("*.py")) + [root / "LICENSE", root / "tools/predict_cc5k.sh"] + list(own.glob("*.py"))
    return {str(p): digest(p) for p in paths if "__pycache__" not in p.parts}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--upstream", type=Path, required=True)
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=a.upstream, text=True).strip() != UPSTREAM_COMMIT:
        raise ValueError("upstream identity")
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=a.upstream, text=True).strip():
        raise ValueError("modified upstream")
    if digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA:
        raise ValueError("input/checkpoint/config identity")
    a.output.mkdir(parents=True, exist_ok=False)
    own = Path(__file__).resolve().parent
    pins = source_pins(a.upstream, own)
    started = time.perf_counter()
    from PIL import Image, ImageDraw
    import numpy as np
    import torch
    import torchvision
    from shapely.geometry import Polygon

    torch.set_num_threads(4)
    torch.manual_seed(42)
    np.random.seed(42)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.cuda.set_per_process_memory_fraction(.5)
    runtime = {"python": platform.python_version(), "torch": torch.__version__, "torchvision": torchvision.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(), "capability": torch.cuda.get_device_capability(), "numpy": np.__version__}
    plan = {"upstream_commit": UPSTREAM_COMMIT, "checkpoint_sha256": CHECKPOINT_SHA, "checkpoint_revision": "c9a9c439ba66594dab701b77b7df52a5f75a5fce", "source_sha256": SOURCE_SHA, "pdf_sha256": "17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f", "pdf_page_one_based": 18, "pdf_page_index": 17, "source": str(a.source.resolve()), "output": str(a.output.resolve()), "source_bindings": pins, "config_sha256": CONFIG_SHA, "runtime": runtime, "cases": CASES, "qualitative_only": True, "approved_for_production": False, "all_space_scoring_eligible": False, "msda_backend": "upstream PyTorch grid_sample reference", "training": False, "limits": {"gpu_fraction": .5, "view_seconds": 90, "external_process_seconds": 600}}
    write_json(a.output / "plan.json", plan)
    # Preserve exact executed upstream sources and adapter before model loading.
    for n, sha in pins.items():
        src = Path(n)
        rel = src.relative_to(a.upstream) if src.is_relative_to(a.upstream) else Path("adapter") / src.name
        out = a.output / "sources" / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(src.read_bytes())
        if digest(out) != sha:
            raise ValueError("source archive")
    config = json.loads((a.model / "config.json").read_text())
    load_start = time.perf_counter()
    model, generate, args = load_model(a.upstream, a.model / "checkpoint.pth", config)
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - load_start
    page = Image.open(a.source).convert("RGB")
    cases = []
    emitted = {"plan.json": digest(a.output / "plan.json")}
    for name, roi in CASES:
        box = tuple(round(v * page.size[i % 2]) for i, v in enumerate(roi))
        crop = page.crop(box)
        crop.save(a.output / (name + "-source.png"))
        x, padded, transform = preprocess(crop)
        padded.save(a.output / (name + "-input256.png"))
        torch.cuda.reset_peak_memory_stats()
        t = time.perf_counter()
        # Capture raw unfiltered generated coordinates as well as official output.
        raw = {}
        forward = model.forward_inference

        def capture(*inputs, **kwargs):
            result = forward(*inputs, **kwargs)
            raw.update(result)
            return result

        model.forward_inference = capture
        def timeout_handler(signum, frame):
            raise TimeoutError("view runtime budget")
        old_signal = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(90)
        try:
            with torch.inference_mode():
                result = generate(model, x, semantic_rich=True, poly2seq=True, use_cache=True, per_token_sem_loss=True, drop_wd=False)
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_signal)
        model.forward_inference = forward
        torch.cuda.synchronize()
        seconds = time.perf_counter() - t
        if seconds > 90:
            raise RuntimeError("view runtime budget")
        records = []
        overlay = crop.copy()
        draw = ImageDraw.Draw(overlay, "RGBA")
        for idx, (poly, label) in enumerate(zip(result["room"][0], result["labels"][0])):
            full = [unpad_point(pt, transform, box, page.size) for pt in poly]
            local = [(pt[0] * page.width - box[0], pt[1] * page.height - box[1]) for pt in full]
            shape = Polygon(local) if len(local) >= 3 else None
            valid = shape is None or (shape.is_valid and not shape.is_empty)
            records.append({"id": idx, "label_id": int(label), "label": LABELS.get(int(label), "unknown"), "model_pixel_points": poly.tolist(), "full_page_normalized_points": full, "kind": "line" if len(poly) == 2 else "polygon", "valid_polygon": valid, "outside_crop": any(px < -.5 or py < -.5 or px > crop.width - .5 or py > crop.height - .5 for px, py in local), "status": "unreviewed"})
            rgb = ((idx * 73 + 30) % 220, (idx * 131 + 55) % 220, (idx * 43 + 100) % 220)
            if len(local) >= 3:
                draw.polygon(local, fill=(*rgb, 45), outline=(*rgb, 255), width=max(2, crop.width // 350))
            elif len(local) == 2:
                draw.line(local, fill=(255, 0, 0, 255), width=max(3, crop.width // 250))
            if local:
                draw.text(local[0], str(idx), fill=(10, 10, 10, 255))
        overlay.save(a.output / (name + "-overlay.png"))
        token_count = len(raw["gen_out"][0])
        raw_generation = [int(item) if isinstance(item, (int, np.integer)) else [float(v) for v in item] for item in raw["gen_out"][0]]
        case = {"id": name, "roi": roi, "pixel_box": box, "transform": transform, "seconds": seconds, "gpu_peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20, "gpu_peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20, "token_count": token_count, "reached_sequence_cap": token_count >= args.seq_len, "predictions": records, "raw_generation": raw_generation, "raw_semantic_logits": raw["pred_room_logits"][0].cpu().tolist(), "region_count": sum(r["kind"] == "polygon" for r in records), "line_count": sum(r["kind"] == "line" for r in records), "invalid_polygon_count": sum(not r["valid_polygon"] for r in records), "source_input_sha256": digest(a.output / (name + "-input256.png")), "no_ground_truth": True}
        write_json(a.output / (name + ".json"), case)
        cases.append({k: v for k, v in case.items() if k not in ("predictions", "raw_generation", "raw_semantic_logits")})
        for suffix in ("-source.png", "-input256.png", "-overlay.png", ".json"):
            filename = name + suffix
            emitted[filename] = digest(a.output / filename)
        print(json.dumps({"id": name, "seconds": seconds, "regions": case["region_count"], "lines": case["line_count"], "tokens": token_count}), flush=True)
        del raw, result, x
    if source_pins(a.upstream, own) != pins or digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA:
        raise ValueError("source/data changed during trial")
    for filename, sha in emitted.items():
        if digest(a.output / filename) != sha:
            raise ValueError("output changed during trial")
    report = {"status": "completed-qualitative-only", "plan_sha256": emitted["plan.json"], "cases": cases, "model_load_seconds": load_seconds, "elapsed_seconds": time.perf_counter() - started, "rss_peak_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, "ignored_checkpoint_runtime_cache_keys": model.adapter_ignored_checkpoint_keys, "emitted": emitted, "approved_for_production": False, "all_space_scoring_eligible": False}
    write_json(a.output / "report.json", report)


if __name__ == "__main__":
    main()
