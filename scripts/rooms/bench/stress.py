#!/usr/bin/env python3
"""Deterministic development-only synthetic room-detection robustness checks.

These are corruptions of generated publisher geometry, NOT original drawings or
an independent accuracy test. References and known label seeds remain available.
Run with the same isolated Python environment as the benchmark.
"""
import argparse
import copy
import hashlib
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, __version__ as pillow_version

DEFAULT_CORPUS = Path('/home/tim/datasets/foremanhq-room-detection')
VARIANTS = ('rotation', 'scan', 'gaps')
VERSION = 1


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True, allow_nan=False) + '\n')


def stable_seed(case_id, variant):
    return int.from_bytes(hashlib.sha256(f'{VERSION}:{case_id}:{variant}'.encode()).digest()[:8], 'big')


def select_development(rows, count):
    if isinstance(count, bool) or not isinstance(count, int) or count < 1:
        raise ValueError('Count must be a positive integer')
    selected = [row for row in rows if row.get('split') == 'development']
    selected.sort(key=lambda row: hashlib.sha256(row['id'].encode()).hexdigest())
    if not selected:
        raise ValueError('No development cases; holdout inputs are forbidden')
    if len({row['id'] for row in selected}) != len(selected):
        raise ValueError('Duplicate development case IDs')
    return selected[:count]


def inside(corpus, relative):
    path = (corpus / relative).resolve()
    if not path.is_relative_to(corpus.resolve()):
        raise ValueError('Path outside corpus')
    return path


def rotation_parameters(width, height, degrees=7):
    if min(width, height) < 2:
        raise ValueError('Image is too small')
    theta = math.radians(degrees)
    c, s = math.cos(theta), math.sin(theta)
    # Padding bounds even the image corners, including non-square source images.
    aspect = (height - 1) / (width - 1)
    scale = min(.88, .98 / max(abs(c) + abs(s) * aspect, abs(c) + abs(s) / aspect))
    return {'degrees_counterclockwise': degrees, 'scale': scale,
            'width': width, 'height': height, 'expand': False,
            'fill': 'white', 'resampling': 'bicubic'}


def transform_point(point, parameters):
    x, y = point
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in (x, y)):
        raise ValueError('Invalid normalized point')
    width, height = parameters['width'], parameters['height']
    c = math.cos(math.radians(parameters['degrees_counterclockwise']))
    s = math.sin(math.radians(parameters['degrees_counterclockwise']))
    scale = parameters['scale']
    dx, dy = (x - .5) * (width - 1), (y - .5) * (height - 1)
    result = [.5 + scale * (c * dx + s * dy) / (width - 1),
              .5 + scale * (-s * dx + c * dy) / (height - 1)]
    if any(not 0 <= v <= 1 for v in result):
        raise ValueError('Rotation clips reference coordinates')
    return result


def transform_annotation(annotation, parameters):
    transformed = copy.deepcopy(annotation)
    for room in transformed['rooms']:
        room['seed'] = transform_point(room['seed'], parameters)
        polygon = room['polygon']
        if polygon['type'] == 'Polygon':
            polygon['coordinates'] = [[transform_point(point, parameters) for point in ring]
                                      for ring in polygon['coordinates']]
        elif polygon['type'] == 'MultiPolygon':
            polygon['coordinates'] = [[[transform_point(point, parameters) for point in ring]
                                       for ring in rings] for rings in polygon['coordinates']]
        else:
            raise ValueError('Only Polygon and MultiPolygon references are supported')
    return transformed


def rotate(image, annotation):
    parameters = rotation_parameters(*image.size)
    theta = math.radians(parameters['degrees_counterclockwise'])
    c, s, scale = math.cos(theta), math.sin(theta), parameters['scale']
    # Pillow affine coordinates describe pixel edges. The annotation transform
    # uses pixel centres (normalized 0..1 corresponds to 0..width-1).
    cx, cy = image.width / 2, image.height / 2
    inverse = (c / scale, -s / scale, cx - (c * cx - s * cy) / scale,
               s / scale, c / scale, cy - (s * cx + c * cy) / scale)
    result = image.transform(image.size, Image.Transform.AFFINE, inverse,
                             resample=Image.Resampling.BICUBIC, fillcolor='white')
    return result, transform_annotation(annotation, parameters), parameters


def scan(image, annotation, seed):
    radius = max(image.size) * .00045
    sigma = 4.0
    blurred = np.asarray(image.convert('L').filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    noise = np.random.default_rng(seed).normal(0, sigma, blurred.shape)
    result = Image.fromarray(np.clip(np.rint(blurred + noise), 0, 255).astype(np.uint8)).convert('RGB')
    return result, copy.deepcopy(annotation), {'blur_radius_pixels': radius,
            'noise_distribution': 'independent Gaussian additive grayscale',
            'noise_sigma_8bit': sigma, 'random_seed': seed}


def dark_runs(line, minimum):
    edges = np.flatnonzero(np.diff(np.concatenate(([False], line, [False])).astype(np.int8)))
    return [(int(a), int(b)) for a, b in zip(edges[::2], edges[1::2]) if b - a >= minimum]


def gaps(image, annotation, seed):
    """Cut a few narrow gaps across long, dark bands, leaving labels untouched."""
    width, height = image.size
    longest = max(image.size)
    dark = np.asarray(image.convert('L')) < 96
    rng = np.random.default_rng(seed)
    minimum_run = max(12, round(longest * .025))
    cut_width = max(1, round(longest * .0015))
    stride = max(1, round(longest * .002))
    maximum_thickness = max(6, round(longest * .025))
    seeds = [(r['seed'][0] * (width - 1), r['seed'][1] * (height - 1)) for r in annotation['rooms']]
    candidates = []
    for horizontal, matrix in ((True, dark), (False, dark.T)):
        for row in range(0, matrix.shape[0], stride):
            for start, end in dark_runs(matrix[row], minimum_run):
                column = int(rng.integers(start + minimum_run // 3, end - minimum_run // 3))
                low, high = row, row + 1
                while low > 0 and row - low <= maximum_thickness and matrix[low - 1, column]:
                    low -= 1
                while high < matrix.shape[0] and high - low <= maximum_thickness and matrix[high, column]:
                    high += 1
                if high - low > maximum_thickness or high - low < 2:
                    continue
                center = (column, row) if horizontal else (row, column)
                if any(math.dist(center, point) < longest * .012 for point in seeds):
                    continue
                candidates.append((horizontal, column, low, high, center))
    rng.shuffle(candidates)
    result = np.array(image.convert('RGB'))
    patches, centers = [], []
    for horizontal, column, low, high, center in candidates:
        if any(math.dist(center, other) < longest * .055 for other in centers):
            continue
        a = column - cut_width // 2
        b = a + cut_width
        box = [a, max(0, low - 1), b, min(height, high + 1)] if horizontal else [max(0, low - 1), a, min(width, high + 1), b]
        box = [max(0, box[0]), max(0, box[1]), min(width, box[2]), min(height, box[3])]
        result[box[1]:box[3], box[0]:box[2]] = 255
        patches.append({'box_xyxy_exclusive': box, 'wall_direction': 'horizontal' if horizontal else 'vertical'})
        centers.append(center)
        if len(patches) == 6:
            break
    return Image.fromarray(result), copy.deepcopy(annotation), {
        'random_seed': seed, 'dark_threshold_8bit': 96, 'minimum_run_pixels': minimum_run,
        'gap_width_pixels': cut_width, 'requested_gaps': 6, 'actual_gaps': len(patches),
        'patches': patches, 'annotations_changed': False}


def generate_case(corpus, output, row):
    # Defense in depth: this check runs before opening any source image/reference.
    if row.get('split') != 'development':
        raise ValueError('Only development cases are allowed; holdout inputs are forbidden')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', row['id']):
        raise ValueError('Unsafe case ID')
    source = inside(corpus, row['path'])
    annotation_path = inside(corpus, row['annotation_path'])
    if sha(source) != row['sha256']:
        raise ValueError('Source image checksum mismatch')
    annotation = json.loads(annotation_path.read_text())
    if annotation['id'] != row['id'] or len(annotation['rooms']) != row['room_count']:
        raise ValueError('Source annotation ID/count mismatch')
    with Image.open(source) as original:
        image = original.convert('RGB')
    generated = []
    for variant in VARIANTS:
        seed = stable_seed(row['id'], variant)
        variant_image, variant_annotation, parameters = rotate(image, annotation) if variant == 'rotation' else globals()[variant](image, annotation, seed)
        ident = f'{row["id"]}-stress-{variant}'
        variant_annotation['id'] = ident
        variant_annotation['stress'] = {'parent_case_id': row['id'], 'variant': variant, 'parameters': parameters}
        image_path = output / 'plans' / f'{ident}.png'
        reference_path = output / 'annotations' / f'{ident}.json'
        image_path.parent.mkdir(parents=True, exist_ok=True)
        variant_image.save(image_path, format='PNG', optimize=False)
        write_json(reference_path, variant_annotation)
        generated.append({'id': ident, 'family': 'resplan-synthetic-stress',
            'source_id': row.get('source_id', row['id']), 'parent_case_id': row['id'],
            'split': 'development', 'target': row.get('target', 'functional-room'),
            'path': str(image_path.relative_to(corpus)), 'annotation_path': str(reference_path.relative_to(corpus)),
            'sha256': sha(image_path), 'annotation_sha256': sha(reference_path),
            'source_image_sha256': row['sha256'], 'source_annotation_sha256': sha(annotation_path),
            'width': image.width, 'height': image.height, 'room_count': len(annotation['rooms']),
            'representation': 'synthetic_robustness_transform_of_generated_publisher_geometry',
            'stress_variant': variant, 'corruption_parameters': parameters})
    return generated


def generate(corpus, count=12, output_subdir='stress'):
    corpus = Path(corpus).resolve()
    output = inside(corpus, output_subdir)
    if output == corpus:
        raise ValueError('Output must be a subdirectory of the corpus')
    source_manifest = corpus / 'sources' / 'resplan-manifest.json'
    rows = select_development(json.loads(source_manifest.read_text()), count)
    generated = []
    for row in rows:
        generated.extend(generate_case(corpus, output, row))
    write_json(output / 'manifest.json', generated)
    write_json(output / 'metadata.json', {
        'version': VERSION, 'generator_sha256': sha(Path(__file__)),
        'purpose': 'Synthetic robustness checks; not original drawings or an independent accuracy test.',
        'selection': 'First N development IDs ordered by SHA256(id); no holdout source files read.',
        'known_seed_evaluation': True, 'reference_geometry_used_for_seeds': True,
        'selected_parent_ids': [r['id'] for r in rows], 'source_manifest_sha256': sha(source_manifest),
        'requested_count': count, 'parent_count': len(rows), 'variant_count': len(generated),
        'variants': VARIANTS, 'numpy_version': np.__version__, 'pillow_version': pillow_version,
        'manifest_sha256': sha(output / 'manifest.json'),
    })
    return output / 'manifest.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, default=DEFAULT_CORPUS)
    parser.add_argument('--count', type=int, default=12, help='Number of development parent cases (three variants each)')
    parser.add_argument('--output-subdir', default='stress', help='Output directory relative to corpus root')
    args = parser.parse_args()
    print(generate(args.corpus, args.count, args.output_subdir))


if __name__ == '__main__':
    main()
