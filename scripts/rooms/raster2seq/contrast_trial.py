"""One predeclared contrast/context ablation, with raw proposals quarantined.

Not training, an accuracy benchmark, or a production preprocessing change.
"""
from __future__ import annotations

import argparse
import json
import platform
import resource
import signal
import subprocess
import time
from pathlib import Path

from adapter import CHECKPOINT_SHA, SOURCE_SHA, UPSTREAM_COMMIT, digest, load_model, preprocess, unpad_point
from trial import CASES, CONFIG_SHA, LABELS, source_pins, write_json

LOCAL_CASES = [
    ("west-local", [.148, .155, .244, .335]),
    ("north-local", [.47, .14, .635, .285]),
]
DECLARED_CASES = [(name + "-gamma3", box, "gamma3") for name, box in CASES] + [
    (name + "-" + mode, box, mode) for name, box in LOCAL_CASES for mode in ("raw", "gamma3")
]
GAMMA3_LUT = [round(255 * (v / 255) ** 3) for v in range(256)]


def transform_input(image, mode):
    if mode == "raw":
        return image.convert("RGB")
    if mode != "gamma3":
        raise ValueError("undeclared transform")
    # PIL 8-bit RGB->L luminance, followed by the explicitly recorded lookup.
    # Chromatic information is lost, and colored clouds/furniture also darken.
    return image.convert("L").point(GAMMA3_LUT).convert("RGB")


def main():
    p = argparse.ArgumentParser()
    for name in ("upstream", "model", "source", "baseline", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    a = p.parse_args()
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=a.upstream, text=True).strip() != UPSTREAM_COMMIT or subprocess.check_output(["git", "status", "--porcelain"], cwd=a.upstream, text=True).strip():
        raise ValueError("upstream identity")
    if digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA:
        raise ValueError("input/model identity")
    baseline_sha = "0be1853222df3b17428996e4f00c1cbe9cfaf62acde590b507041ea3babd7f12"
    if digest(a.baseline / "report.json") != baseline_sha:
        raise ValueError("baseline report identity")
    baseline = json.loads((a.baseline / "report.json").read_text())
    for file, sha in baseline["emitted"].items():
        if digest(a.baseline / file) != sha:
            raise ValueError("baseline emission changed")
    a.output.mkdir(parents=True, exist_ok=False)
    own = Path(__file__).resolve().parent
    pins = source_pins(a.upstream, own)
    started = time.perf_counter()
    import numpy as np
    import torch
    import torchvision
    from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version
    from shapely import __version__ as shapely_version
    from shapely.geometry import Polygon
    from shapely.validation import explain_validity

    torch.set_num_threads(4)
    torch.manual_seed(42)
    np.random.seed(42)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.cuda.set_per_process_memory_fraction(.5)
    runtime = {"python": platform.python_version(), "torch": torch.__version__, "torchvision": torchvision.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(), "numpy": np.__version__, "pillow": pillow_version, "shapely": shapely_version}
    plan = {"hypothesis": "gray wall visibility and crop scale at fixed256 model input", "cases": DECLARED_CASES, "gamma": {"exponent": 3, "lookup": GAMMA3_LUT, "order": "crop, PIL RGB->L, lookup, RGB, official bicubic resize+white pad", "loses_chromatic_information": True}, "runtime": runtime, "source_bindings": pins, "upstream_commit": UPSTREAM_COMMIT, "checkpoint_sha256": CHECKPOINT_SHA, "config_sha256": CONFIG_SHA, "source_sha256": SOURCE_SHA, "baseline_report_sha256": baseline_sha, "pdf_sha256": "17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f", "page_one_based": 18, "page_index": 17, "source": str(a.source.resolve()), "output": str(a.output.resolve()), "qualitative_only": True, "approved_for_production": False, "all_space_scoring_eligible": False, "training": False, "msda_backend": "upstream PyTorch grid_sample reference", "limits": {"gpu_fraction": .5, "view_seconds": 90, "external_process_seconds": 600}}
    emissions = {"plan.json": write_json(a.output / "plan.json", plan)}
    for name, sha in pins.items():
        src = Path(name)
        rel = src.relative_to(a.upstream) if src.is_relative_to(a.upstream) else Path("adapter") / src.name
        dest = a.output / "sources" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        if digest(dest) != sha:
            raise ValueError("source archive drift")
    load_start = time.perf_counter()
    model, generate, args = load_model(a.upstream, a.model / "checkpoint.pth", json.loads((a.model / "config.json").read_text()))
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - load_start
    page = Image.open(a.source).convert("RGB")
    summaries = []
    for name, roi, mode in DECLARED_CASES:
        box = tuple(round(v * page.size[i % 2]) for i, v in enumerate(roi))
        source = page.crop(box)
        transformed = transform_input(source, mode)
        x, padded, transform = preprocess(transformed)
        for suffix, im in (("-source.png", source), ("-transformed.png", transformed), ("-input256.png", padded)):
            file = name + suffix
            im.save(a.output / file)
            emissions[file] = digest(a.output / file)
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
        overlay = source.copy()
        draw = ImageDraw.Draw(overlay, "RGBA")
        font = ImageFont.load_default(size=max(12, source.width // 65))
        records = []
        for idx, (poly, label) in enumerate(zip(result["room"][0], result["labels"][0])):
            points = [unpad_point(pt, transform, box, page.size) for pt in poly]
            local = [(pt[0] * page.width - box[0], pt[1] * page.height - box[1]) for pt in points]
            geom = Polygon(points) if len(points) >= 3 else None
            valid = geom is None or (geom.is_valid and not geom.is_empty)
            label_name = LABELS.get(int(label), "unknown")
            records.append({"id": idx, "label_id": int(label), "label": label_name, "model_pixel_points": poly.tolist(), "full_page_normalized_points": points, "kind": "line" if len(poly) == 2 else "polygon", "valid_polygon": valid, "invalid_reason": explain_validity(geom) if geom is not None and not valid else None, "export_status": "quarantined-invalid" if not valid else "unreviewed", "outside_crop": any(px < -.5 or py < -.5 or px > source.width - .5 or py > source.height - .5 for px, py in local)})
            rgb = ((idx * 73 + 30) % 220, (idx * 131 + 55) % 220, (idx * 43 + 100) % 220)
            if len(local) >= 3:
                draw.polygon(local, fill=(*rgb, 40), outline=(*rgb, 255), width=max(2, source.width // 350))
            elif len(local) == 2:
                draw.line(local, fill=(255, 0, 0, 255), width=max(3, source.width // 250))
            if local:
                draw.text(local[0], f"{idx} {label_name}" + (" INVALID" if not valid else ""), fill=(0, 0, 0, 255), stroke_width=1, stroke_fill=(255, 255, 255, 255), font=font)
        file = name + "-overlay.png"
        overlay.save(a.output / file)
        emissions[file] = digest(a.output / file)
        token_count = len(raw["gen_out"][0])
        data = {"id": name, "roi": roi, "pixel_box": box, "input_transform": mode, "resize": transform, "seconds": seconds, "gpu_peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20, "gpu_peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20, "token_count": token_count, "reached_sequence_cap": token_count >= args.seq_len, "region_count": sum(r["kind"] == "polygon" for r in records), "line_count": sum(r["kind"] == "line" for r in records), "invalid_polygon_count": sum(not r["valid_polygon"] for r in records), "predictions": records, "raw_generation": [int(item) if isinstance(item, (int, np.integer)) else [float(v) for v in item] for item in raw["gen_out"][0]], "raw_semantic_logits": raw["pred_room_logits"][0].cpu().tolist(), "no_ground_truth": True}
        file = name + ".json"
        emissions[file] = write_json(a.output / file, data)
        summaries.append({k: v for k, v in data.items() if k not in {"predictions", "raw_generation", "raw_semantic_logits"}})
        print(json.dumps(summaries[-1]), flush=True)
        del raw, result, x
    if source_pins(a.upstream, own) != pins or digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA or digest(a.baseline / "report.json") != baseline_sha:
        raise ValueError("source/input/checkpoint/baseline drift")
    for file, sha in emissions.items():
        if digest(a.output / file) != sha:
            raise ValueError("emitted output drift")
    write_json(a.output / "report.json", {"status": "completed-qualitative-only", "plan_sha256": emissions["plan.json"], "cases": summaries, "model_load_seconds": load_seconds, "elapsed_seconds": time.perf_counter() - started, "rss_peak_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, "emitted": emissions, "ignored_checkpoint_runtime_cache_keys": model.adapter_ignored_checkpoint_keys, "approved_for_production": False, "all_space_scoring_eligible": False})


if __name__ == "__main__":
    main()
