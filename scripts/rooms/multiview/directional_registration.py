"""Fixed-scale directional line registration; every result is an unreviewed hypothesis.

This does not classify ink as a wall, find rooms, or estimate a free affine warp.
Disjoint groups of native axis runs propose and check one of eight D4 transforms.
"""
from __future__ import annotations

import math
import time
import numpy as np
from PIL import Image
from scipy import ndimage, signal

SETTINGS = {
    'scale': .4, 'orientations': 8, 'maximum_pixels': 2_000_000,
    'achromatic_channel_span': 24, 'maximum_luminance': 224,
    'minimum_axis_run_pixels': 18, 'run_endpoint_jitter_pixels': 2,
    'maximum_run_band_pixels': 12, 'maximum_segments': 4096,
    'minimum_segments_per_axis_per_group': 3,
    'distance_clip_pixels': 8., 'residual_pixels': 2.,
    'maximum_fit_mean': 1.5, 'maximum_check_mean': 1.5,
    'minimum_check_segment_fraction': .75,
    'minimum_check_span_fraction': .45, 'minimum_check_quadrants': 3,
    'minimum_reverse_axis_support': .40,
    'contradiction_distance_pixels': 6., 'maximum_unexplained_run_fraction': .65,
    'distinct_peak_radius_pixels': 24, 'maximum_peaks_per_orientation': 32,
    'minimum_runner_up_fit_gap': .35,
    'overall_seconds': 120,
}


def _rgb(value):
    a = np.asarray(value)
    if (a.dtype != np.uint8 or a.ndim != 3 or a.shape[2] != 3 or
            min(a.shape[:2]) < 32 or a.shape[0] * a.shape[1] > SETTINGS['maximum_pixels']):
        raise ValueError('Expected bounded native uint8 RGB crop')
    return a


def _guard(deadline):
    if time.monotonic() > deadline:
        raise RuntimeError('Directional registration time budget')


def extract(rgb):
    """Long achromatic axis runs, not certified wall/door entities.

    Adjacent rows with similar endpoints stay in the SAME evidence group, so
    thick strokes cannot put identical neighboring rows into fit and check.
    """
    a = _rgb(rgb).astype(np.float32)
    luminance = a @ np.array([.299, .587, .114], dtype=np.float32)
    ink = ((a.max(axis=2) - a.min(axis=2) <= SETTINGS['achromatic_channel_span']) &
           (luminance <= SETTINGS['maximum_luminance']))
    segments = []
    for axis, rows in [('h', ink), ('v', ink.T)]:
        active = []
        finished = []
        for cross, row in enumerate(rows):
            edges = np.diff(np.r_[False, row, False].astype(np.int8))
            intervals = [(int(s), int(e)-1) for s, e in zip(np.where(edges == 1)[0], np.where(edges == -1)[0])
                         if e-s >= SETTINGS['minimum_axis_run_pixels']]
            next_active = []
            consumed = set()
            for start, end in intervals:
                matches = [i for i, g in enumerate(active) if i not in consumed and
                           abs(start-g['last_start']) <= SETTINGS['run_endpoint_jitter_pixels'] and
                           abs(end-g['last_end']) <= SETTINGS['run_endpoint_jitter_pixels']]
                if len(matches) == 1:
                    i = matches[0]; consumed.add(i); g = active[i]
                    g['starts'].append(start); g['ends'].append(end); g['crosses'].append(cross)
                    g['last_start'], g['last_end'] = start, end
                else:
                    g = {'starts': [start], 'ends': [end], 'crosses': [cross], 'cross_start': cross,
                         'last_start': start, 'last_end': end}
                next_active.append(g)
            finished.extend(g for i, g in enumerate(active) if i not in consumed)
            active = next_active
        finished.extend(active)
        for g in finished:
            # Complete the neighboring-row family BEFORE applying its width
            # gate. Chunking a solid wide stroke would leak the same band into
            # both fit and check; an overwide family is wholly ineligible.
            if len(g['crosses']) > SETTINGS['maximum_run_band_pixels']:
                continue
            # Half-up rounding commutes with integer page translation; Python's
            # ties-to-even rounding would shift the same band on odd offsets.
            start, end, cross = [int(math.floor(np.mean(g[k])+.5)) for k in ('starts', 'ends', 'crosses')]
            if end-start+1 < SETTINGS['minimum_axis_run_pixels']:
                continue
            p, q = ([start, cross], [end, cross]) if axis == 'h' else ([cross, start], [cross, end])
            segments.append({'axis': axis, 'a': p, 'b': q, 'band_rows': len(g['crosses'])})
    if len(segments) > SETTINGS['maximum_segments']:
        raise RuntimeError('Directional segment budget; no evidence truncation')
    segments.sort(key=lambda s: (s['axis'], s['a'][1 if s['axis'] == 'h' else 0], s['a'], s['b']))
    ordinal = {'h': 0, 'v': 0}
    masks = {group: {axis: np.zeros(ink.shape, bool) for axis in ('h', 'v')}
             for group in ('fit', 'check', 'all')}
    for s in segments:
        axis = s['axis']; i = ordinal[axis]; ordinal[axis] += 1
        s['id'], s['group'] = f'{axis}-{i}', 'fit' if i % 2 == 0 else 'check'
        x, y = s['a']; u, v = s['b']
        for group in (s['group'], 'all'):
            masks[group][axis][y:v+1, x:u+1] = True
    return segments, masks


def _orientation(width, height, rotation, reflected):
    m = np.eye(3)
    if reflected:
        m = np.array([[-1., 0, width-1], [0, 1, 0], [0, 0, 1]])
    w, h = width, height
    for _ in range(rotation):
        m = np.array([[0., 1, 0], [-1, 0, w-1], [0, 0, 1]]) @ m
        w, h = h, w
    return m, w, h


def apply(matrix, xy):
    xy = np.asarray(xy, dtype=float)
    return np.c_[xy, np.ones(len(xy))].dot(np.asarray(matrix).T)[:, :2]


def _rotate_masks(masks, rotation, reflected):
    result = {}
    for group, channels in masks.items():
        result[group] = {}
        for axis, a in channels.items():
            b = np.fliplr(a) if reflected else a
            result[group][('v' if axis == 'h' else 'h') if rotation % 2 else axis] = np.rot90(b, rotation)
    return result


def _distance(mask):
    if not mask.any():
        return np.full(mask.shape, SETTINGS['distance_clip_pixels'], np.float32)
    return np.minimum(ndimage.distance_transform_edt(~mask), SETTINGS['distance_clip_pixels']).astype(np.float32)


def _mean_loss(distances, mask, x, y):
    h, w = mask.shape
    return float(distances[y:y+h, x:x+w][mask].mean()) if mask.any() else SETTINGS['distance_clip_pixels']


def _check(segments, matrix, masks, distances, target_segments, target_masks, x, y, anchor, deadline):
    h, w = masks['all']['h'].shape
    check_losses = [_mean_loss(distances[axis], masks['check'][axis], x, y) for axis in ('h', 'v')]
    reasons = []
    if max(check_losses) > SETTINGS['maximum_check_mean']:
        reasons.append('withheld-mean-residual')
    anchor_inside = x <= anchor[0] < x+w and y <= anchor[1] < y+h
    if not anchor_inside:
        reasons.append('indexed-anchor-outside-template-frame')
    support = {axis: [] for axis in ('h', 'v')}
    counts = {axis: 0 for axis in ('h', 'v')}
    for s in segments:
        _guard(deadline)
        if s['group'] != 'check':
            continue
        a, b = apply(matrix, [s['a'], s['b']])
        axis = 'h' if abs(a[1]-b[1]) < .01 else 'v'
        counts[axis] += 1
        length = max(abs(b-a))
        xy = np.linspace(a, b, max(2, math.ceil(length/2)+1)) + [x, y]
        ds = ndimage.map_coordinates(distances[axis], [xy[:, 1], xy[:, 0]], order=1, mode='constant', cval=8)
        if float(np.quantile(ds, .9)) <= SETTINGS['residual_pixels']:
            support[axis].append((s['id'], a, b))
    axis_support = {axis: len(support[axis])/counts[axis] if counts[axis] else 0. for axis in ('h', 'v')}
    if min(axis_support.values()) < SETTINGS['minimum_check_segment_fraction']:
        reasons.append('withheld-axis-segment-support')
    if any(len(support[a]) < SETTINGS['minimum_segments_per_axis_per_group'] for a in ('h', 'v')):
        reasons.append('insufficient-withheld-axis-witnesses')
    points = np.array([p for s in support.values() for _, a, b in s for p in (a, b)])
    span = (np.ptp(points, axis=0)/[w, h]).tolist() if len(points) else [0., 0.]
    quadrants = len({(int(p[0] >= w/2), int(p[1] >= h/2)) for p in points})
    if min(span) < SETTINGS['minimum_check_span_fraction'] or quadrants < SETTINGS['minimum_check_quadrants']:
        reasons.append('withheld-support-too-local')
    reverse = {}; unexplained = {}
    for axis in ('h', 'v'):
        dt = _distance(masks['all'][axis])
        target = target_masks['all'][axis][y:y+h, x:x+w]
        reverse[axis] = float((dt[target] <= SETTINGS['residual_pixels']).mean()) if target.any() else 0.
        longest = 0.
        for s in target_segments:
            _guard(deadline)
            if s['axis'] != axis:
                continue
            a, b = np.asarray(s['a'], float)-[x, y], np.asarray(s['b'], float)-[x, y]
            if axis == 'h':
                if not 0 <= a[1] < h: continue
                a[0], b[0] = max(0., a[0]), min(w-1., b[0])
            else:
                if not 0 <= a[0] < w: continue
                a[1], b[1] = max(0., a[1]), min(h-1., b[1])
            length = max(b-a)
            if length <= 0: continue
            xy = np.linspace(a, b, max(2, math.ceil(length/2)+1))
            ds = ndimage.map_coordinates(dt, [xy[:, 1], xy[:, 0]], order=1, mode='constant', cval=8)
            if float((ds > SETTINGS['contradiction_distance_pixels']).mean()) >= .75:
                longest = max(longest, float(length/(w if axis == 'h' else h)))
        unexplained[axis] = longest
    if min(reverse.values()) < SETTINGS['minimum_reverse_axis_support']:
        reasons.append('reverse-axis-support-or-clutter')
    if max(unexplained.values()) > SETTINGS['maximum_unexplained_run_fraction']:
        reasons.append('contradictory-long-axis-run')
    return {'check_axis_mean': dict(zip(('h', 'v'), check_losses)), 'check_axis_segment_fraction': axis_support,
            'check_supported_ids': {a: [s[0] for s in support[a]] for a in ('h', 'v')},
            'check_span_fraction': span, 'check_quadrants': quadrants, 'reverse_axis_support': reverse,
            'unexplained_axis_run_fraction': unexplained, 'indexed_anchor_inside': bool(anchor_inside),
            'rejection_reasons': reasons, 'geometrically_supported': not reasons}


def register(template, target, anchor, deadline=None):
    """Return all declared local peaks, full cost maps and abstention diagnostics.

    Anchor is the indexed floor-label center, not a room seed/count/ground truth.
    Pixel coordinates are native array sample centers; .4 PIL resize uses the
    corresponding half-pixel affine. No approval or boundary is transferred.
    """
    start = time.monotonic(); deadline = deadline or start+SETTINGS['overall_seconds']
    template, target = _rgb(template), _rgb(target)
    if any((n*2) % 5 for n in template.shape[:2]):
        raise ValueError('Source dimensions must permit exact .4 isotropic raster scale')
    anchor = np.asarray(anchor, dtype=float)
    if anchor.shape != (2,) or not np.isfinite(anchor).all():
        raise ValueError('Invalid indexed anchor')
    scaled = np.asarray(Image.fromarray(template).resize(
        (round(template.shape[1]*.4), round(template.shape[0]*.4)), Image.Resampling.BICUBIC))
    segments, masks = extract(scaled)
    target_segments, target_masks = extract(target)
    source_counts = {g: {a: sum(s['group'] == g and s['axis'] == a for s in segments) for a in ('h', 'v')}
                     for g in ('fit', 'check')}
    if min(n for c in source_counts.values() for n in c.values()) < SETTINGS['minimum_segments_per_axis_per_group']:
        return {'status': 'unresolved', 'reason': 'insufficient-disjoint-axis-evidence', 'source_counts': source_counts,
                'peaks': [], 'orientations': [], 'segments': segments, 'seconds': time.monotonic()-start}, {}
    distances = {a: _distance(target_masks['all'][a]) for a in ('h', 'v')}
    scale = np.array([[.4, 0, -.3], [0, .4, -.3], [0, 0, 1]])
    peaks, orientations, surfaces = [], [], {}
    over_budget = False
    for reflected in (False, True):
        for rotation in range(4):
            _guard(deadline)
            tag = f'r{rotation*90}-mirror{int(reflected)}'
            oriented = _rotate_masks(masks, rotation, reflected)
            m, w, h = _orientation(scaled.shape[1], scaled.shape[0], rotation, reflected)
            if target.shape[0] < h or target.shape[1] < w:
                orientations.append({'id': tag, 'status': 'template-does-not-fit-roi'}); continue
            losses = []
            for axis in ('h', 'v'):
                q = oriented['fit'][axis].astype(np.float32)
                losses.append(signal.fftconvolve(distances[axis], q[::-1, ::-1], mode='valid')/q.sum())
                _guard(deadline)
            cost = np.maximum((losses[0]+losses[1])*.5, 0).astype(np.float32)
            surfaces[tag] = cost
            minima = (cost <= ndimage.minimum_filter(cost, size=2*SETTINGS['distinct_peak_radius_pixels']+1)+1e-6)
            eligible = np.argwhere(minima & (cost <= SETTINGS['maximum_fit_mean']))
            ordered = sorted(eligible.tolist(), key=lambda p: (float(cost[p[0], p[1]]), p[0], p[1]))
            selected = []
            for y, x in ordered:
                if any(max(abs(x-u), abs(y-v)) <= SETTINGS['distinct_peak_radius_pixels'] for v, u in selected):
                    continue
                selected.append((y, x))
            capped = len(selected) > SETTINGS['maximum_peaks_per_orientation']
            over_budget |= capped
            orientations.append({'id': tag, 'status': 'peak-budget-unresolved' if capped else 'completed',
                                 'minimum_fit_mean': float(cost.min()), 'local_minimum_pixels': len(eligible),
                                 'distinct_eligible_peaks': len(selected)})
            retained = selected[:SETTINGS['maximum_peaks_per_orientation']]
            # Even a completely failed orientation retains its best observable
            # alignment for falsification; it never bypasses the absolute gates.
            best = tuple(int(n) for n in np.unravel_index(np.argmin(cost), cost.shape))
            if best not in retained:
                retained.append(best)
            for y, x in retained:
                _guard(deadline)
                check = _check(segments, m, oriented, distances, target_segments, target_masks, x, y, anchor, deadline)
                fit_axis = {a: float(losses[i][y, x]) for i, a in enumerate(('h', 'v'))}
                if max(fit_axis.values()) > SETTINGS['maximum_fit_mean']:
                    check['rejection_reasons'].append('fit-axis-mean-residual')
                    check['geometrically_supported'] = False
                translation = np.array([[1., 0, x], [0, 1, y], [0, 0, 1]])
                peaks.append({'id': f'{tag}-x{x}-y{y}', 'orientation': tag, 'rotation_degrees': rotation*90,
                              'reflected': reflected, 'translation_pixels': [x, y],
                              'diagnostic_only_fit_failure': bool(cost[y, x] > SETTINGS['maximum_fit_mean']),
                              'fit_mean': float(cost[y, x]), 'fit_axis_mean': fit_axis,
                              'matrix_crop_to_roi': (translation@m@scale).tolist(), **check,
                              'matrix_scaled_to_roi': (translation@m).tolist(),
                              'requires_review': True, 'review_status': 'pending'})
    supported = [p for p in peaks if p['geometrically_supported']]
    chosen = min(supported, key=lambda p: p['fit_mean']) if supported else None
    margin = None
    if chosen:
        others = [p['fit_mean'] for p in peaks if p['id'] != chosen['id'] and p['indexed_anchor_inside']]
        margin = min(others)-chosen['fit_mean'] if others else None
    accepted = bool(chosen and len(supported) == 1 and not over_budget and
                    (margin is None or margin >= SETTINGS['minimum_runner_up_fit_gap']))
    reason = ('supported-unreviewed-registration' if accepted else 'peak-budget' if over_budget else
              'no-supported-peak' if not supported else 'ambiguous-competing-transforms')
    _guard(deadline)
    return {'status': 'supported' if accepted else 'unresolved', 'reason': reason,
            'source_counts': source_counts, 'target_segment_count': len(target_segments), 'segments': segments,
            'peaks': peaks, 'orientations': orientations, 'supported_peak_ids': [p['id'] for p in supported],
            'chosen_peak_id': chosen['id'] if accepted else None, 'runner_up_fit_gap': margin,
            'seconds': time.monotonic()-start, 'room_accuracy_measured': False, 'approved_for_production': False}, surfaces
