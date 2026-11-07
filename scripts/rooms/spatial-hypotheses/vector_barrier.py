"""One declared structural-stroke hypothesis from the verified PDF paint spool.

Twice the modal positive stroke width is a drawing-relative hypothesis, not a
universal wall rule. Filled walls, thin walls and uncertain graphics need other
evidence; diagnostics keep these omissions explicit.
"""
from collections import Counter
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'stream-vector'))
from evidence import records


def paths(packed):
    at, current, first, output = 0, None, None, []
    while at < len(packed):
        kind = int(packed[at]); at += 1
        count = {0: 2, 1: 2, 2: 4, 3: 6, 4: 0}[kind]
        args = packed[at:at+count]; at += count
        if len(args) != count:
            raise ValueError('Partial path command')
        if kind == 0:
            if output:
                yield output
            current = first = args
            output = [args]
        elif kind == 1:
            output.append(args); current = args
        elif kind == 4:
            output.append(first); current = first
        else:
            if current is None:
                raise ValueError('Curve without starting point')
            p0 = np.asarray(current)
            if kind == 3:
                p1, p2, p3 = np.array(args).reshape(3, 2)
                output.extend(((1-t)**3*p0 + 3*(1-t)**2*t*p1 + 3*(1-t)*t*t*p2 + t**3*p3).tolist()
                              for t in np.linspace(0, 1, 13)[1:])
            else:
                p1, p2 = np.array(args).reshape(2, 2)
                output.extend(((1-t)**2*p0 + 2*(1-t)*t*p1 + t*t*p2).tolist()
                              for t in np.linspace(0, 1, 13)[1:])
            current = args[-2:]
    if output:
        yield output


def build(root, long_side=2048):
    states, widths = {}, Counter()
    for r in records(root):
        if r[0] == 'header':
            width, height, user_unit = r[2], r[3], r[5]
        elif r[0] == 's':
            states[r[1]] = r[2]
        elif r[0] == 'p' and r[4] & 1 and not r[10]:
            s = states[r[3]]
            w = round(s[1]*math.hypot(s[0][0], s[0][1])*user_unit, 5)
            if w > 0:
                widths[w] += 1
    if not widths:
        raise ValueError('No stroked structural hypothesis available')
    mode = sorted(widths, key=lambda w: (-widths[w], w))[0]
    threshold = 2*mode
    scale = long_side/max(width, height)
    canvas = Image.new('1', (round(width*scale), round(height*scale)))
    draw = ImageDraw.Draw(canvas)
    counts = Counter()
    for r in records(root):
        if r[0] in {'image', 'shading', 'annotation', 'unsupported'}:
            counts['unresolved_'+r[0]] += 1
            continue
        if r[0] != 'p' or not r[4] or r[10]:
            continue
        s = states[r[3]]
        if not r[8] or r[9] or not s[15] or any(s[i] for i in (12, 13, 16, 17, 18, 19)) or s[11] != 'Normal':
            counts['uncertain_graphics'] += 1
            continue
        # Filled paths may contain even-odd holes or painted-over source strokes.
        # Quarantine their entire local bound rather than invent a fill contour.
        if r[4] & 2:
            x0, y0, x1, y1 = r[7]
            draw.rectangle((int(x0*scale), int(y0*scale), math.ceil(x1*scale), math.ceil(y1*scale)), fill=0)
            counts['fill_bounds_cleared'] += 1
            continue
        w = s[1]*math.hypot(s[0][0], s[0][1])*user_unit
        color = s[5][2]
        if color < 0 or s[5][3] or s[9] or s[7] != 1:
            counts['unsupported_stroke'] += 1
            continue
        rgb = [(color >> shift) & 255 for shift in (16, 8, 0)]
        if w < threshold-1e-5 or max(rgb) > 80:
            counts['thin_or_light'] += 1
            continue
        for points in paths(r[6]):
            if len(points) > 1:
                draw.line([(round(x*scale), round(y*scale)) for x, y in points], fill=1, width=max(1, round(w*scale)))
        counts['retained_stroke_paths'] += 1
    return np.asarray(canvas).astype(bool), {'modal_width_points': mode, 'retained_minimum_width_points': threshold,
        'width_counts': dict(widths), 'counts': dict(counts), 'source_dimensions_points': [width, height],
        'barrier_is_hypothesis': True, 'visible_paint_certified': False,
        'limitations': 'Annotation strokes can survive; thin or filled walls can be lost. This is one structural-layer experiment, not exact PDF rendering.'}
