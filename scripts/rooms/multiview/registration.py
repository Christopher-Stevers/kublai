"""Scale-constrained detail-to-floor registration using independent match checks.

SIFT proposes correspondences; RANSAC fits a similarity on alternating matches,
and the remaining matches must support it. Reflections are explicit. This can
transfer a reviewed suite's room outlines, but never its approval to a copy.
"""
from __future__ import annotations

import math
import time
import numpy as np
from scipy import ndimage
from skimage.feature import SIFT, match_descriptors
from skimage.measure import ransac
from skimage.transform import SimilarityTransform

FIXED = {'maximum_pixels': 2_000_000, 'maximum_features': 6000, 'maximum_matches': 2000,
         'ratio': .8, 'residual_pixels': 2., 'scale_relative_error': .08,
         'minimum_fit_inliers': 8, 'minimum_check_inliers': 6,
         'minimum_check_fraction': .35, 'minimum_source_coverage': .15,
         'minimum_ink_agreement': .60, 'seconds': 45, 'ransac_trials': 1500}


def features(gray):
    detector = SIFT(upsampling=1, n_octaves=5)
    try:
        detector.detect_and_extract(gray)
    except RuntimeError as e:
        if 'found no features' in str(e).lower():
            return np.empty((0, 2)), np.empty((0, 128), np.uint8)
        raise
    if len(detector.keypoints) > FIXED['maximum_features']:
        raise RuntimeError('Registration feature budget')
    return detector.keypoints[:, ::-1].astype(float), detector.descriptors


def apply(matrix, xy):
    xy = np.asarray(xy, dtype=float)
    return np.c_[xy, np.ones(len(xy))].dot(np.asarray(matrix).T)[:, :2]


def register(template, target, expected_scale):
    """Gray float arrays use 0=black, 1=white; scale comes from printed drawings.

    Caller binds PDF hashes/pages/crops. No learned room mask, reference geometry
    or expected room count is accepted. The output is a registration hypothesis.
    """
    start = time.monotonic()
    arrays = [np.asarray(a, dtype=np.float32) for a in (template, target)]
    if not 0 < expected_scale <= 10 or not math.isfinite(expected_scale):
        raise ValueError('Invalid drawing scale ratio')
    if any(a.ndim != 2 or min(a.shape) < 32 or a.size > FIXED['maximum_pixels'] or
           not np.isfinite(a).all() or a.min() < 0 or a.max() > 1 for a in arrays):
        raise ValueError('Invalid bounded grayscale crop')
    template, target = arrays
    target_xy, target_descriptors = features(target)
    candidates, attempts = [], []
    target_distance = ndimage.distance_transform_edt(target > .9)
    for reflected in (False, True):
        image = np.fliplr(template).copy() if reflected else template
        source_xy, desc = features(image)
        attempt = {'reflected': reflected, 'source_features': len(source_xy), 'target_features': len(target_xy)}
        attempts.append(attempt)
        if min(len(source_xy), len(target_xy)) < 20:
            attempt['status'] = 'insufficient-features'; continue
        matches = match_descriptors(desc, target_descriptors, metric='euclidean', cross_check=True, max_ratio=FIXED['ratio'])
        attempt['matches'] = len(matches)
        if len(matches) > FIXED['maximum_matches']:
            raise RuntimeError('Registration correspondence budget')
        if len(matches) < 28:
            attempt['status'] = 'insufficient-correspondences'; continue
        # Deterministic division before fitting. Match indices, not target labels,
        # decide which points are withheld from the transform estimation.
        fit, check = matches[::2], matches[1::2]
        model, inliers = ransac((source_xy[fit[:, 0]], target_xy[fit[:, 1]]), SimilarityTransform,
                                min_samples=3, residual_threshold=FIXED['residual_pixels'],
                                max_trials=FIXED['ransac_trials'], rng=0)
        if model is None or inliers is None or int(inliers.sum()) < FIXED['minimum_fit_inliers']:
            attempt['status'] = 'no-supported-transform'; continue
        attempt['fit_inliers'] = int(inliers.sum()); attempt['scale'] = float(model.scale)
        if abs(model.scale/expected_scale-1) > FIXED['scale_relative_error']:
            attempt['status'] = 'scale-disagreement'; continue
        residual = np.linalg.norm(model(source_xy[check[:, 0]])-target_xy[check[:, 1]], axis=1)
        supported = residual <= FIXED['residual_pixels']
        attempt['check_inliers'] = int(supported.sum())
        if supported.sum() < FIXED['minimum_check_inliers'] or supported.mean() < FIXED['minimum_check_fraction']:
            attempt['status'] = 'withheld-matches-disagree'; continue
        verified_xy = source_xy[check[supported, 0]]
        extent = np.ptp(verified_xy, axis=0)
        coverage = float(np.prod(extent)/image.size)
        attempt['source_coverage'] = coverage
        if coverage < FIXED['minimum_source_coverage']:
            attempt['status'] = 'matches-too-local'; continue
        # Whole-crop ink support is a separate observable from the keypoints.
        # Sampling is declared, deterministic and used only as an uncalibrated
        # rejection check; it is not a physical wall/room correctness metric.
        y, x = np.where(image < .65)
        step = max(1, math.ceil(len(x)/5000))
        warped = model(np.c_[x[::step], y[::step]])
        inside = ((warped[:, 0] >= 0) & (warped[:, 0] < target.shape[1]-1) &
                  (warped[:, 1] >= 0) & (warped[:, 1] < target.shape[0]-1))
        if not len(x) or inside.mean() < .98:
            attempt['status'] = 'crop-incomplete'; continue
        distances = ndimage.map_coordinates(target_distance, [warped[:, 1], warped[:, 0]], order=1, mode='constant', cval=100)
        agreement = float(np.mean(distances <= 2))
        attempt['ink_agreement'] = agreement
        if agreement < FIXED['minimum_ink_agreement']:
            attempt['status'] = 'ink-disagreement'; continue
        reflection = np.array([[-1, 0, template.shape[1]-1], [0, 1, 0], [0, 0, 1]]) if reflected else np.eye(3)
        matrix = model.params @ reflection
        attempt['status'] = 'supported-hypothesis'
        candidates.append({'matrix_source_to_target': matrix.tolist(), 'reflected': reflected,
                           'scale': float(model.scale), 'rotation_radians': float(model.rotation),
                           'withheld_match_fraction': float(supported.mean()),
                           'withheld_match_p95_residual_pixels': float(np.quantile(residual[supported], .95)),
                           'ink_agreement': agreement, 'source_coverage': coverage,
                           'requires_review': True, 'review_status': 'pending',
                           'room_accuracy_measured': False})
        if time.monotonic()-start > FIXED['seconds']:
            raise RuntimeError('Registration time budget')
    if time.monotonic()-start > FIXED['seconds']:
        raise RuntimeError('Registration time budget')
    return candidates, {'attempts': attempts, 'seconds': time.monotonic()-start,
                        'ambiguous': len(candidates) != 1, 'approved_for_production': False}


def transfer_shape(shape, matrix):
    """Preserve every boundary and hole; caller still checks validity/duplicates.

    Accepts pixel-coordinate rings, not a bounding rectangle substitution.
    """
    m = np.asarray(matrix, dtype=float)
    if m.shape != (3, 3) or not np.isfinite(m).all() or not np.allclose(m[2], [0, 0, 1]):
        raise ValueError('Invalid affine frame')
    a = m[:2, :2]
    gram = a.T@a
    if abs(np.linalg.det(a)) < 1e-10 or not np.allclose(gram, np.eye(2)*gram[0, 0], atol=1e-7):
        raise ValueError('Only nondegenerate similarity/reflection transfers supported')
    if len(shape['outer']) < 3 or any(len(h) < 3 for h in shape.get('holes', [])):
        raise ValueError('Incomplete rings')
    if not all(np.isfinite(r).all() for r in [np.asarray(shape['outer']), *(np.asarray(h) for h in shape.get('holes', []))]):
        raise ValueError('Nonfinite boundary')
    return {'outer': apply(m, shape['outer']).tolist(),
            'holes': [apply(m, h).tolist() for h in shape.get('holes', [])],
            'review_status': 'pending', 'requires_review': True}
