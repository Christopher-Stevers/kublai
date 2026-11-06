"""Build stainless threaded fittings from explicit Merit Brass article listings.

Requires requests, beautifulsoup4 and Pillow. Each article retains its source URL,
exact supplier description/SKU and reviewed native manufacturer photograph. No
size ranges are expanded and no pipe nipples, butt-weld or socket-weld articles
are imported. Hex fitting nipples are deliberately distinct from pipe nipples.
"""
import concurrent.futures
import hashlib
import io
import json
import re
import textwrap
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CACHE = Path('.tmp/threaded-stainless')
OUT = Path('data/catalogue/threaded-stainless.json')
BASE = 'https://order.meritbrass.com'
CATALOGUE = 'https://www.meritbrass.com/uploads/docs/PDF/Stainless-Steel-Catalog.pdf'
FORGED_DIMENSIONS = 'https://www.meritbrass.com/uploads/docs/PDF/Stainless-Steel-3000LB-Threaded-Fittings-Dimensions.pdf'
CATEGORIES = {
    'stainless-threaded-standard': '5637150781',
    'stainless-threaded-mss': '5637150826',
    'stainless-forged-threaded': '5637150889',
    'stainless-barstock-threaded': '5637150759',
}


def fetch(url, image=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest() + ('.image' if image else '.source'))
    if not target.exists():
        session = requests.Session()
        session.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
        response = session.get(url, timeout=60)
        response.raise_for_status()
        target.write_bytes(response.content)
    return target.read_bytes()


def listing(item):
    family, page = item
    url = f'{BASE}/Catalog/ProductList?CurrentPage={page}&CategoryId={CATEGORIES[family]}'
    doc = BeautifulSoup(fetch(url), 'html.parser')
    records = []
    for box in doc.select('.productList-box'):
        titles = box.select('.title a')
        assert len(titles) == 2, url
        sku, description = [a.get_text(' ', strip=True) for a in titles]
        records.append({'family': family, 'sku': sku, 'manufacturerDescription': description,
                        'sourceUrl': urljoin(BASE, titles[0]['href']), 'listingUrl': url,
                        'imageSourceUrl': urljoin(BASE, box.select_one('img')['src'])})
    pages = {int(parse_qs(urlparse(a['href']).query)['CurrentPage'][0]) for a in doc.select('a[href*="CurrentPage="]')}
    if len(records) < 20:
        pages = {p for p in pages if p <= page}
    print('Merit', family, page, len(records), flush=True)
    return records, {(family, p) for p in pages}


def collect():
    saved = CACHE / 'merit-records.json'
    if saved.exists():
        return json.loads(saved.read_text())
    records, visited, pending = [], set(), {(f, 1) for f in CATEGORIES}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        while pending:
            batch = sorted(pending - visited)
            pending = set()
            for item, (rows, pages) in zip(batch, pool.map(listing, batch)):
                visited.add(item)
                records.extend(rows)
                pending |= pages - visited
    assert len({r['sku'].upper() for r in records}) == len(records)
    saved.write_text(json.dumps(records, indent=2) + '\n')
    return records


def size(raw):
    value = sum(Fraction(n) for n in raw.strip().replace('"', '').replace("'", '').replace('-', ' ').split())
    assert Fraction(1, 8) <= value <= 6, raw
    whole, rem = divmod(value.numerator, value.denominator)
    label = str(whole) if not rem else (f'{whole} ' if whole else '') + f'{rem}/{value.denominator}'
    return label, float(value)


def normalize(source):
    row = dict(source)
    desc = ' '.join(row['manufacturerDescription'].split())
    upper, model = desc.upper(), row['sku'].split('-')[0].upper()
    # All listings put the nominal inch size(s) before the rating/grade.
    sizes_raw = re.split(r'\s+(?:150#|1000#|3000#|3M/1M#|3M#|(?:T-?)?(?:304|316))', desc, maxsplit=1, flags=re.I)[0]
    sizes_raw = re.sub(r'[xX]\s*[xX]', 'x', sizes_raw)
    sizes = [size(s) for s in re.split(r'\s*[xX]\s*', sizes_raw)]
    assert len(sizes) <= 3, row
    grade_match = re.search(r'(304|316)(?:/(?:304|316)?L)?', upper)
    assert grade_match, row
    grade = grade_match[0]
    if '/' in grade:
        grade = grade_match[1] + '/' + grade_match[1] + 'L'
    if '90 STREET' in upper:
        fitting = '90° Street Elbow'
    elif '90 ELL' in upper or '90 ELBOW' in upper:
        fitting = '90° Elbow'
    elif '45 ELL' in upper or '45 ELBOW' in upper:
        fitting = '45° Elbow'
    elif 'HEX NIP' in upper or 'HX NIP' in upper or 'HXNIP' in upper:
        fitting = 'Reducing Hex Nipple' if len(sizes) > 1 else 'Hex Nipple'
    elif 'TEE' in upper:
        fitting = 'Reducing Tee' if len(sizes) > 1 else 'Tee'
        if len(sizes) == 2:
            sizes = [sizes[0], sizes[0], sizes[1]]
    elif 'CROSS' in upper:
        fitting = 'Cross'
    elif 'HALF COUPLING' in upper:
        fitting = 'Half Coupling'
    elif 'COUPLING' in upper or model == 'KP611':
        fitting = 'Reducing Coupling' if len(sizes) > 1 else 'Coupling'
    elif 'HEX BUSHING' in upper:
        fitting = 'Hex Bushing'
    elif 'COUNTERSUNK PLUG' in upper:
        fitting = 'Hex-Socket Countersunk Plug'
    elif 'HEX HEAD PLUG' in upper:
        fitting = 'Hex-Head Plug'
    elif 'PLUG' in upper:
        assert re.search(r'(SQUARE|SQ|SQE) HEAD', upper), row
        fitting = ('Cored ' if 'CORED' in upper else 'Solid ' if 'SOLID' in upper else '') + 'Square-Head Plug'
    elif 'CAP' in upper:
        fitting = 'Cap'
    elif 'LOCKNUT' in upper:
        fitting = 'Locknut'
    elif 'SPUD/TANK FLANGE' in upper:
        fitting = 'Welding Spud / Tank Flange'
    elif 'UNION' in upper:
        fitting = 'Union'
    else:
        raise ValueError(row)
    if fitting in ['Reducing Coupling', 'Hex Bushing', 'Reducing Hex Nipple']:
        assert len(sizes) == 2 and sizes[0][1] > sizes[1][1], row
    elif fitting == 'Reducing Tee':
        assert len(sizes) == 3 and sizes[0] == sizes[1] and sizes[0][1] > sizes[2][1], row
    else:
        assert len(sizes) == 1, row
    suffix = row['sku'].split('-')[1]
    assert re.fullmatch(r'(?:\d{2}){1,3}', suffix), row
    sku_sizes = [int(suffix[i:i+2]) / 16 for i in range(0, len(suffix), 2)]
    if fitting == 'Reducing Tee' and len(sku_sizes) == 2:
        sku_sizes = [sku_sizes[0], sku_sizes[0], sku_sizes[1]]
    assert sku_sizes == [v[1] for v in sizes], (row, sku_sizes, sizes)
    forged = row['family'] == 'stainless-forged-threaded'
    barstock = row['family'] == 'stainless-barstock-threaded'
    if forged:
        pressure = '3000/1000' if '3M/1M#' in upper else '3000'
        construction, pattern = 'Forged', None
        standard = 'ASTM A182; ASME B16.11' if fitting != 'Union' else 'ASTM A182; MSS SP-83'
    elif barstock:
        pressure, construction, pattern, standard = '1000', 'Barstock', None, 'ASTM A182'
    elif row['family'] == 'stainless-threaded-mss':
        pressure, construction, pattern, standard = '150', 'Cast', 'MSS Pattern', 'MSS SP-114'
    else:
        pressure, construction = '150', 'Cast'
        pattern = 'Industry Pattern' if model.startswith('KP') else 'Heat-Treated' if model.startswith(('KMC', 'KMM')) else 'ISO Pattern'
        standard = 'ISO 49 (dimensional pattern)' if pattern == 'ISO Pattern' else None
    thread = 'NPSL' if fitting == 'Locknut' else 'Weld x NPT' if fitting == 'Welding Spud / Tank Flange' else 'NPT'
    rating_label = '3M/1M' if pressure == '3000/1000' else f'Class {pressure}'
    detail = construction if forged or barstock else pattern
    size_label = ' x '.join(s[0] + '"' for s in sizes)
    name = f'{size_label} {grade} Stainless Steel {rating_label} {detail} {thread} {fitting}'
    row.update({'manufacturer': 'Merit Brass', 'model': model, 'displayName': name, 'description': name,
                'grade': grade, 'material': 'Stainless steel',
                'category': 'Forged Threaded Fittings' if forged else 'Threaded Fittings',
                'connectionType': 'Threaded', 'threadStandard': thread, 'pattern': pattern,
                'construction': construction, 'standard': standard, 'pressureClass': pressure,
                'sizeLabel': size_label, 'sizeNominal': max(s[1] for s in sizes),
                'connectionSizes': [s[0] + '"' for s in sizes], 'fittingType': fitting,
                'imageKey': 'merit-threaded:' + hashlib.sha256(row['imageSourceUrl'].encode()).hexdigest()[:20]})
    if pressure == '3000/1000':
        row['ratingSourceNote'] = 'Manufacturer article explicitly labels this fitting 3M/1M#. The dual designation is retained rather than asserting one standalone pressure class.'
    aliases = ['Merit Brass', row['sku'], model, f'Merit Brass {row["sku"]}', row['manufacturerDescription'], desc,
               f'Merit Brass {name}', name.replace('Stainless Steel', 'SS'),
               f'{size_label} {grade} Stainless Steel {pressure}# Threaded {fitting}']
    if fitting in ['Tee', 'Reducing Tee'] and len(sizes) == 3:
        aliases.append(f'{sizes[0][0]}" x {sizes[2][0]}" {grade} Stainless Steel {pressure}# Reducing Tee')
    if re.search(r'\bCF8M?\b', upper):
        aliases.append(re.search(r'\bCF8M?\b', upper)[0])
    row['aliases'] = list(dict.fromkeys(a for a in aliases if a))
    assert all(0 < len(s) <= 255 for s in [name] + row['aliases']), row
    return row


def build_images(rows):
    representatives = {r['imageKey']: r for r in rows}
    images = {}
    for key, row in sorted(representatives.items()):
        raw = fetch(row['imageSourceUrl'], image=True)
        photo = Image.open(io.BytesIO(raw)).convert('RGBA')
        source_size = photo.size
        assert min(photo.size) >= 400, (row['sku'], photo.size)
        photo.thumbnail((800, 800))
        edge = int(max(photo.size) / .80 + .999)
        canvas = Image.new('RGBA', (edge, edge), 'white')
        canvas.alpha_composite(photo, ((edge-photo.width)//2, (edge-photo.height)//2))
        output = io.BytesIO()
        canvas.convert('RGB').save(output, format='WEBP', quality=94)
        content = output.getvalue()
        sha = hashlib.sha256(content).hexdigest()
        path = Path('public/images/catalog/uploads') / f'part-{sha}.webp'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        images[key] = {'path': str(path), 'url': f'/api/catalogue/images/part-{sha}.webp',
                       'sha256': sha, 'byteSize': len(content), 'width': edge, 'height': edge,
                       'sourceUrl': row['imageSourceUrl'], 'sourcePage': row['sourceUrl'],
                       'sourceSha256': hashlib.sha256(raw).hexdigest(),
                       'sourceWidth': source_size[0], 'sourceHeight': source_size[1],
                       'imageKind': 'product-photo',
                       'notes': 'Official Merit Brass product-family photograph, representative across published sizes and grades of the listed fitting. Native photograph retained intact with white breathing room; no cropping, generated content or pixel upscaling.'}
    return images


def contact_sheets(rows, images):
    index = []
    font = ImageFont.truetype('/usr/share/fonts/liberation/LiberationSans-Regular.ttf', 16)
    font_small = ImageFont.truetype('/usr/share/fonts/liberation/LiberationSans-Regular.ttf', 14)
    for key, meta in sorted(images.items()):
        sample = next(r for r in rows if r['imageKey'] == key)
        index.append({'index': len(index), 'key': key, 'sku': sample['sku'], 'type': sample['fittingType'],
                      'description': sample['displayName'], 'imagePath': meta['path'],
                      'sourceUrl': meta['sourceUrl'], 'nativeResolution': [meta['sourceWidth'], meta['sourceHeight']]})
    for start in range(0, len(index), 16):
        batch = index[start:start+16]
        canvas = Image.new('RGB', (1280, 1440), '#eeeeee')
        draw = ImageDraw.Draw(canvas)
        for i, record in enumerate(batch):
            col, row = i % 4, i // 4
            x, y = col * 320, row * 360
            photo = Image.open(record['imagePath']).convert('RGB')
            photo.thumbnail((300, 275))
            canvas.paste(photo, (x + (320-photo.width)//2, y))
            draw.text((x+6, y+277), f'{record["index"]}: {record["sku"]} • {record["nativeResolution"][0]}×{record["nativeResolution"][1]} native', fill='black', font=font)
            draw.text((x+6, y+298), record['type'], fill='black', font=font)
            draw.multiline_text((x+6, y+319), '\n'.join(textwrap.wrap(record['key'], width=39)), fill='black', font=font_small)
        canvas.save(CACHE / f'review-photos-{start//16+1}.jpg', quality=94)
    (CACHE / 'photo-review-index.json').write_text(json.dumps(index, indent=2) + '\n')


if __name__ == '__main__':
    records = collect()
    excluded_skus = {'612B-6432', '612B-6448'}
    excluded = [{**r, 'reason': 'Manufacturer description omits the reducing outlet size. SKU suggests a size, but no unambiguous dimensional article was verified; omitted rather than inferred.'} for r in records if r['sku'].upper() in excluded_skus]
    rows = [normalize(row) for row in records if row['sku'].upper() not in excluded_skus]
    assert len({r['sku'].upper() for r in rows}) == len(rows)
    duplicates = {n: c for n, c in Counter(r['displayName'] for r in rows).items() if c > 1}
    assert not duplicates, duplicates
    images = build_images(rows)
    sources = [{'url': url, 'sha256': hashlib.sha256(fetch(url)).hexdigest()} for url in [CATALOGUE, FORGED_DIMENSIONS]]
    sources += [{'url': f'{BASE}/Catalog/ProductList?CategoryId={category}', 'role': 'Live manufacturer article listings, exact SKU entries only'} for category in CATEGORIES.values()]
    counts = dict(Counter(r['family'] for r in rows))
    OUT.write_text(json.dumps({'sourceDate': '2026-11-05', 'counts': counts,
                              'sources': sources, 'excluded': excluded, 'rows': rows, 'images': images}, indent=2) + '\n')
    contact_sheets(rows, images)
    print('Rows', len(rows), 'Images', len(images), 'Counts', counts)
