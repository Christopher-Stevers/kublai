"""Build black Class 300 malleable fittings from ASC's explicit current SKU rows.

Requires requests, beautifulsoup4, xlrd, Pillow and Poppler pdfimages. The builder
only reads the manufacturer catalogue and writes a manifest/image assets; it does
not connect to the database. No size-range expansion or invented article numbers.
"""
import hashlib
import io
import json
import math
import re
import subprocess
from collections import Counter
from datetime import date
from fractions import Fraction
from pathlib import Path

import requests
import xlrd
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CACHE = Path('.tmp/threaded-black300')
OUT = Path('data/catalogue/threaded-black300.json')
SHEET_URL = 'https://s3.us-east-1.amazonaws.com/ue1.asc-es.com/price-sheets/excel/PF.MI-7.25-website.xls'
PRICE_PAGE = 'https://www.asc-es.com/price-sheets/iron-fittings/anvil-malleable-iron-fittings-unions'
CATALOGUE_URL = 'https://s3.us-east-2.amazonaws.com/asc-es.com/resources/literature/ASC-CAT-Pipe-Fittings-Submittal-Catalog-v01.pdf'
J3300_URL = 'https://s3.us-east-2.amazonaws.com/asc-es.com/resources/submittals/10008_PF-SUB-J-3300.pdf'

# model: clean type, manufacturer product page, photograph PDF product page,
# embedded image number on page 1, connection genders. Photograph selections were
# visually checked against the model labels on the source PDF pages.
MODELS = {
    '1161': ('90° Elbow', '1161-90-elbow-straight', '1161-90-elbow-straight', 0, ['FNPT', 'FNPT']),
    '1161R': ('90° Reducing Elbow', '1161r-90-reducing-elbow', '1161-90-elbow-straight', 2, ['FNPT', 'FNPT']),
    '1162': ('45° Elbow', '1162-45-elbow', '1162-45-elbow', 0, ['FNPT', 'FNPT']),
    '1160': ('45° Street Elbow', '1160-45-street-elbow', '1162-45-elbow', 2, ['FNPT', 'MNPT']),
    # ASC's 1170 page accidentally links the 1160/1162 PDF. The 1164/1170
    # submittal explicitly identifies the correct 90-degree street photograph.
    '1170': ('90° Street Elbow', '1170-90-street-elbow', '1164-straight-tee', 0, ['FNPT', 'MNPT']),
    '1164': ('Tee', '1164-straight-tee', '1164-straight-tee', 2, ['FNPT'] * 3),
    '1164R': ('Reducing Tee', '1164r-reducing-tee', '1164r-reducing-tee', 0, ['FNPT'] * 3),
    '1165': ('Cross', '1165-cross', '1165-cross', 0, ['FNPT'] * 4),
    '1166': ('Coupling', '1166-coupling', '1165-cross', 2, ['FNPT'] * 2),
    '1167': ('Reducing Coupling', '1167-reducer', '1167-reducer', 0, ['FNPT'] * 2),
    '1163': ('Cap', '1163-cap', '1163-cap', 0, ['FNPT']),
    '390': ('Square Countersunk Plug', None, '1163-cap', 2, ['MNPT']),
    '459': ('Bronze-to-Iron Seat Union', '459-class-300-union', '552-90-elbow-female-union', 2, ['FNPT'] * 2),
    '551': ('Male x Female Union', '551-male-and-female-union', '552-90-elbow-female-union', 4, ['MNPT', 'FNPT']),
    '552': ('90° Elbow Female Union', '552-90-elbow-female-union', '552-90-elbow-female-union', 0, ['FNPT'] * 2),
    '832': ('Bronze-to-Bronze Seat Dart Union', '832-dart-union-brz-to-brz-seat-union', '832-dart-union-brz-to-brz-seat-union', 0, ['FNPT'] * 2),
}


def fetch(url, filename=None):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / (filename or hashlib.sha256(url.encode()).hexdigest() + '.source')
    if not target.exists():
        session = requests.Session()
        session.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
        response = session.get(url, timeout=60)
        response.raise_for_status()
        target.write_bytes(response.content)
    return target.read_bytes()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def size(raw):
    # ASC's spreadsheet writes 1-1/4 as 11/4 and 2-1/2 as 21/2.
    value = re.sub(r'^(\d+)([123])/([248])$', r'\1 \2/\3', raw.replace('-', ' '))
    nominal = sum(Fraction(v) for v in value.split())
    assert Fraction(1, 8) <= nominal <= 4, raw
    whole, remainder = divmod(nominal.numerator, nominal.denominator)
    label = str(whole) if not remainder else (f'{whole} ' if whole else '') + f'{remainder}/{nominal.denominator}'
    return label + '"', float(nominal)


def collect_rows():
    sheet = xlrd.open_workbook(file_contents=fetch(SHEET_URL, 'source.xls')).sheet_by_index(0)
    assert sheet.row_values(1)[1:6] == ['12 Digit UPC', '10 Digit Part Number', 'P.C.', 'Figure No.', 'DESCRIPTION']
    result, excluded = [], []
    for i in range(2, sheet.nrows):
        cells = sheet.row_values(i)
        model, description = cells[4], cells[5]
        if ' BLK ' not in description:
            continue
        if model == 'J-3300':
            excluded.append({'manufacturer': 'Anvil / ASC', 'sku': cells[2], 'model': model,
                             'manufacturerDescription': description, 'sourceUrl': SHEET_URL,
                             'sourceSheet': sheet.name, 'sourceRow': i + 1,
                             'reason': 'Exact manufacturer photograph is only 236 x 220 native pixels; omitted from this quality-photo import.'})
            continue
        if model not in MODELS:
            continue
        fitting, page, _, _, ends = MODELS[model]
        trimmed = re.sub(r'^(?:G552|G551|459)\s+', '', description)
        raw_size = trimmed.split()[0]
        sizes = [size(s) for s in raw_size.split('X')]
        if model in {'1161R', '1167'}:
            assert len(sizes) == 2 and sizes[0][1] > sizes[1][1], description
        elif model == '1164R':
            assert len(sizes) == 3 and len(set(sizes)) > 1, description
        else:
            assert len(sizes) == 1, description
        label = ' x '.join(s[0] for s in sizes)
        connections = sizes * len(ends) if len(sizes) == 1 else sizes
        assert len(connections) == len(ends), description
        name = f'{label} Black 300# Malleable Iron Threaded {fitting}'
        row = {'family': 'black-300-threaded', 'manufacturer': 'Anvil / ASC', 'sku': cells[2],
               'model': model, 'upc': cells[1], 'manufacturerDescription': description,
               'sourceUrl': SHEET_URL, 'sourceSheet': sheet.name, 'sourceRow': i + 1,
               'productPage': 'https://www.asc-es.com/products/' + (page or '1163-cap'),
               'displayName': name, 'description': name, 'material': 'Black 300#',
               'category': 'Threaded Fittings', 'connectionType': 'Threaded',
               'connectionSizes': [s[0] for s in connections], 'connectionEnds': ends,
               'sizeLabel': label, 'sizeNominal': max(s[1] for s in sizes), 'fittingType': fitting,
               'pressureClass': '300', 'finish': 'Black', 'imageKey': f'asc-black300:{model}',
               'standard': 'ASTM A197; ASME B1.20.1; ' + ('ASME B16.39' if 'Union' in fitting else 'ASME B16.14' if model == '390' else 'ASME B16.3')}
        extra = ['Black malleable iron', '300# black fittings', 'Class 300', 'Extra Heavy XH XS',
                 'NPT', ' x '.join(f'{s[0]} {end}' for s, end in zip(connections, ends))]
        if model in {'459', '551', '552'}:
            extra.append('Bronze-to-Iron Seat')
        if model == '459':
            extra.append('Lead Free LF')
        if model == '1167':
            extra.append('Reducer')
        row['aliases'] = list(dict.fromkeys([row['manufacturer'], 'Anvil', 'ASC Engineered Solutions', row['sku'],
                           'Anvil ' + row['sku'], 'ASC ' + row['sku'], row['upc'], 'Figure ' + model,
                           description, name.replace('300#', 'Class 300')] + extra))
        assert all(0 < len(a) <= 255 for a in [name] + row['aliases']), row
        result.append(row)
    assert len({r['sku'] for r in result}) == len(result)
    assert len({r['displayName'] for r in result}) == len(result)
    assert len(result) == 176 and len(excluded) == 6
    return result, excluded


def photos():
    images, sources, extracted = {}, {}, set()
    for model, (fitting, _, slug, index, _) in MODELS.items():
        page_url = 'https://www.asc-es.com/products/' + slug
        page = BeautifulSoup(fetch(page_url, slug + '.html'), 'html.parser')
        # Read this attribute instead of navigating inside the site's Vue templates.
        resource = json.loads(page.select_one('submittal-widget')['submittal-file-url'])[0]
        url = 'https://www.asc-es.com' + resource
        pdf = fetch(url, slug + '.pdf')
        assert pdf.startswith(b'%PDF'), url
        sources[url] = {'url': url, 'sha256': digest(pdf)}
        if slug not in extracted:
            subprocess.run(['pdfimages', '-f', '1', '-l', '1', '-png', str(CACHE / (slug + '.pdf')),
                            str(CACHE / ('extract-' + slug))], check=True, capture_output=True)
            extracted.add(slug)
        filename = CACHE / f'extract-{slug}-{index:03}.png'
        maskfile = CACHE / f'extract-{slug}-{index + 1:03}.png'
        raw, maskraw = filename.read_bytes(), maskfile.read_bytes()
        im = Image.open(io.BytesIO(raw)).convert('RGBA')
        im.putalpha(Image.open(io.BytesIO(maskraw)).convert('L'))
        native = im.size
        assert max(native) >= 375, (model, native)
        im.thumbnail((800, 800), Image.Resampling.LANCZOS)
        edge = math.ceil(max(im.size) / .8)
        canvas = Image.new('RGBA', (edge, edge), 'white')
        canvas.alpha_composite(im, ((edge - im.width) // 2, (edge - im.height) // 2))
        output = io.BytesIO()
        canvas.convert('RGB').save(output, format='WEBP', quality=94)
        data = output.getvalue()
        sha = digest(data)
        target = Path('public/images/catalog/uploads') / ('part-' + sha + '.webp')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        notes = ('Exact manufacturer Class 300 fitting-family photograph, representative across listed sizes. '
                 'Embedded source pixels and alpha mask extracted intact from submittal page 1. '
                 'White framing added to keep the complete part visible; no cropping or upscaling.')
        if model == '1170':
            notes += ' The manufacturer 1170 webpage has a mislabeled title and links a 45-degree elbow PDF; the correct 1170 photograph comes from the explicitly labeled 1164/1170 PDF.'
        if model == '390':
            notes += ' The current spreadsheet omits the pressure class in its description; the matching Fig. 390 submittal explicitly identifies it as Class 300.'
        images['asc-black300:' + model] = {'path': str(target), 'url': '/api/catalogue/images/' + target.name,
             'sha256': sha, 'byteSize': len(data), 'width': edge, 'height': edge,
             'sourceUrl': url + '#page=1', 'sourcePage': page_url, 'sourceSha256': digest(pdf),
             'sourceWidth': native[0], 'sourceHeight': native[1], 'sourceImageSha256': digest(raw),
             'sourceMaskSha256': digest(maskraw), 'sourceImageIndex': index, 'imageKind': 'product-photo',
             'notes': notes}
    return images, list(sources.values())


def contact_sheet(images):
    canvas = Image.new('RGB', (1200, math.ceil(len(images) / 4) * 360), 'white')
    draw = ImageDraw.Draw(canvas)
    for i, (key, meta) in enumerate(images.items()):
        photo = Image.open(meta['path'])
        photo.thumbnail((290, 290))
        x, y = (i % 4) * 300, (i // 4) * 360
        canvas.paste(photo, (x + (300 - photo.width) // 2, y))
        model = key.split(':')[-1]
        draw.text((x + 10, y + 295), key, fill='black')
        draw.text((x + 10, y + 312), MODELS[model][0], fill='black')
        draw.text((x + 10, y + 332), f'Native {meta["sourceWidth"]} x {meta["sourceHeight"]}', fill='black')
    canvas.save(CACHE / 'final-contact-sheet.jpg', quality=95)


if __name__ == '__main__':
    rows, excluded = collect_rows()
    images, sources = photos()
    sources.insert(0, {'url': SHEET_URL, 'sha256': digest(fetch(SHEET_URL, 'source.xls')),
                       'listingPage': PRICE_PAGE, 'effectiveDate': '2025-07-21'})
    sources.append({'url': J3300_URL, 'sha256': digest(fetch(J3300_URL, 'j3300.pdf')),
                    'notes': 'Reviewed for the six excluded all-iron unions; exact family photograph is only 236 x 220 pixels.'})
    doc = {'sourceDate': date.today().isoformat(), 'counts': dict(Counter(r['family'] for r in rows)),
           'coverageByType': dict(Counter(r['fittingType'] for r in rows)), 'sources': sources,
           'notes': ['Only explicit black-finish Class 300 article rows from the current manufacturer spreadsheet are imported; galvanized, Class 150 and Class 250 fittings are excluded.',
                     'Manufacturer article numbers, UPCs, shorthand descriptions, figure identifiers, and auxiliary information are searchable aliases or metadata rather than displayed product descriptions.',
                     'Size gaps in the current spreadsheet are preserved even when older catalogue dimension tables show more sizes.'],
           'exclusions': excluded, 'rows': rows, 'images': images}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    contact_sheet(images)
    print(json.dumps({'rows': len(rows), 'images': len(images), 'excluded': len(excluded),
                      'types': doc['coverageByType']}, indent=2))
