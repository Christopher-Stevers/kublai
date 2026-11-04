#!/usr/bin/env python3
"""Import published Viega MegaPress Stainless article tables, never inferred sizes/prices.
Requires requests, beautifulsoup4, Pillow. Caches source HTML for a reproducible audit.
"""
import concurrent.futures
import hashlib
import io
import json
import re
from collections import Counter
from fractions import Fraction
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from PIL import Image
from press_catalogue_labels import clean_press_row
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE = 'https://www.viega.us/en/products/Catalog/Metal-systems/'
FAMILIES = {
    'MegaPress-316': {'grade': '316', 'seal': 'EPDM'},
    'MegaPress-304-FKM': {'grade': '304', 'seal': 'FKM'},
    'MegaPress-316-FKM': {'grade': '316', 'seal': 'FKM'},
}
CACHE = Path('.tmp/megapress-stainless')
CACHE.mkdir(parents=True, exist_ok=True)

def download(url):
    with requests.Session() as session:
        session.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
        response = session.get(url, timeout=60)
        response.raise_for_status()
        return response

def page(url):
    cached = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.html')
    if not cached.exists():
        cached.write_text(download(url).text)
    return BeautifulSoup(cached.read_text(), 'html.parser')

def text(element):
    return element.get_text(' ', strip=True).replace('\u200b', '').replace('\u00ad', '')

def inch(raw):
    for ch, value in {'½':'1/2', '¼':'1/4', '¾':'3/4', '⅛':'1/8', '⅜':'3/8', '⅝':'5/8', '⅞':'7/8'}.items():
        raw = raw.replace(ch, ' ' + value)
    raw = ' '.join(raw.split())
    assert re.fullmatch(r'\d+(?:/\d+)?(?: \d+/\d+)?', raw), raw
    return raw, sum(float(Fraction(value)) for value in raw.split())

def model(item):
    family, url = item
    spec = FAMILIES[family]
    soup = page(url)
    title = text(soup.find('h1'))
    assert 'MegaPress' in title and ' - Model ' in title, (url, title)
    name, number = title.split(' - Model ')
    # Product-level body material and seal, not certification tables shared by other ranges.
    product = next(json.loads(node.string) for node in soup.select('script[type="application/ld+json"]') if node.string and json.loads(node.string).get('@type') == 'Product')
    body = product['description']
    assert spec['grade'] + ' stainless steel' in body, (url, 'grade missing')
    assert spec['seal'] + ' sealing element' in body, (url, 'seal missing')
    table = soup.select('table')[0]
    headers = [text(cell) for cell in table.select('thead tr')[0].find_all(['th', 'td'])]
    assert 'Part No' in headers and 'Quantity' in headers, (url, headers)
    size_end = next(i for i, h in enumerate(headers) if h.startswith('Wt'))
    connection_indices = [i for i in range(size_end) if re.fullmatch(r'P[123]?(?: \(IPS\)| \(CTS\))?|MPT|FPT|FTG \(IPS\)', headers[i])]
    assert connection_indices and all(i in connection_indices or headers[i] in ['BP', 'BPd', 'L [mm]', 'INDmin [mm]'] for i in range(size_end)), (url, headers)
    connection_headers = [headers[i] for i in connection_indices]
    photo = next(img for img in soup.select('img[src]') if '/PPm' in img['src'])
    variants = [candidate.strip().split() for candidate in photo.get('data-srcset', photo['src'] + ' 0w').split(',')]
    image_url = max(variants, key=lambda candidate: int(candidate[1].removesuffix('w')))[0]
    cached_image = CACHE / (hashlib.sha256(image_url.encode()).hexdigest() + '.image')
    if not cached_image.exists():
        cached_image.write_bytes(download(image_url).content)
    image = Image.open(io.BytesIO(cached_image.read_bytes()))
    image.thumbnail((800, 800))
    output = io.BytesIO()
    image.convert('RGB').save(output, format='WEBP', quality=90)
    raw = output.getvalue()
    sha = hashlib.sha256(raw).hexdigest()
    image_path = Path('public/images/catalog/uploads') / f'part-{sha}.webp'
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(raw)
    image_key = family + ':' + number
    asset = {'path': str(image_path), 'url': f'/api/catalogue/images/part-{sha}.webp', 'sha256': sha, 'byteSize': len(raw), 'sourceUrl': image_url, 'model': number}
    rows = []
    for tr in table.select('tbody tr'):
        cells = [text(cell) for cell in tr.find_all('td', recursive=False)]
        if not cells:
            continue
        assert len(cells) == len(headers), (url, cells, headers)
        sku_raw = cells[headers.index('Part No')]
        sku = sku_raw.split()[0]
        assert re.fullmatch(r'\d{5,}', sku), (url, cells)
        availability = 'Available while supplies last' if '*)' in sku_raw else 'Listed in manufacturer catalogue'
        if '*)' in sku_raw:
            assert 'Available while supplies last' in text(soup), url
        dimensions = [inch(cells[i]) for i in connection_indices]
        connection_label = ' x '.join(re.sub(r'^P[123]?(?= |$)', 'Press', h).replace('FTG (IPS)', 'FTG') for h in connection_headers)
        size = ' x '.join(v[0] + '"' for v in dimensions)
        if len(set(v[0] for v in dimensions)) == 1:
            size = dimensions[0][0] + '"'
        short_name = name.removeprefix('Viega MegaPress ')
        length_note = f", L {cells[headers.index('L [mm]')]} mm" if 'L [mm]' in headers[:size_end] else ''
        material = f"MegaPress Stainless {spec['grade']} ({spec['seal']})"
        display_name = f"Viega MegaPress Stainless {spec['grade']} {spec['seal']} {short_name} {size} ({connection_label}{length_note}) - {number} - {sku}"
        rows.append({
            'sku': sku, 'model': number, 'family': family, 'grade': spec['grade'], 'seal': spec['seal'],
            'displayName': display_name, 'sizeLabel': size, 'sizeNominal': max(v[1] for v in dimensions),
            'connections': dict(zip(connection_headers, [v[0] + '"' for v in dimensions])),
            'articleData': dict(zip(headers, cells)), 'sourceUrl': url, 'imageKey': image_key,
            'category': 'Fitting', 'material': material, 'availability': availability, 'manufacturerDescription': body,
            'description': f"Viega MegaPress Stainless {spec['grade']}, {spec['seal']} seals. Model {number}. Connections: " + ', '.join(f'{h} {v[0]} in' for h, v in zip(connection_headers, dimensions)) + f'. Manufacturer part number {sku}. {availability}.',
            'aliases': [f'Viega {sku}', f'MegaPress {sku}', f'Mega Press Stainless {short_name} {size}', f'MegaPress SS {spec["grade"]} {short_name} {size}', f'{material} {short_name} {size}', f'{name} {size} {number}'],
        })
    assert rows, url
    return [clean_press_row(row) for row in rows], image_key, asset

def main():
    models = []
    for family in FAMILIES:
        base = BASE + family
        categories = sorted(set(urljoin(base + '.html', a['href']) for a in page(base + '.html').select('a[href]') if a['href'].startswith('/en/products/Catalog/Metal-systems/' + family + '/')))
        assert len(categories) == 8, (family, categories)
        for category in categories:
            for a in page(category).select('a[href]'):
                link = urljoin(category, a['href'])
                if link.startswith(category[:-5] + '/') and link.endswith('.html'):
                    models.append((family, link))
    models = sorted(set(models))
    rows, images, model_counts = [], {}, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for new_rows, key, asset in pool.map(model, models):
            rows.extend(new_rows)
            images[key] = asset
            model_counts[key] = len(new_rows)
            print(key, len(new_rows), flush=True)
    assert len({r['sku'] for r in rows}) == len(rows)
    counts = dict(Counter(r['family'] for r in rows))
    assert set(counts) == set(FAMILIES)
    Path('data/catalogue/megapress-stainless.json').write_text(json.dumps({'sourceUrls': [BASE + f + '.html' for f in FAMILIES], 'families': FAMILIES, 'counts': counts, 'modelCounts': model_counts, 'rows': rows, 'images': images}, indent=2) + '\n')
    print('TOTAL', len(rows), 'MODELS', len(images), counts)

if __name__ == '__main__':
    main()
