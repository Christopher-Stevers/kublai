"""Build weld fittings only from explicit manufacturer article rows; never expand ranges."""
import concurrent.futures
import hashlib
import io
import json
import re
import subprocess
from collections import Counter
from fractions import Fraction
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup
from PIL import Image
import openpyxl
import xlrd
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CACHE = Path('.tmp/weld-fittings')
CACHE.mkdir(parents=True, exist_ok=True)
OUT = Path('data/catalogue/weld-fittings.json')
WB_URL = 'https://www.weldbend.com/PriceSheet_1126.xlsx'
ASC_URL = 'https://s3.us-east-1.amazonaws.com/ue1.asc-es.com/price-sheets/excel/CSF-6.26-website.xls'
MERIT_BASE = 'https://order.meritbrass.com'
MERIT_CATEGORIES = {'stainless-butt-weld': '5637150929', 'stainless-socket-weld': '5637150858'}
WB_CATALOGUE = 'https://www.weldbend.com/catalog.pdf'
MERIT_CATALOGUE = 'https://www.meritbrass.com/uploads/docs/PDF/Stainless-Steel-Catalog.pdf'
ASC_PAGES = {
    '2126':'2126-socket-weld-union', '2128':'2128-socket-weld-union',
    '2150':'2150-90-elbow', '2151':'2151-45-elbow', '2152':'2152-tee', '2153':'2153-crosse',
    '2154':'2154-couplings', '2155':'2155-half-couplings', '2156':'2156-reducing-couplings',
    '2157':'2157-pipe-caps', '2158':'2158-laterals', '2159':'2159-reducer-insert-type-1',
    '2170':'2170-90-elbows', '2171':'2171-45-elbows', '2172':'2172-tee', '2173':'2173-crosses',
    '2174':'2174-couplings', '2175':'2175-half-couplings', '2176':'2176-reducing-couplings',
    '2177':'2177-pipe-caps', '2178':'2178-laterals', '2179':'2179sch160-reducer-insert-type-2',
}
WB_TYPES = {
    'LR 90 Deg ELBOWS': ('90° Long-Radius Elbow', 26),
    'SR 90 Deg ELBOWS': ('90° Short-Radius Elbow', 29),
    'LR 45 Deg ELBOWS': ('45° Long-Radius Elbow', 38),
    'LR 180 Deg RETURN BENDS': ('180° Long-Radius Return Bend', 43),
    'SR 180 Deg RETURN BENDS': ('180° Short-Radius Return Bend', 46),
    'STRAIGHT TEES': ('Tee', 49), 'REDUCING TEES': ('Reducing Tee', 52),
    'CONC REDUCERS': ('Concentric Reducer', 62), 'ECC REDUCERS': ('Eccentric Reducer', 62),
    'CAPS': ('Cap', 76), 'STUB ENDS': ('Lap-Joint Stub End', 79),
}
ASC_TYPES = {'0': '90° Elbow', '1': '45° Elbow', '2': 'Tee', '3': 'Cross', '4': 'Coupling',
             '5': 'Half Coupling', '6': 'Reducing Coupling', '7': 'Cap', '8': '45° Lateral', '9': 'Reducer Insert'}


def size(raw, asc=False):
    raw = raw.strip().replace('"', '').replace('-', ' ')
    if asc:
        raw = re.sub(r'^(\d+)([123])/([248])$', r'\1 \2/\3', raw)
    value = sum(Fraction(v) for v in raw.split())
    assert Fraction(1, 8) <= value <= 60, raw
    whole, remainder = divmod(value.numerator, value.denominator)
    label = str(whole) if not remainder else (f'{whole} ' if whole else '') + f'{remainder}/{value.denominator}'
    return label, float(value)


def finish(row, sizes, fitting, wall=None, pressure=None):
    assert bool(wall) != bool(pressure), row
    if fitting in ['Tee', 'Reducing Tee', '45° Lateral'] and len(sizes) == 2:
        sizes = [sizes[0], sizes[0], sizes[1]]
    if len(set(sizes)) > 1 and fitting in ['Tee', '90° Elbow', '45° Lateral']:
        fitting = 'Reducing ' + fitting
    if len(sizes) == 1 and fitting in ['Reducing Tee', 'Reducing Coupling', 'Concentric Reducer', 'Eccentric Reducer', 'Reducer Insert']:
        raise ValueError('Missing reduction sizes: ' + str(row))
    size_label = ' x '.join(s[0] + '"' for s in sizes)
    grade = row.get('grade')
    material_label = (grade + ' Stainless Steel') if grade else 'Carbon Steel'
    connection = 'Butt-Weld' if 'butt-weld' in row['family'] else 'Socket-Weld'
    rating = wall or f'Class {pressure}'
    name = f'{size_label} {material_label} {rating} {connection} {fitting}'
    row.update({'displayName': name, 'description': name, 'material': 'Stainless steel' if grade else 'Carbon Steel',
                'category': connection + ' Fittings', 'connectionType': connection, 'sizeLabel': size_label,
                'sizeNominal': max(v[1] for v in sizes), 'connectionSizes': [v[0] + '"' for v in sizes],
                'fittingType': fitting, 'wall': wall, 'pressureClass': pressure})
    row['aliases'] = list(dict.fromkeys([row['manufacturer'], row['sku'], f"{row['manufacturer']} {row['sku']}",
                                      row['manufacturerDescription'],
                                      f"{row['manufacturer']} {name}",
                                      name.replace('Butt-Weld', 'BW').replace('Socket-Weld', 'SW')] +
                                     ([f"Anvil {row['sku']}", f"ASC {row['sku']}", f"Figure {row['model']}", row['upc']] if row['manufacturer'] == 'Anvil / ASC' else [])))
    assert all(len(s) <= 255 for s in [name] + row['aliases']), row
    return row


def weldbend_rows():
    book = openpyxl.load_workbook(io.BytesIO(fetch(WB_URL)), read_only=True, data_only=True)
    sheet = book['PriceSheetItems']
    assert list(next(sheet.values)) == ['Weldbend Part Number', 'Display Name', 'List Price']
    result = []
    for number, (sku, description, _) in enumerate(list(sheet.values)[1:], 2):
        if 'Class' in description:
            continue  # Flanges have their own catalogue scope.
        m = re.fullmatch(r'(.+?)\s+(Std|XS|XXS|S\s*160)\s+(.+)', ' '.join(description.split()))
        assert m, description
        sizes_raw, wall_raw, product = m.groups()
        fitting, page = WB_TYPES[product]
        # Both reducer styles share a page; the second embedded image is eccentric.
        image_index = 1 if fitting == 'Eccentric Reducer' else 0
        row = {'family': 'carbon-butt-weld', 'manufacturer': 'Weldbend', 'sku': str(sku),
               'manufacturerDescription': description, 'sourceUrl': WB_URL,
               'sourceRow': number, 'sourceSheet': sheet.title, 'imageKey': f'weldbend:{page}:{image_index}',
               'standard': 'ASTM A234 WPB; ASME B16.9', 'cataloguePage': page}
        sizes = [size(s) for s in re.split(r'\s*x\s*', sizes_raw)]
        wall = {'Std': 'STD Wall', 'XS': 'XS Wall', 'XXS': 'XXS Wall'}.get(wall_raw, 'Schedule 160')
        result.append(finish(row, sizes, fitting, wall=wall))
    return result


def asc_rows():
    sheet = xlrd.open_workbook(file_contents=fetch(ASC_URL)).sheet_by_index(0)
    assert sheet.row_values(1)[2:6] == ['10 Digit Part Number', 'P.C.', 'Figure No.', 'DESCRIPTION']
    result = []
    for i in range(2, sheet.nrows):
        cells = sheet.row_values(i)
        sku, model, desc = cells[2], cells[4], cells[5]
        if 'SKT/W' not in desc:
            continue
        match = re.fullmatch(r'(.+?)\s+(3000|6000)\s+(.+?)\s+SKT/W\s+(.+)', desc)
        assert match, desc
        sizes_raw, pressure, _, product = match.groups()
        fitting = 'Union' if model in ['2126', '2128'] else ASC_TYPES[model[-1]]
        row = {'family': 'carbon-socket-weld', 'manufacturer': 'Anvil / ASC', 'sku': sku, 'model': model,
               'upc': cells[1], 'manufacturerDescription': desc, 'sourceUrl': ASC_URL,
               'sourceRow': i + 1, 'sourceSheet': sheet.name, 'imageKey': f'asc:{model}', 'standard': 'ASTM A105'}
        result.append(finish(row, [size(s, asc=True) for s in sizes_raw.split('X')], fitting, pressure=pressure))
    return result


def merit_rows(records):
    result = []
    for source in records:
        row = dict(source)
        desc = row['manufacturerDescription']
        if desc.startswith('(SUD) - '):
            row['manufacturerNote'] = 'SUD (manufacturer catalogue code)'
            desc = desc.removeprefix('(SUD) - ')
        row['manufacturer'] = 'Merit Brass'
        grade = re.search(r'(304|316)/(?:304|316)?L', desc)
        assert grade, desc
        row['grade'] = grade[1] + '/' + grade[1] + 'L'
        is_bw = row['family'] == 'stainless-butt-weld'
        if is_bw:
            match = re.match(r'(.+?)\s+(?:S|SCH )(10|40)\s+', desc)
            assert match, desc
            sizes_raw, schedule = match.groups()
            body = re.split(r'SS\s+B/?W\s*', desc)[1]
            if '90 ELL' in body:
                assert ('LR ' in body) != ('SR ' in body), desc
                fitting = '90° ' + ('Long' if 'LR ' in body else 'Short') + '-Radius Elbow'
            elif '45 ELL' in body:
                fitting = '45° Long-Radius Elbow'
            elif 'TEE' in body:
                fitting = 'Tee'
            elif 'CONC' in body:
                fitting = 'Concentric Reducer'
            elif 'ECC' in body:
                fitting = 'Eccentric Reducer'
            elif 'STUBEND' in body:
                kind = re.search(r'TYPE "([AC])"', body)[1]
                fitting = f'Type {kind} MSS Stub End'
            elif 'CAP' in body:
                fitting = 'Cap'
            else:
                raise ValueError(desc)
            # Manufacturer dimensions and price sheets identify these as 10S/40S.
            wall, pressure = f'Schedule {schedule}S', None
            row['standard'] = 'ASTM A403 / ASME SA403'
        else:
            match = re.match(r'(.+?)\s+(?:SOCKET WELD 3000#|3M#)\s+', desc)
            assert match, desc
            sizes_raw = match[1]
            body = desc.split(' SS ')[1] if ' SS ' in desc else desc.split('S/W ')[1]
            product = body.split(' A182')[0].strip()
            fitting = {'90 ELL': '90° Elbow', '45 ELL': '45° Elbow', 'CAP': 'Cap', 'COUPLING': 'Coupling',
                       'HALF COUPLING': 'Half Coupling', 'RED COUPLING': 'Reducing Coupling',
                       'TEE': 'Tee', 'RED TEE': 'Tee', 'UNION': 'Union', 'INSERT': 'Reducer Insert'}[product]
            wall, pressure = None, '3000'
            if 'A182' in desc:
                row['standard'] = 'ASTM A182'
        row['imageKey'] = 'merit:' + hashlib.sha256(row['imageSourceUrl'].encode()).hexdigest()[:20]
        sizes = [size(s) for s in re.split(r'\s*[Xx]\s*', sizes_raw)]
        result.append(finish(row, sizes, fitting, wall=wall, pressure=pressure))
    return result


def fetch(url):
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.source')
    if not target.exists():
        session = requests.Session()
        session.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
        r = session.get(url, timeout=60)
        r.raise_for_status()
        target.write_bytes(r.content)
    return target.read_bytes()


def soup(url):
    return BeautifulSoup(fetch(url), 'html.parser')


def merit_page(item):
    family, number = item
    category = MERIT_CATEGORIES[family]
    url = f'{MERIT_BASE}/Catalog/ProductList?CurrentPage={number}&CategoryId={category}'
    doc = soup(url)
    records = []
    for box in doc.select('.productList-box'):
        titles = box.select('.title a')
        assert len(titles) == 2, url
        sku, description = [a.get_text(' ', strip=True) for a in titles]
        records.append({'family': family, 'sku': sku, 'manufacturerDescription': description,
                        'sourceUrl': urljoin(MERIT_BASE, titles[0]['href']), 'listingUrl': url,
                        'imageSourceUrl': urljoin(MERIT_BASE, box.select_one('img')['src'])})
    pages = {int(parse_qs(urlparse(a['href']).query)['CurrentPage'][0]) for a in doc.select('a[href*="CurrentPage="]')}
    # The site's pagination advertises numbers past its last page. A terminal
    # page is empty or short; do not follow its synthetic forward links.
    if len(records) < 20:
        pages = {p for p in pages if p <= number}
    print('Merit', family, number, len(records), flush=True)
    return records, {(family, n) for n in pages}


def collect_merit():
    pending = {(family, 1) for family in MERIT_CATEGORIES}
    visited = set()
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        while pending:
            batch = sorted(pending - visited)
            if not batch:
                break
            pending = set()
            for item, (rows, pages) in zip(batch, pool.map(merit_page, batch)):
                visited.add(item)
                records.extend(rows)
                pending |= pages
    assert len({r['sku'] for r in records}) == len(records), 'Duplicate paginated article'
    (CACHE / 'merit-records.json').write_text(json.dumps(records, indent=2) + '\n')
    return records


def build_images(rows):
    models = {r['imageKey']: r for r in rows}
    pdf_path = CACHE / 'weldbend-source.pdf'
    pdf_path.write_bytes(fetch(WB_CATALOGUE))
    merit_pdf = CACHE / 'merit-catalogue-source.pdf'
    merit_pdf.write_bytes(fetch(MERIT_CATALOGUE))
    type_c_text = subprocess.run(['pdftotext','-f','79','-l','79',str(merit_pdf),'-'],check=True,capture_output=True,text=True).stdout
    assert 'Type C MSS SP-43 Schedule:10S' in type_c_text
    subprocess.run(['pdfimages','-f','79','-l','79','-png',str(merit_pdf),str(CACHE / 'merit-type-c')],check=True,capture_output=True)
    # Extract each embedded product photograph intact, rather than cropping a
    # rendered page or making a synthetic product image.
    for page in {r['cataloguePage'] for r in rows if r['manufacturer'] == 'Weldbend'}:
        prefix = CACHE / f'wb-embedded-{page}'
        subprocess.run(['pdfimages','-f',str(page),'-l',str(page),'-png',str(pdf_path),str(prefix)],check=True,capture_output=True)

    def convert(item):
        key, row = item
        if key.startswith('weldbend:'):
            _, page, index = key.split(':')
            raw = (CACHE / f'wb-embedded-{page}-{int(index):03}.png').read_bytes()
            source_url, source_page = WB_CATALOGUE + '#page=' + page, WB_CATALOGUE
        elif key.startswith('asc:'):
            # Reviewed site-image exceptions: 2155's image shows threads and
            # 2128's sheet mixes threaded and socket views. Use socket-only
            # manufacturer family photos, with the substitution documented.
            photo_model = {'2155':'2175','2128':'2126'}.get(row['model'],row['model'])
            source_page = 'https://www.asc-es.com/products/' + ASC_PAGES[photo_model]
            doc = soup(source_page)
            photo = doc.select_one('.productDetails img')
            assert photo and photo_model in doc.select_one('h1').get_text(), source_page
            source_url = photo['src']
            raw = fetch(source_url)
        else:
            source_url, source_page = row['imageSourceUrl'], row['sourceUrl']
            if key == 'merit:bd0e69844fe0b419f603':
                # Type C article pages contain a product collage. The catalogue
                # provides an exact Type C drawing as a separate embedded image.
                source_url = source_page = MERIT_CATALOGUE + '#page=79'
                raw = (CACHE / 'merit-type-c-001.png').read_bytes()
            else:
                raw = fetch(source_url)
        photo = Image.open(io.BytesIO(raw)).convert('RGBA')
        photo.thumbnail((800,800))
        # Square, uncropped canvas keeps the whole fitting inside the app's
        # existing soft-edge mask. Never enlarge the manufacturer pixels.
        edge = int(max(photo.size) / .80 + .999)
        canvas = Image.new('RGBA',(edge,edge),'white')
        canvas.alpha_composite(photo,((edge-photo.width)//2,(edge-photo.height)//2))
        output = io.BytesIO()
        canvas.convert('RGB').save(output,format='WEBP',quality=92)
        raw_out = output.getvalue()
        sha = hashlib.sha256(raw_out).hexdigest()
        output_path = Path('public/images/catalog/uploads') / f'part-{sha}.webp'
        output_path.parent.mkdir(parents=True,exist_ok=True)
        output_path.write_bytes(raw_out)
        note = 'Manufacturer fitting-family image, representative across published sizes and wall/class variants. Full source image retained with white framing; no cropping or upscaling.'
        if key == 'asc:2128':
            note += ' Socket-only union family photo from Fig. 2126 replaces the mixed threaded/socket diagram for Fig. 2128.'
        if key == 'asc:2155':
            note += ' Socket-weld half-coupling family photo from Fig. 2175 replaces the incorrect threaded photograph on the Fig. 2155 page.'
        if key == 'merit:bd0e69844fe0b419f603':
            note = 'Manufacturer Type C MSS SP-43 Schedule 10S stub-end engineering drawing, extracted intact from catalogue page 79. Shared across the published Type C sizes and grades; white framing added without cropping or upscaling.'
        image_kind = 'engineering-drawing' if key in ['asc:2159','asc:2179','merit:bd0e69844fe0b419f603'] else 'product-image'
        return key, {'path':str(output_path),'url':f'/api/catalogue/images/part-{sha}.webp','sha256':sha,
                     'byteSize':len(raw_out),'width':edge,'height':edge,'sourceUrl':source_url,'sourcePage':source_page,
                     'sourceSha256':hashlib.sha256(raw).hexdigest(),
                     'imageKind':image_kind,'notes':note}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        return dict(pool.map(convert,sorted(models.items())))


if __name__ == '__main__':
    records = collect_merit()
    rows = weldbend_rows() + asc_rows() + merit_rows(records)
    counts = dict(Counter(r['family'] for r in rows))
    assert len({(r['manufacturer'], r['sku']) for r in rows}) == len(rows)
    duplicate_names = {n: c for n, c in Counter(r['displayName'] for r in rows).items() if c > 1}
    print('Counts', counts, 'Duplicate descriptions', duplicate_names)
    assert not duplicate_names, duplicate_names
    images = build_images(rows)
    sources = [{'url':url,'sha256':hashlib.sha256(fetch(url)).hexdigest()} for url in [WB_URL,ASC_URL,WB_CATALOGUE,MERIT_CATALOGUE]]
    OUT.write_text(json.dumps({'sourceDate': '2026-11-04', 'counts': counts, 'sources':sources,'rows': rows,'images':images}, indent=2) + '\n')
