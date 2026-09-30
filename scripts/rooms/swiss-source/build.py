"""Independent private renderer of Swiss Dwellings walls and genuine openings.

This is new importer/rendering code. No Archilyse/AGPL pipeline code is imported.
Source area polygons are semantic references, not certified physical-room labels.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from decimal import Decimal, InvalidOperation
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import random

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely import wkt
from shapely.geometry import Polygon, MultiPolygon

HEADS = ("interior", "boundary", "opening_closure")
VERSION = "structural-room-challenger-v1"
EXPERIMENT = "whole-sheet-context-v2"
CONTRACT = "swiss-true-openings-development-v1"
OVERVIEW = 512
INDOOR = {"ROOM", "BEDROOM", "LIVING_ROOM", "LIVING_DINING", "DINING", "KITCHEN",
          "BATHROOM", "CORRIDOR", "STAIRCASE", "ELEVATOR", "STOREROOM", "BASEMENT_COMPARTMENT",
          "OFFICE", "WASH_AND_DRY_ROOM", "LAUNDRY", "WC", "HALL", "LOBBY", "COMMON_ROOM",
          "ARCHIVE", "BASEMENT", "BIKE_STORAGE", "BREAK_ROOM", "CANTEEN", "CLOAKROOM", "COLD_STORAGE",
          "COMMON_KITCHEN", "COMMUNITY_ROOM", "CORRIDORS_AND_HALLS", "COUNTER_ROOM", "DEDICATED_MEDICAL_ROOM",
          "ELECTRICAL_SUPPLY", "ELEVATOR_FACILITIES", "FACTORY_ROOM", "FOYER", "GARAGE", "HEATING",
          "HOUSE_TECHNICS_FACILITIES", "KITCHEN_DINING", "LOGISTICS", "MEDICAL_ROOM", "MEETING_ROOM",
          "OFFICE_SPACE", "OFFICE_TECH_ROOM", "OPEN_PLAN_OFFICE", "OPERATIONS_FACILITIES",
          "PHYSIO_AND_REHABILITATION", "PRAM", "PRAM_AND_BIKE_STORAGE_ROOM", "RADATION_THERAPY",
          "RECEPTION_ROOM", "SALESROOM", "SANITARY_ROOMS", "SHELTER", "SHOWROOM", "SPORTS_ROOMS",
          "STUDIO", "TEACHING_ROOM", "TECHNICAL_AREA", "WAITING_ROOM", "WAREHOUSE", "WATER_SUPPLY",
          "WINTERGARTEN", "WORKSHOP"}
NONROOM = {"AIR", "SHAFT", "VOID", "OUTDOOR_VOID", "BALCONY", "TERRACE", "LOGGIA", "OUTDOOR", "GARDEN", "LIGHTWELL", "PATIO", "TRANSPORT_SHAFT"}
DOORS = {"DOOR", "ENTRANCE_DOOR"}
PHYSICAL_SEPARATORS = {"WALL", "COLUMN"}
REQUIRED = {"site_id", "building_id", "floor_id", "plan_id", "entity_type", "entity_subtype", "unit_usage", "geometry"}
# Independently pinned at the source-experiment boundary. Matching counts alone
# cannot prove the exact exposed context/generalization identities were supplied.
PINNED_PRIOR_SHA256 = (
    "0a87fe76626ceb927efbe65e63067591fc48e3e780583cb25cf4f8e5816e1d82",  # geometric 240/89
    "ce022ade7db2a97e5c31658c40926eef98b6c2e08e44520a5e6fe60fbdafe30d",  # pilot-v2 100
    "79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac",  # context 100
    "f8cb98efb4c35bfc87d27f4c616f82a7b69cc03fa646d960f043f7d490f0d593",  # once-only 20
)
LIMITATIONS = ("Original physical wall/opening/fixture coordinates with simulated drawing style, door swings and annotations; "
               "source drawing images unavailable. Source areas are functional references. Components cut by physical barriers are "
               "provisional room instances, not certified physical-room completeness; open living/dining/kitchen areas can merge. "
               "Unknown/undefined indoor semantics are unsupervised. No production approval or real-sheet accuracy claim.")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1048576), b""):
            h.update(b)
    return h.hexdigest()


def write_json(path, value):
    with path.open("x") as f:
        json.dump(value, f, indent=2, allow_nan=False)
    path.chmod(0o600)


def sources():
    return {p.name: digest(p) for p in sorted(Path(__file__).parent.glob("*.py")) if not p.name.startswith("test_")}


def verify(frozen):
    if any(digest(p) != h for p, h in frozen.items()):
        raise RuntimeError("Pinned source/exclusion inputs changed; discard this build")


def canonical_id(value):
    """Numeric metadata aliases such as 012 / 12.0 identify the same source ID."""
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        raise ValueError("Missing grouping identity")
    try:
        n = Decimal(text)
        if n.is_finite() and n == n.to_integral_value():
            return str(int(n))
    except InvalidOperation:
        pass
    return text


def prior_exclusions(paths, *, require_complete=True):
    """Metadata-only: never open any old image, target, annotation or checkpoint."""
    excluded, summary = set(), []
    if len(paths) != 4:
        raise ValueError("All four prior-site manifests are required")
    input_hashes = tuple(digest(p) for p in paths)
    if require_complete:
        if len(set(input_hashes)) != 4:
            raise ValueError("Duplicate prior manifest role/hash inputs are forbidden")
        if input_hashes != PINNED_PRIOR_SHA256:
            raise ValueError("Prior manifest metadata hashes differ from the independently pinned four role contracts")
    for index, p in enumerate(paths):
        data = json.loads(p.read_text())
        rows = data if isinstance(data, list) else data.get("records")
        if not isinstance(rows, list) or not rows or any(not r.get("site") for r in rows):
            raise ValueError("Prior manifest lacks explicit site metadata")
        sites = {canonical_id(r["site"]) for r in rows}
        if require_complete:
            if index == 0 and (len(rows) != 240 or len(sites) != 89):
                raise ValueError("Frozen geometric manifest must contain 240 records / 89 sites")
            if index in (1, 2) and (len(rows) != 100 or any(r.get("split") not in {"train", "validation"} for r in rows)):
                raise ValueError("Complete prior pilot/context development manifests are required")
            if index == 3 and (len(rows) != 20 or len(sites) != 20 or any(r.get("split") != "generalization" for r in rows)):
                raise ValueError("Complete once-only 20-site generalization manifest is required")
        excluded |= sites
        if isinstance(data, dict):
            excluded |= {canonical_id(s) for s in data.get("excluded_msd_sites", [])}
        if digest(p) != input_hashes[index]:
            raise RuntimeError("Prior metadata changed during exclusion preflight")
        summary.append({"path": str(p.resolve()), "sha256": input_hashes[index], "records": len(rows), "sites": sorted(sites)})
    return excluded, summary


class Union:
    def __init__(self):
        self.parent = {}

    def find(self, a):
        self.parent.setdefault(a, a)
        if self.parent[a] != a:
            self.parent[a] = self.find(self.parent[a])
        return self.parent[a]

    def join(self, a, b):
        aa, bb = self.find(a), self.find(b)
        if aa != bb:
            lo, hi = sorted([aa, bb]); self.parent[hi] = lo


def identities(row):
    site, building, floor, plan = (canonical_id(row[k]) for k in ("site_id", "building_id", "floor_id", "plan_id"))
    return (site, building, floor, plan), (f"site:{site}", f"building:{building}", f"floor:{floor}", f"plan:{plan}")


def metadata_preflight(csv_path, excluded):
    """Scan grouping/semantics across the entire CSV before any WKT decode.

    Geometry is passed over by the CSV parser but is neither parsed nor inspected.
    Global building/plan/floor aliases connect sites conservatively; a connected
    alias of any protected site is also excluded before selected geometry replay.
    """
    union, floors, types, usages = Union(), {}, Counter(), Counter()
    total = 0
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        if not REQUIRED <= set(reader.fieldnames or []):
            raise ValueError("Unexpected Swiss geometry CSV schema")
        for row in reader:
            key, aliases = identities(row)
            for a in aliases[1:]:
                union.join(aliases[0], a)
            meta = floors.setdefault(key, {"key": key, "aliases": aliases, "counts": Counter(), "usage": Counter(), "rows": 0})
            pair = (row["entity_type"].lower(), row["entity_subtype"].upper())
            meta["counts"][pair] += 1; types[pair] += 1
            meta["usage"][row["unit_usage"].upper()] += 1; usages[row["unit_usage"].upper()] += 1
            meta["rows"] += 1; total += 1
    protected_roots = {union.find(f"site:{s}") for s in excluded}
    component_aliases = {}
    for alias in list(union.parent):
        component_aliases.setdefault(union.find(alias), []).append(alias)
    excluded_aliases = {a for root in protected_roots for a in component_aliases.get(root, [])}
    for meta in floors.values():
        root = union.find(meta["aliases"][0])
        all_aliases = sorted(component_aliases[root])
        meta["group"] = "swiss-alias-component:" + hashlib.sha256("\n".join(all_aliases).encode()).hexdigest()[:24]
        meta["protected"] = root in protected_roots
        meta["component_aliases"] = all_aliases
    summary = {"rows": total, "floor_metadata_records": len(floors), "site_count": sum(a.startswith("site:") for a in union.parent),
               "alias_components": len(component_aliases), "protected_floor_metadata_records": sum(m["protected"] for m in floors.values()),
               "excluded_source_aliases": sorted(excluded_aliases), "entity_counts": {f"{a}:{b}": n for (a, b), n in sorted(types.items())},
               "unit_usage_counts": dict(sorted(usages.items())), "geometry_decoded_at_preflight": False}
    return floors, summary


def split_for(group, seed):
    return "validation" if int(hashlib.sha256(f"{seed}:{group}".encode()).hexdigest()[:8], 16) % 5 == 0 else "train"


def select_floors(floors, counts, seed):
    groups = {}
    for key, m in floors.items():
        c = m["counts"]
        indoor = sum(n for (t, st), n in c.items() if t == "area" and st in INDOOR)
        if m["protected"] or indoor < 3 or c[("separator", "WALL")] < 3 or sum(c[("opening", d)] for d in DOORS) < 1:
            continue
        groups.setdefault(m["group"], []).append(m)
    selected, actual = [], {"train": 0, "validation": 0}
    for group in sorted(groups, key=lambda g: hashlib.sha256(f"select:{seed}:{g}".encode()).hexdigest()):
        split = split_for(group, seed)
        if actual[split] >= counts[split]:
            continue
        # Prefer a floor with public/common-space metadata, using no geometry.
        candidates = sorted(groups[group], key=lambda m: (-m["usage"].get("PUBLIC", 0), hashlib.sha256(str(m["key"]).encode()).hexdigest()))
        m = candidates[0]
        selected.append({**m, "split": split}); actual[split] += 1
    if actual != counts:
        raise ValueError(f"Insufficient metadata-eligible disjoint floorplans: requested={counts}, available={actual}")
    validate_selection(selected)
    return selected


def validate_selection(selected):
    aliases, groups, sites = {}, {}, {}
    for m in selected:
        if m["protected"]:
            raise ValueError("Protected alias selected before geometry decode")
        split = m["split"]
        for a in m["component_aliases"]:
            if aliases.setdefault(a, split) != split:
                raise ValueError("Repeated source alias crosses splits")
        if groups.setdefault(m["group"], split) != split or sites.setdefault(m["key"][0], split) != split:
            raise ValueError("One source site/component crosses splits")


def decode_selected(csv_path, selected, excluded, decoder=wkt.loads):
    """Default-deny replay: identity/protected checks precede the WKT decoder."""
    validate_selection(selected)
    metas = {m["key"]: m for m in selected}
    decoded = {key: [] for key in metas}
    hashes = {key: hashlib.sha256() for key in metas}
    with csv_path.open(newline="") as f:
        for row in csv.DictReader(f):
            key, aliases = identities(row)
            if key[0] in excluded or key not in metas:
                continue
            m = metas[key]
            if m["protected"] or not set(aliases) <= set(m["component_aliases"]):
                raise ValueError("Protected or changed alias encountered before WKT decode")
            hashes[key].update(json.dumps(row, sort_keys=True, separators=(",", ":")).encode())
            geom = decoder(row["geometry"])
            if geom.is_empty or not geom.is_valid or geom.geom_type not in {"Polygon", "MultiPolygon"}:
                raise ValueError("Selected source geometry must be a valid nonempty polygon; no silent repair")
            decoded[key].append({"geometry": geom, "entity_type": row["entity_type"].lower(),
                                 "entity_subtype": row["entity_subtype"].upper(), "unit_usage": row["unit_usage"].upper(),
                                 "area_id": row.get("area_id", ""), "unit_id": row.get("unit_id", ""),
                                 "apartment_id": row.get("apartment_id", "")})
    for m in selected:
        if len(decoded[m["key"]]) != m["rows"]:
            raise ValueError("Metadata/decode row counts differ; source identity changed")
    return decoded, {key: h.hexdigest() for key, h in hashes.items()}


def pieces(geom):
    return list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]


def polygon_mask(geom, width, height, coordinate):
    image = Image.new("L", (width, height), 0); draw = ImageDraw.Draw(image)
    for poly in pieces(geom):
        draw.polygon([coordinate(x, y) for x, y in poly.exterior.coords], fill=1)
        for ring in poly.interiors:
            draw.polygon([coordinate(x, y) for x, y in ring.coords], fill=0)
    return np.asarray(image, dtype=np.uint8).astype(bool)


def coarse_targets(target, known):
    h, w = target.shape[1:]; kernel = (max(1, math.ceil(h / OVERVIEW)), max(1, math.ceil(w / OVERVIEW)))
    coarse, supervision = np.zeros((3, OVERVIEW, OVERVIEW), dtype=np.uint8), np.zeros((3, OVERVIEW, OVERVIEW), dtype=np.uint8)
    for head in range(3):
        supervision[head] = cv2.resize((known[head] == 0).astype(np.float32), (OVERVIEW, OVERVIEW), interpolation=cv2.INTER_AREA) == 0
        if head == 0:
            coarse[head] = cv2.resize(target[head].astype(np.float32), (OVERVIEW, OVERVIEW), interpolation=cv2.INTER_AREA) >= 0.5
        else:
            widened = ndimage.maximum_filter(target[head], size=kernel, mode="nearest")
            coarse[head] = cv2.resize(widened, (OVERVIEW, OVERVIEW), interpolation=cv2.INTER_NEAREST)
    return coarse, supervision


def draw_polygon_outline(draw, geom, coordinate, fill, width=1):
    for p in pieces(geom):
        for ring in [p.exterior, *p.interiors]:
            draw.line([coordinate(x, y) for x, y in ring.coords], fill=fill, width=width)


def door_swing(draw, geom, coordinate, color, rng):
    """Simulated leaf/swing orientation anchored to a genuine source opening."""
    p = geom.minimum_rotated_rectangle
    coords = list(p.exterior.coords)[:4]
    a, b = max(zip(coords, coords[1:] + coords[:1]), key=lambda ab: math.dist(*ab))
    ax, ay = coordinate(*a); bx, by = coordinate(*b)
    dx, dy = bx - ax, by - ay; side = rng.choice([-1, 1])
    draw.line([(ax, ay), (ax - side * dy, ay + side * dx)], fill=color, width=1)
    arc = [(ax + dx * math.cos(t) - side * dy * math.sin(t), ay + dy * math.cos(t) + side * dx * math.sin(t))
           for t in np.linspace(0, math.pi / 2, 18)]
    draw.line(arc, fill=color, width=1)


def render(rows, seed, width=2048, height=1536):
    rng = random.Random(seed)
    bounds = np.asarray([r["geometry"].bounds for r in rows]); minx, miny = bounds[:, :2].min(axis=0); maxx, maxy = bounds[:, 2:].max(axis=0)
    if maxx <= minx or maxy <= miny:
        raise ValueError("Degenerate selected floor bounds")
    left, top, usablew, usableh = round(width * .055), round(height * .07), round(width * .77), round(height * .83)
    scale = min(usablew / (maxx - minx), usableh / (maxy - miny))
    coordinate = lambda x, y: ((x - minx) * scale + left, (maxy - y) * scale + top)
    indoor, unknown, outdoor, solid, doors, windows = [np.zeros((height, width), dtype=bool) for _ in range(6)]
    masks, refs = [], []
    for r in rows:
        mask = polygon_mask(r["geometry"], width, height, coordinate); masks.append(mask)
        t, st = r["entity_type"], r["entity_subtype"]
        if t == "area":
            if st in INDOOR:
                indoor |= mask
            elif st in NONROOM:
                outdoor |= mask
            else:
                unknown |= mask
            refs.append({"area_id": r["area_id"], "unit_id": r["unit_id"], "apartment_id": r.get("apartment_id", ""),
                         "subtype": st, "unit_usage": r["unit_usage"], "physical_area_m2": float(r["geometry"].area),
                         "supervision": "interior" if st in INDOOR else "nonroom" if st in NONROOM else "unknown",
                         "holes": sum(len(p.interiors) for p in pieces(r["geometry"]))})
        elif t == "separator" and st in PHYSICAL_SEPARATORS:
            solid |= mask
        elif t == "opening" and st in DOORS:
            doors |= mask
        elif t == "opening" and st == "WINDOW":
            windows |= mask
    # Source openings can overlay full wall polygons. Erase the exact source
    # opening footprint from visible solid ink; door closure stays in targets.
    physical = solid | doors | windows
    interior = indoor & ~physical & ~unknown & ~outdoor
    target = np.stack([interior, physical, doors]).astype(np.uint8)
    known = np.ones_like(target); known[:, unknown] = 0
    truth, num = ndimage.label(interior, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
    truth = truth.astype(np.int32)
    for ref, mask in zip(refs, (mask for r, mask in zip(rows, masks) if r["entity_type"] == "area")):
        labels, pixels = np.unique(truth[mask], return_counts=True)
        occupied = sum(int(n) for ident, n in zip(labels, pixels) if ident > 0)
        ref["derived_instance_memberships"] = [{"instance_id": int(ident), "overlap_pixels": int(n),
                                               "fraction_of_area_derived_interior": float(n / occupied)}
                                              for ident, n in zip(labels, pixels) if ident > 0]
        ref["derived_interior_pixels"] = occupied
        # A mixed open living/kitchen component keeps every contributing source
        # area membership, instead of acquiring an invented single room class.
    image = Image.new("RGB", (width, height), "white")
    # Genuine wall thickness/footprints remain geometric; only ink shade varies.
    shade = rng.choice([0, 35, 75]); ink = (shade,) * 3
    image.paste(ink, mask=Image.fromarray((solid & ~doors & ~windows).astype(np.uint8) * 255))
    draw = ImageDraw.Draw(image)
    for r, mask in zip(rows, masks):
        t, st = r["entity_type"], r["entity_subtype"]
        if t == "feature" or (t == "separator" and st == "RAILING"):
            draw_polygon_outline(draw, r["geometry"], coordinate, (80, 80, 80), 1)
        elif t == "opening" and st == "WINDOW":
            draw_polygon_outline(draw, r["geometry"], coordinate, ink, 1)
        elif t == "opening" and st in DOORS:
            door_swing(draw, r["geometry"], coordinate, ink, rng)
        elif t == "area" and st in INDOOR and rng.random() < .5:
            p = r["geometry"].representative_point(); x, y = coordinate(p.x, p.y)
            draw.text((x, y), st.replace("_", " "), fill=(65, 65, 65))
    # Simulated sheet text/grid/title-block enclosures are explicit negatives.
    margin = round(width * .02); tx = round(width * .875)
    draw.rectangle((margin, margin, width - margin, height - margin), outline=(90, 90, 90), width=1)
    draw.line((tx, margin, tx, height - margin), fill=(50, 50, 50), width=1)
    for y in np.linspace(margin, height - margin, 12).astype(int):
        draw.line((tx, y, width - margin, y), fill=(75, 75, 75), width=1)
        draw.text((tx + 8, y + 8), "PLAN REV 1200", fill=(50, 50, 50))
    for x in np.linspace(left, tx - 30, 9).astype(int):
        draw.ellipse((x - 7, margin + 15, x + 7, margin + 29), outline=(110, 110, 110), width=1)
    counts = Counter(r["entity_type"] + ":" + r["entity_subtype"] for r in rows)
    stats = {"entity_counts": dict(sorted(counts.items())), "source_area_references": refs,
             "provisional_components": int(num), "physical_room_ground_truth_certified": False,
             "truth_reference_kind": "algorithm-derived-components-of-source-interiors-cut-by-physical-barriers",
             "all_space_scoring_eligible": False, "human_completeness_evidence": False,
             "generated_geometry_pixel_development_eligible": True,
             "source_semantics_partial": any(r["supervision"] == "unknown" for r in refs),
             "unknown_pixels": int(unknown.sum()), "outdoor_nonroom_pixels": int(outdoor.sum()),
             "target_positive_pixels": {h: int(target[i].sum()) for i, h in enumerate(HEADS)},
             "real_door_coordinates": True, "simulated_door_swing_orientation": True,
             "physical_barrier_sources": ["separator:WALL", "separator:COLUMN", "opening:WINDOW", "opening:DOOR", "opening:ENTRANCE_DOOR"],
             "functional_area_outlines_used_as_barriers": False,
             "pixels_per_source_meter": float(scale), "source_bounds": [float(minx), float(miny), float(maxx), float(maxy)]}
    return image, target, known, truth, stats


def source_preflight(csv_path, provenance):
    data = json.loads(provenance.read_text()); m = data.get("member", {})
    if (data.get("record_id") != 7788422 or data.get("dataset_version") != "3.0.0" or data.get("license") != "CC BY 4.0"
            or m.get("name") != "swiss-dwellings-v3.0.0/geometries.csv" or m.get("crc32_hex") != "1be5b7b9"
            or m.get("uncompressed_size") != 1093732415 or m.get("compressed_size") != 291005391 or m.get("crc32_verified") is not True):
        raise ValueError("Unverified or unpinned Swiss geometry source")
    if csv_path.stat().st_size != m["uncompressed_size"] or digest(csv_path) != m.get("csv_sha256"):
        raise ValueError("Geometry CSV changed after member verification")
    return data


def build(args):
    inputs = [args.csv, args.provenance, *args.prior_manifest]
    frozen, render_sources = {p: digest(p) for p in inputs}, sources()
    provenance = source_preflight(args.csv, args.provenance)
    excluded, prior = prior_exclusions(args.prior_manifest)
    floors, metadata = metadata_preflight(args.csv, excluded)
    verify(frozen)
    requested = {"train": args.train, "validation": args.development}
    selected = select_floors(floors, requested, args.seed)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    selection = [{"site": m["key"][0], "building": m["key"][1], "floor": m["key"][2], "plan": m["key"][3],
                  "group": m["group"], "split": m["split"], "component_aliases": m["component_aliases"], "rows": m["rows"]} for m in selected]
    write_json(args.output / "metadata-preflight.json", {"contract": CONTRACT, "source_sha256": frozen[args.csv],
               "prior_manifests": prior, "excluded_msd_sites": sorted(excluded), "metadata": metadata, "selection": selection,
               "geometry_decoded": False, "selected_protected_alias_count": 0, "requested_counts": requested})
    decoded, row_hashes = decode_selected(args.csv, selected, excluded)
    verify(frozen)
    if sources() != render_sources:
        raise RuntimeError("Importer/render source changed before rendering")
    records = []
    for m in selected:
        site, building, floor, plan = m["key"]
        ident = "swiss-floor-" + hashlib.sha256(":".join(m["key"]).encode()).hexdigest()[:20]
        seed = int(hashlib.sha256(f"{args.seed}:{ident}".encode()).hexdigest()[:8], 16)
        image, target, known, truth, stats = render(decoded[m["key"]], seed, args.width, args.height)
        image_path, target_path, coarse_path = (args.output / (ident + suffix) for suffix in (".png", ".npz", "-overview.npz"))
        reference_path = args.output / (ident + ".references.json")
        area_rows = [r for r in decoded[m["key"]] if r["entity_type"] == "area"]
        write_json(reference_path, {"site": site, "building": building, "floor": floor, "plan": plan,
                   "reference_kind": "source-functional-area-vectors-and-algorithm-derived-memberships",
                   "all_space_scoring_eligible": False, "human_completeness_evidence": False,
                   "areas": [{**ref, "geometry_wkt": row["geometry"].wkt} for ref, row in zip(stats["source_area_references"], area_rows)]})
        image.save(image_path); image_path.chmod(0o600)
        np.savez_compressed(target_path, target=target, known=known, truth=truth); target_path.chmod(0o600)
        coarse, coarse_known = coarse_targets(target, known)
        np.savez_compressed(coarse_path, target=coarse, known=coarse_known); coarse_path.chmod(0o600)
        records.append({"id": ident, "image": image_path.name, "targets": target_path.name, "overview": coarse_path.name,
                        "image_sha256": digest(image_path), "targets_sha256": digest(target_path), "overview_sha256": digest(coarse_path),
                        "site": site, "building": building, "floor": floor, "plan": plan, "group": m["group"], "split": m["split"],
                        "source": "swiss-dwellings-real-geometry", "source_row_snapshot_sha256": row_hashes[m["key"]],
                        "references": reference_path.name, "references_sha256": digest(reference_path),
                        "component_aliases": m["component_aliases"], "source_rows": m["rows"], "seed": seed,
                        "render_stats": stats, "limitations": LIMITATIONS})
        print(json.dumps({"rendered": len(records), "split": m["split"], "site": site, "floor": floor,
                          "source_doors": sum(stats["entity_counts"].get("opening:" + d, 0) for d in DOORS),
                          "components_provisional": stats["provisional_components"]}), flush=True)
    verify(frozen); validate_selection(selected)
    if sources() != render_sources:
        raise RuntimeError("Importer/render sources changed before manifest save")
    manifest = {"version": VERSION, "experiment": EXPERIMENT, "dataset_contract": CONTRACT, "heads": list(HEADS),
                "overview": OVERVIEW, "seed": args.seed, "records": records, "synthetic_counts": requested,
                "counts": requested, "validation_is_development": True, "excluded_msd_sites": sorted(excluded),
                "prior_manifests": prior, "source_provenance": provenance,
                "source_input_hashes": {str(p.resolve()): h for p, h in frozen.items()}, "render_source_hashes": render_sources,
                "metadata_preflight_sha256": digest(args.output / "metadata-preflight.json"),
                "predecode_protected_alias_count": 0, "postdecode_protected_alias_count": 0,
                "physical_room_ground_truth_certified": False, "approved_for_production": False,
                "all_space_scoring_eligible": False, "human_completeness_evidence": False,
                "truth_reference_kind": "algorithm-derived-components-not-independent-manual-room-ground-truth",
                "image_domain": "generated-render-of-real-vector-geometry",
                "target_provenance": {"interior": "union of allowlisted indoor source areas minus physical barrier footprints, unknowns and explicit nonroom polygons",
                                      "boundary": "original WALL/COLUMN and DOOR/ENTRANCE_DOOR/WINDOW geometry footprints only",
                                      "opening_closure": "original DOOR/ENTRANCE_DOOR geometry footprints only",
                                      "truth": "provisional 4-connected components of derived interior; never independent manual ground truth",
                                      "known": "zero for undefined/unrecognized source area semantics; partial supervision"},
                "area_semantics_policy": {"known_indoor_subtypes": sorted(INDOOR), "known_nonroom_subtypes": sorted(NONROOM),
                                          "unknown_subtypes_observed": sorted(k[5:] for k in metadata["entity_counts"]
                                                                             if k.startswith("area:") and k[5:] not in INDOOR | NONROOM)},
                "license": "CC BY 4.0; Swiss Dwellings v3.0.0; doi:10.5281/zenodo.7788422; changes: private independent rendering and raster targets.",
                "runtime": {k: version(p) for k, p in (("numpy", "numpy"), ("pillow", "pillow"), ("opencv", "opencv-python-headless"),
                                                            ("scipy", "scipy"), ("shapely", "shapely"))},
                "limitations": LIMITATIONS}
    write_json(args.output / "manifest.json", manifest)
    validate_manifest(args.output / "manifest.json")
    return manifest


def validate_manifest(path):
    data = json.loads(path.read_text())
    if data.get("version") != VERSION or data.get("experiment") != EXPERIMENT or data.get("heads") != list(HEADS):
        raise ValueError("Unsupported context-compatible manifest")
    excluded = {canonical_id(s) for s in data["excluded_msd_sites"]}
    sites, aliases, images, identifiers, counts = {}, {}, {}, set(), Counter()
    for r in data["records"]:
        if r["id"] in identifiers or Path(r["id"]).name != r["id"] or r["split"] not in {"train", "validation"}:
            raise ValueError("Unsafe duplicate identifier/split")
        identifiers.add(r["id"]); counts[r["split"]] += 1
        if canonical_id(r["site"]) in excluded or sites.setdefault(r["site"], r["split"]) != r["split"]:
            raise ValueError("Protected/shared site entered corpus")
        for a in r["component_aliases"]:
            if a.startswith("site:") and canonical_id(a[5:]) in excluded:
                raise ValueError("Protected site alias entered corpus")
            if aliases.setdefault(a, r["split"]) != r["split"]:
                raise ValueError("Repeated plan/floor alias crosses splits")
        if images.setdefault(r["image_sha256"], r["split"]) != r["split"]:
            raise ValueError("Identical images cross splits")
        assets = []
        for name in ("image", "targets", "overview"):
            asset = (path.parent / r[name]).resolve(strict=True)
            if Path(r[name]).is_absolute() or not asset.is_relative_to(path.parent.resolve()) or digest(asset) != r[name + "_sha256"]:
                raise ValueError("Unsafe/mutated private asset")
            assets.append(asset)
        reference = (path.parent / r["references"]).resolve(strict=True)
        if Path(r["references"]).is_absolute() or not reference.is_relative_to(path.parent.resolve()) or digest(reference) != r["references_sha256"]:
            raise ValueError("Source reference metadata changed")
        image = np.asarray(Image.open(assets[0]).convert("RGB"))
        with np.load(assets[1], allow_pickle=False) as a:
            if a["target"].shape != (3, *image.shape[:2]) or a["known"].shape != a["target"].shape or a["truth"].shape != image.shape[:2]:
                raise ValueError("Target/head/truth dimensions differ")
            if not np.isin(a["target"], [0, 1]).all() or not np.isin(a["known"], [0, 1]).all() or (a["truth"] < 0).any():
                raise ValueError("Invalid target/supervision values")
        with np.load(assets[2], allow_pickle=False) as a:
            if a["target"].shape != (3, OVERVIEW, OVERVIEW) or a["known"].shape != a["target"].shape:
                raise ValueError("Invalid context overview")
        for name, asset in zip(("image", "targets", "overview"), assets):
            if digest(asset) != r[name + "_sha256"]:
                raise ValueError("Asset changed while decoding verification snapshot")
    if dict(counts) != data["counts"]:
        raise ValueError("Emitted counts differ from metadata selection")
    return data


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv", type=Path, required=True); p.add_argument("--provenance", type=Path, required=True)
    p.add_argument("--prior-manifest", type=Path, action="append", required=True)
    p.add_argument("--output", type=Path, required=True); p.add_argument("--train", type=int, default=80)
    p.add_argument("--development", type=int, default=20); p.add_argument("--seed", type=int, default=20260930)
    p.add_argument("--width", type=int, default=2048); p.add_argument("--height", type=int, default=1536)
    a = p.parse_args()
    if min(a.train, a.development) < 1 or min(a.width, a.height) < 512:
        p.error("Positive train/development counts and pages >=512 pixels required")
    os.umask(0o077)
    result = build(a)
    print(json.dumps({"manifest": str(a.output / "manifest.json"), "counts": result["counts"], "training_started": False}))
