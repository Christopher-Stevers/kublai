"""Discover within-PDF suite/detail relationships before attempting registration.

Titles locate candidate views, not trustworthy room boundaries. Multiple variants
stay ambiguous. A ceiling plan never silently substitutes for a floor plan.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from page_binding import sha

TYPE = r'[A-Z](?:\d+)?(?:-(?:BF|\d+))?'
SUITE = re.compile(r'^SUITE\s+('+TYPE+r')\b')
SHEET = re.compile(r'^[A-Z]{1,3}-?\d{2,4}[A-Z]?$')


def local(tag):
    return tag.rsplit('}', 1)[-1]


def parse(xml):
    if len(xml) > 96*1024**2:
        raise ValueError('Drawing text size budget')
    root = ET.fromstring(xml)
    pages = []
    for number, page in enumerate((x for x in root.iter() if local(x.tag) == 'page'), 1):
        width, height = float(page.attrib['width']), float(page.attrib['height'])
        if min(width, height) <= 0 or number > 500:
            raise ValueError('Page budget/frame')
        lines = []
        for el in page.iter():
            if local(el.tag) != 'line':
                continue
            words = [x for x in el.iter() if local(x.tag) == 'word']
            if not words:
                continue
            text = re.sub(r'\s+', ' ', ' '.join(''.join(w.itertext()) for w in words)).strip().upper()
            xs = [float(w.attrib['xMin']) for w in words]; ys = [float(w.attrib['yMin']) for w in words]
            xe = [float(w.attrib['xMax']) for w in words]; ye = [float(w.attrib['yMax']) for w in words]
            lines.append({'text': text, 'box': [min(xs), min(ys), max(xe), max(ye)]})
        lines.sort(key=lambda l: (l['box'][1], l['box'][0]))
        # Only the actual bottom-right title block may provide the sheet ID.
        # A reference such as A503 in a callout or an index table cannot rename it.
        ids = []
        for w in page.iter():
            if local(w.tag) == 'word' and w.text and SHEET.fullmatch(w.text.strip().upper()):
                if float(w.attrib['xMax']) > .93*width and float(w.attrib['yMin']) > .9*height:
                    ids.append((float(w.attrib['yMin']), float(w.attrib['xMin']), w.text.strip().upper()))
        sheet_id = max(ids)[2] if ids else None
        footer = ' '.join(l['text'] for l in lines if l['box'][0] > .85*width and l['box'][1] > .76*height)
        if 'SUITE PLANS' in footer or 'SUITES INDIVIDUAL' in footer:
            kind = 'suite-details'
        elif 'REFLECTED' in footer and 'CEILING' in footer:
            kind = 'ceiling-plan'
        elif 'FLOOR PLAN' in footer:
            kind = 'floor-plan'
        else:
            kind = 'other-or-unresolved'
        # Exporters sometimes put SUITE and its type on separate centered lines.
        # Join ONLY close, vertically adjacent short labels, not body paragraphs.
        combined = list(lines)
        for l in lines:
            if l['text'] != 'SUITE':
                continue
            x0, y0, x1, y1 = l['box']; char_height = y1-y0
            for next_line in lines:
                bx0, by0, bx1, by1 = next_line['box']
                if (re.fullmatch(TYPE, next_line['text']) and 0 <= by0-y1 <= char_height*1.5
                        and abs((bx0+bx1)-(x0+x1))/2 < max(x1-x0, bx1-bx0)*.55):
                    combined.append({'text': 'SUITE '+next_line['text'], 'box': [min(x0,bx0), y0, max(x1,bx1), by1]})
                    break
        views, instances = [], []
        for l in combined:
            match = SUITE.match(l['text'])
            if not match:
                continue
            typ = match[1]
            # Avoid consuming only the prefix of an unknown/hyphenated variant.
            suffix = l['text'][match.end():]
            if suffix.startswith('-'):
                continue
            box = [l['box'][0]/width, l['box'][1]/height, l['box'][2]/width, l['box'][3]/height]
            row = {'suite_type': typ, 'caption': l['text'], 'anchor_box_normalized': box,
                   'page_number': number, 'page_index': number-1, 'sheet_id': sheet_id}
            if kind == 'suite-details' and ('LAYOUT' in l['text'] or 'PLAN' in l['text'] or 'BED' in l['text']):
                variant = 'VARIATION' in l['text']
                views.append({**row, 'view_kind': 'ceiling' if 'CEILING' in l['text'] else 'floor',
                              'is_variant': variant, 'viewport_boundary_unknown': True})
            elif kind in {'floor-plan', 'ceiling-plan'} and re.fullmatch('SUITE '+TYPE, l['text']):
                instances.append(row)
        pages.append({'page_number': number, 'page_index': number-1, 'sheet_id': sheet_id,
                      'kind': kind, 'width_points': width, 'height_points': height,
                      'suite_instances': instances, 'detail_views': views})
    # Candidate linking is intentionally many-to-many; tower/level exceptions,
    # mirrors and different revisions require geometry/label checks later.
    details = [view for page in pages for view in page['detail_views']]
    links = []
    for page in pages:
        for instance in page['suite_instances']:
            choices = [v for v in details if v['suite_type'] == instance['suite_type'] and
                       v['view_kind'] == 'floor' and not v['is_variant']]
            links.append({'instance': instance, 'candidate_floor_details': choices,
                          'geometry_registration_required': True, 'approved': False,
                          'ambiguous': len(choices) != 1})
    return {'version': 'drawing-set-candidate-index-v1', 'pages': pages, 'links': links,
            'counts': {'pages': len(pages), 'kinds': dict(Counter(p['kind'] for p in pages)),
                       'detail_views': len(details), 'suite_instances': len(links),
                       'instances_with_floor_detail': sum(bool(l['candidate_floor_details']) for l in links)},
            'room_boundaries_inferred': False, 'approved_for_production': False}


def run(pdf, output):
    pdf, output = Path(pdf).resolve(), Path(output).absolute()
    source_sha = sha(pdf)
    plan = {'pdf': str(pdf), 'pdf_sha256': source_sha, 'source_sha256': sha(__file__),
            'text_tool': subprocess.run(['pdftotext', '-v'], capture_output=True, text=True, check=True).stderr.strip(),
            'room_accuracy_measured': False, 'production_promotion': False}
    with output.with_name(output.name+'.claim.json').open('x') as f:
        json.dump(plan, f, indent=2)
    output.mkdir()
    (output/'plan.json').write_text(json.dumps(plan, indent=2)+'\n')
    (output/'drawing_sets.py').write_bytes(Path(__file__).read_bytes())
    try:
        text = subprocess.check_output(['pdftotext', '-bbox-layout', str(pdf), '-'], timeout=30)
        (output/'text.xml').write_bytes(text)
        result = parse(text)
        if sha(pdf) != source_sha or sha(__file__) != plan['source_sha256']:
            raise ValueError('Source changed during indexing')
        (output/'index.json').write_text(json.dumps(result, indent=2)+'\n')
        receipt = {'plan_sha256': sha(output/'plan.json'), 'xml_sha256': sha(output/'text.xml'),
                   'index_sha256': sha(output/'index.json'), 'counts': result['counts'],
                   'room_boundaries_inferred': False, 'approved_for_production': False}
        (output/'completed.json').write_text(json.dumps(receipt, indent=2)+'\n')
        return receipt
    except Exception as e:
        (output/'failure.json').write_text(json.dumps({'error': str(e)})+'\n')
        raise


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pdf', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(run(a.pdf, a.output), indent=2))
