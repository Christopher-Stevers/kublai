"""Label-free, local bottleneck cuts from robot-navigation geometry.

Unlike the learned-head watershed, this places explicit wall-to-wall cuts only
where a narrow passage opens into wider free space in both directions. It keeps
the cut as a navigation edge while partitioning the enclosed space.
"""
from __future__ import annotations

import math
import time
import numpy as np
from scipy import ndimage
from skimage.morphology import medial_axis
from skimage.draw import line

VERSION = 'wall-supported-navigation-necks-v1'
FIXED = {'maximum_pixels': 5_000_000, 'maximum_skeleton_samples': 150_000,
         'maximum_cuts': 2000, 'seconds': 45, 'expansion_ratio': 1.5,
         'continuation': .65, 'minimum_area': 64}


def at(array, x, y, fallback=0):
    x, y = int(round(x)), int(round(y))
    return array[y, x] if 0 <= y < array.shape[0] and 0 <= x < array.shape[1] else fallback


def partition(walls):
    started = time.monotonic()
    walls = np.asarray(walls)
    if walls.dtype != bool or walls.ndim != 2 or walls.size > FIXED['maximum_pixels'] or min(walls.shape) < 20:
        raise ValueError('Expected bounded two-dimensional barrier hypothesis')
    # Boundary pixels are padding for the geometry only; outside classification
    # is performed from the original image edges after candidate cuts.
    solid = np.pad(walls, 1, constant_values=True)
    skeleton, distance = medial_axis(~solid, return_distance=True, rng=0)
    components, _ = ndimage.label(solid, np.ones((3, 3), bool))
    sizes = np.bincount(components.ravel())
    radius_limit = max(4., max(walls.shape)*.025)
    ys, xs = np.where(skeleton & (distance >= 2) & (distance <= radius_limit))
    if len(xs) > FIXED['maximum_skeleton_samples']:
        raise RuntimeError('Skeleton sample budget')
    proposals = []
    for index, (y, x) in enumerate(zip(ys, xs)):
        if index % 512 == 0 and time.monotonic()-started > FIXED['seconds']:
            raise RuntimeError('Navigation-cut time budget')
        r = float(distance[y, x])
        for angle in range(8):
            a = angle*math.pi/8
            nx, ny = math.cos(a), math.sin(a)
            tx, ty = -ny, nx
            # Both approaches must open up; straight or bent uniform-width
            # corridors are not divided simply because they are narrow.
            approach = []
            for sign in (-1, 1):
                approach.append(max(at(distance, x+sign*tx*r*k, y+sign*ty*r*k)
                                    for k in (2., 3., 4.)))
            if min(approach) < FIXED['expansion_ratio']*r:
                continue
            ends = []
            for sign in (-1, 1):
                end = None
                for step in range(1, math.ceil(1.5*r)+2):
                    ex, ey = x+sign*nx*step, y+sign*ny*step
                    if at(solid, ex, ey, True):
                        end = (ex, ey, step)
                        break
                if end is not None:
                    ends.append(end)
            if len(ends) != 2:
                continue
            left, right = ends
            if left[2]+right[2] > 2.7*r:
                continue
            ids = [int(at(components, e[0], e[1])) for e in ends]
            if not ids[0] or ids[0] != ids[1] or sizes[ids[0]] < 12*r:
                continue
            continuation = []
            for sign, end in zip((-1, 1), ends):
                continuation.append(np.mean([at(solid, end[0]+sign*nx*k, end[1]+sign*ny*k, False)
                                             for k in np.linspace(0, 2*r, 12)]))
            if min(continuation) < FIXED['continuation']:
                continue
            proposals.append({'a': [int(round(left[0]))-1, int(round(left[1]))-1],
                              'b': [int(round(right[0]))-1, int(round(right[1]))-1],
                              'center': [int(x)-1, int(y)-1], 'radius': r,
                              'score': min(continuation)*min(approach)/r,
                              'requires_review': True, 'score_is_calibrated_confidence': False})
    cuts = []
    for p in sorted(proposals, key=lambda p: (-p['score'], p['radius'], p['center'])):
        if any(math.dist(p['center'], q['center']) < 2*max(p['radius'], q['radius']) for q in cuts):
            continue
        cuts.append(p)
    if len(cuts) > FIXED['maximum_cuts']:
        raise RuntimeError('Navigation-cut count budget')
    barrier = walls.copy()
    for cut in cuts:
        rr, cc = line(cut['a'][1], cut['a'][0], cut['b'][1], cut['b'][0])
        valid = (rr >= 0) & (rr < barrier.shape[0]) & (cc >= 0) & (cc < barrier.shape[1])
        barrier[rr[valid], cc[valid]] = True
    labels, n = ndimage.label(~barrier)
    outside = set(np.r_[labels[0], labels[-1], labels[:, 0], labels[:, -1]].tolist())
    areas = np.bincount(labels.ravel(), minlength=n+1)
    mapping = np.zeros(n+1, np.int32)
    mapping[[i for i in range(1, n+1) if i not in outside and areas[i] >= FIXED['minimum_area']]] = np.arange(
        1, sum(i not in outside and areas[i] >= FIXED['minimum_area'] for i in range(1, n+1))+1)
    output = mapping[labels]
    # This diagnostic exposes possible leaks instead of claiming that an omitted
    # wing/outside-looking region is confirmed background.
    unresolved = np.isin(labels, list(outside)) & ~walls
    if time.monotonic()-started > FIXED['seconds']:
        raise RuntimeError('Navigation-cut time budget')
    return output, cuts, {'version': VERSION, 'candidates': len(proposals), 'cuts': len(cuts),
                          'regions': int(output.max()), 'unresolved_exterior_pixels': int(unresolved.sum()),
                          'seconds': time.monotonic()-started, 'approved_for_production': False,
                          'limitations': 'Barrier hypotheses can be annotations or furniture. Enclosure/neck geometry alone does not certify physical rooms.'}
