"""Fixed official Raster2Graph-512 checkpoint profile; raw input only.

Weights/training domain/classes also change from CubiCasa256: not a pure
resolution ablation. No retraining, morphology, geometry repair or GT access.
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

from adapter import SOURCE_SHA, UPSTREAM_COMMIT, checkpoint_state, digest, import_upstream, resize_metadata, unpad_point
from contrast_trial import LOCAL_CASES
from trial import CASES, source_pins, write_json

CHECKPOINT_SHA = "5736bf4fe1ebd8ef6cca63ea51c2c3f8971d6d1848dd9049fc5ca251bf565229"
CONFIG_SHA = "bb257547f4c154d52d5bb58756148ada0859381bb026756baed46927e89e0e8f"
VIEWS = CASES + LOCAL_CASES
LABELS = {0: "unknown", 1: "living_room", 2: "kitchen", 3: "bedroom", 4: "bathroom", 5: "restroom", 6: "balcony", 7: "closet", 8: "corridor", 9: "washing_room", 10: "PS", 11: "outside"}


def safe_checkpoint512(path):
    import torch
    if digest(path) != CHECKPOINT_SHA:
        raise ValueError("unverified512checkpoint")
    if set(torch.serialization.get_unsafe_globals_in_checkpoint(path)) - {"argparse.Namespace"}:
        raise ValueError("undeclared512globals")
    with torch.serialization.safe_globals([argparse.Namespace]):
        result = torch.load(path, map_location="cpu", weights_only=True)
    if digest(path) != CHECKPOINT_SHA:
        raise ValueError("512checkpoint changed during safe load")
    return result


def load_model512(upstream, checkpoint, config):
    architecture, tokenizer_class, decode, parser = import_upstream(upstream)
    args = parser.parse_args([])
    if config["checkpoint_key"] != "raster2graph-512":
        raise ValueError("checkpoint configuration identity")
    for key, value in config["inference_args"].items():
        if not hasattr(args, key):
            raise ValueError("unexpected512config")
        setattr(args, key, value)
    if args.image_size != 512 or args.semantic_classes != 13 or args.dataset_name != "r2g":
        raise ValueError("undeclared512architecture")
    if args.disable_poly_refine:
        args.with_poly_refine = False
    tokenizer = tokenizer_class(args.num_bins, args.seq_len, add_cls=args.add_cls_token)
    args.vocab_size = len(tokenizer)
    model = architecture.build(args, train=False, tokenizer=tokenizer)
    ckpt = safe_checkpoint512(checkpoint)
    state, ignored = checkpoint_state(ckpt["ema"])
    model.load_state_dict(state, strict=True)
    model.adapter_ignored_checkpoint_keys = ignored
    if digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("512checkpoint drift")
    del state, ckpt
    model.eval().requires_grad_(False).to("cuda")
    return model, decode["generate"], args


def preprocess512(image):
    import numpy as np
    import torch
    from PIL import Image
    meta = resize_metadata(*image.size, size=512)
    resized = image.convert("RGB").resize((meta["new_width"], meta["new_height"]), Image.Resampling.BICUBIC)
    padded = Image.new("RGB", (512, 512), "white")
    padded.paste(resized, (meta["left"], meta["top"]))
    x = torch.as_tensor(np.asarray(padded).copy().transpose(2, 0, 1)).float() / 255
    return x.unsqueeze(0).to("cuda"), padded, meta


def main():
    p = argparse.ArgumentParser()
    for name in ("upstream", "model", "source", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    a = p.parse_args()
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=a.upstream, text=True).strip() != UPSTREAM_COMMIT or subprocess.check_output(["git", "status", "--porcelain"], cwd=a.upstream, text=True).strip():
        raise ValueError("upstream identity")
    if digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA:
        raise ValueError("source512weight identity")
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
    plan = {"profile": "official Raster2Graph512 EMA raw", "resolution_domain_weights_classes_change": True, "input_transform": "raw RGB, official bicubic resize+white center padding", "cases": VIEWS, "checkpoint_sha256": CHECKPOINT_SHA, "config_sha256": CONFIG_SHA, "checkpoint_revision": "c9a9c439ba66594dab701b77b7df52a5f75a5fce", "source_sha256": SOURCE_SHA, "upstream_commit": UPSTREAM_COMMIT, "source_bindings": pins, "runtime": runtime, "pdf_sha256": "17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f", "page_one_based": 18, "page_index": 17, "source": str(a.source.resolve()), "output": str(a.output.resolve()), "training": False, "qualitative_only": True, "approved_for_production": False, "all_space_scoring_eligible": False, "msda_backend": "upstream PyTorch grid_sample reference", "limits": {"gpu_fraction": .5, "view_seconds": 90, "external_process_seconds": 600}}
    emitted = {"plan.json": write_json(a.output / "plan.json", plan)}
    for name, sha in pins.items():
        src = Path(name)
        rel = src.relative_to(a.upstream) if src.is_relative_to(a.upstream) else Path("adapter") / src.name
        out = a.output / "sources" / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(src.read_bytes())
        if digest(out) != sha:
            raise ValueError("source archive drift")
    t = time.perf_counter()
    model, generate, args = load_model512(a.upstream, a.model / "checkpoint.pth", json.loads((a.model / "config.json").read_text()))
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - t
    page = Image.open(a.source).convert("RGB")
    summaries = []
    for name, roi in VIEWS:
        box = tuple(round(v * page.size[i % 2]) for i, v in enumerate(roi))
        source = page.crop(box)
        x, padded, transform = preprocess512(source)
        for suffix, im in (("-source.png", source), ("-input512.png", padded)):
            file = name + suffix
            im.save(a.output / file)
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
        overlay = source.copy()
        draw = ImageDraw.Draw(overlay, "RGBA")
        font = ImageFont.load_default(size=max(12, source.width // 65))
        records = []
        for idx, (poly, label) in enumerate(zip(result["room"][0], result["labels"][0])):
            pts = [unpad_point(pt, transform, box, page.size) for pt in poly]
            local = [(pt[0] * page.width - box[0], pt[1] * page.height - box[1]) for pt in pts]
            shape = Polygon(pts) if len(pts) >= 3 else None
            valid = shape is None or (shape.is_valid and not shape.is_empty)
            text = LABELS.get(int(label), "unmapped")
            records.append({"id": idx, "label_id": int(label), "label": text, "model_pixel_points": poly.tolist(), "full_page_normalized_points": pts, "kind": "line" if len(poly) == 2 else "polygon", "valid_polygon": valid, "invalid_reason": explain_validity(shape) if shape is not None and not valid else None, "export_status": "quarantined-invalid" if not valid else "unreviewed", "outside_crop": any(px < -.5 or py < -.5 or px > source.width - .5 or py > source.height - .5 for px, py in local)})
            rgb = ((idx * 73 + 30) % 220, (idx * 131 + 55) % 220, (idx * 43 + 100) % 220)
            if len(local) >= 3:
                draw.polygon(local, fill=(*rgb, 40), outline=(*rgb, 255), width=max(2, source.width // 350))
            elif len(local) == 2:
                draw.line(local, fill=(255, 0, 0, 255), width=max(3, source.width // 250))
            if local:
                draw.text(local[0], f"{idx} {text}" + (" INVALID" if not valid else ""), fill=(0, 0, 0, 255), stroke_width=1, stroke_fill=(255, 255, 255, 255), font=font)
        file = name + "-overlay.png"
        overlay.save(a.output / file)
        emitted[file] = digest(a.output / file)
        token_count = len(raw["gen_out"][0])
        data = {"id": name, "roi": roi, "pixel_box": box, "transform": transform, "seconds": seconds, "gpu_peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20, "gpu_peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20, "token_count": token_count, "reached_sequence_cap": token_count >= args.seq_len, "region_count": sum(r["kind"] == "polygon" for r in records), "strict_valid_polygon_count": sum(r["kind"] == "polygon" and r["valid_polygon"] for r in records), "line_count": sum(r["kind"] == "line" for r in records), "invalid_polygon_count": sum(not r["valid_polygon"] for r in records), "predictions": records, "raw_generation": [int(item) if isinstance(item, (int, np.integer)) else [float(v) for v in item] for item in raw["gen_out"][0]], "raw_semantic_logits": raw["pred_room_logits"][0].cpu().tolist(), "no_ground_truth": True}
        file = name + ".json"
        emitted[file] = write_json(a.output / file, data)
        summaries.append({k: v for k, v in data.items() if k not in {"predictions", "raw_generation", "raw_semantic_logits"}})
        print(json.dumps(summaries[-1]), flush=True)
        del raw, result, x
    if source_pins(a.upstream, own) != pins or digest(a.source) != SOURCE_SHA or digest(a.model / "checkpoint.pth") != CHECKPOINT_SHA or digest(a.model / "config.json") != CONFIG_SHA:
        raise ValueError("source/input/model drift")
    for file, sha in emitted.items():
        if digest(a.output / file) != sha:
            raise ValueError("output drift")
    write_json(a.output / "report.json", {"status": "completed-qualitative-only", "plan_sha256": emitted["plan.json"], "cases": summaries, "elapsed_seconds": time.perf_counter() - started, "model_load_seconds": load_seconds, "rss_peak_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, "emitted": emitted, "ignored_checkpoint_runtime_cache_keys": model.adapter_ignored_checkpoint_keys, "approved_for_production": False, "all_space_scoring_eligible": False})


if __name__ == "__main__":
    main()
