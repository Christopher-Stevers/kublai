"""Build only explicit ASC/Anvil forged threaded articles, with reviewed real photos.

Run with Python requests, beautifulsoup4, xlrd and Pillow; Poppler is required.
Price/availability are deliberately not imported. Manufacturer metadata belongs in
aliases/provenance, never the clean names and descriptions.
"""
import hashlib
import io
import json
import re
import subprocess
from collections import Counter
from fractions import Fraction
from pathlib import Path
from urllib.parse import quote

import requests
import xlrd
from PIL import Image
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

CACHE = Path('.tmp/threaded-forged')
CACHE.mkdir(parents=True, exist_ok=True)
SOURCE = 'https://s3.us-east-1.amazonaws.com/ue1.asc-es.com/price-sheets/excel/CSF-6.26-website.xls'
OUT = Path('data/catalogue/threaded-forged.json')
TYPES = {
    '2101':'90° Elbow', '2102':'45° Elbow', '2103':'Tee', '2104':'Cross',
    '2111':'90° Elbow', '2112':'45° Elbow', '2113':'90° Street Elbow',
    '2114':'Tee', '2115':'Cross', '2116':'45° Lateral', '2117':'Coupling',
    '2118':'Reducing Coupling', '2119':'Half Coupling', '2120':'Cap',
    '2131':'90° Elbow', '2132':'45° Elbow', '2133':'90° Street Elbow',
    '2134':'Tee', '2135':'Cross', '2136':'45° Lateral', '2137':'Coupling',
    '2138':'Reducing Coupling', '2139':'Hex Bushing', '2140':'Flush Bushing',
    '2141':'Half Coupling', '2142':'Hex-Head Plug', '2143':'Cap',
    '2121':'Round-Head Plug', '2122':'Square-Head Plug', '2125':'Steel-Seat Union',
    '2127':'Steel-Seat Union',
}


def fetch(url):
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest()+'.source')
    if not target.exists():
        session = requests.Session()
        session.mount('https://', HTTPAdapter(max_retries=Retry(total=4, backoff_factor=2, status_forcelist=[429,500,502,503,504])))
        response = session.get(url, timeout=60, headers={'User-Agent':'Mozilla/5.0'})
        response.raise_for_status()
        target.write_bytes(response.content)
    return target.read_bytes()


def size(raw):
    # ASC writes mixed fractions without a separator: 11/4 means 1 1/4.
    raw = re.sub(r'^(\d+)([123])/([248])$', r'\1 \2/\3',raw.strip().replace('-', ' '))
    value = sum(Fraction(v) for v in raw.split())
    assert Fraction(1,8) <= value <= 4, raw
    whole,remainder = divmod(value.numerator,value.denominator)
    return (str(whole) if not remainder else (f'{whole} ' if whole else '') + f'{remainder}/{value.denominator}'),float(value)


def rows():
    sheet=xlrd.open_workbook(file_contents=fetch(SOURCE)).sheet_by_index(0)
    assert sheet.row_values(1)[2:6] == ['10 Digit Part Number','P.C.','Figure No.','DESCRIPTION']
    result=[]
    excluded=Counter()
    for idx in range(2,sheet.nrows):
        cells=sheet.row_values(idx)
        sku,model,desc=cells[2],cells[4],cells[5]
        if 'SKT/W' in desc:
            excluded['socket-weld-already-catalogued']+=1
            continue
        if 'GALV' in desc:
            excluded['galvanized-finish-outside-requested-uncoated-range']+=1
            continue
        assert model in TYPES, (model,desc)
        match=re.fullmatch(r'(.+?)\s+(?:(2000|3000|6000)\s+)?((?:FS|FORGED|STLXSTL).+)',desc)
        assert match,desc
        sizes_raw,pressure,body=match.groups()
        sizes=[size(s) for s in sizes_raw.split('X')]
        fitting=TYPES[model]
        if fitting in ['Tee','45° Lateral'] and len(sizes)==2:
            sizes=[sizes[0],sizes[0],sizes[1]]
        if len(set(sizes))>1 and fitting in ['Tee','90° Elbow','45° Lateral']:
            fitting='Reducing '+fitting
        if 'LUG UNION' in body:
            fitting='Steel-Seat Lug Union'
        if model in ['2121','2122','2142'] and sizes[0][1]>=2.5:
            fitting='Cored '+fitting
        if fitting in ['Reducing Coupling','Hex Bushing','Flush Bushing']:
            assert len(sizes)==2 and sizes[0][1]>sizes[1][1],desc
        assert pressure or model in ['2121','2122','2142','2139','2140'],desc
        label=' x '.join(s[0]+'"' for s in sizes)
        rating=f'Class {pressure} ' if pressure else ''
        name=f'{label} Forged Carbon Steel {rating}Threaded {fitting}'
        aliases=[
            'Anvil / ASC', 'Anvil', 'ASC Engineered Solutions',sku,f'Anvil {sku}',f'ASC {sku}',
            f'Figure {model}',f'Anvil Figure {model}',str(cells[1]),desc,
            f'Anvil {name}',name.replace('Threaded','NPT'),name.replace('Forged Carbon Steel', 'Black Forged Steel'),
        ]
        if pressure:
            aliases.extend([name.replace(f'Class {pressure}',pressure+'#'),name.replace(f'Class {pressure}',{'2000':'2M','3000':'3M','6000':'6M'}[pressure])])
        if pressure is None:
            aliases.append('High-pressure forged steel')
        if 'STLXSTL' in body:
            aliases.append('Steel-to-steel seat')
        if 'AAR' in body:
            aliases.append('AAR union')
        aliases=list(dict.fromkeys(aliases))
        assert all(0<len(s)<=255 for s in [name]+aliases),(sku,name)
        row={'family':'carbon-forged-threaded','manufacturer':'Anvil / ASC','sku':sku,'model':model,
             'upc':str(cells[1]),'manufacturerDescription':desc,'sourceUrl':SOURCE,
             'sourceRow':idx+1,'sourceSheet':sheet.name,'imageKey':'asc-threaded:'+('lug' if 'LUG UNION' in body else model),
             'standard':'ASTM A105; ASME B1.20.1 NPT; '+('MSS SP-83' if 'UNION' in body else 'ASME B16.11'),
             'displayName':name,'description':name,'material':'Carbon Steel','category':'Forged Threaded Fittings',
             'connectionType':'Threaded','sizeLabel':label,'sizeNominal':max(v[1] for v in sizes),
             'connectionSizes':[v[0]+'"' for v in sizes],'fittingType':fitting,'wall':None,
             'pressureClass':pressure,'finish':'Black (non-galvanized)','aliases':aliases}
        if pressure is None:
            row['ratingNote']='Manufacturer identifies forged plugs and bushings without a pressure class; see ASME B16.11 and the manufacturer submittal for permitted use.'
        if 'UNION' in body:
            row['seatMaterial']='Steel-to-steel'
            if pressure=='6000':row['standard']='ASTM A105; ASME B1.20.1 NPT; MSS SP-83 method (Class 6000)'
        result.append(row)
    assert len(result)==570,len(result)
    assert len({r['sku'] for r in result})==len(result),'Duplicate SKU'
    duplicate_names={n:c for n,c in Counter(r['displayName'] for r in result).items() if c>1}
    assert not duplicate_names,duplicate_names
    return result,dict(excluded)


def build_images():
    # Explicitly reviewed map is committed with this builder, so rerunning does
    # not trust whatever thumbnail a product CMS happens to return later.
    specs=json.loads(Path('scripts/catalogue/forged-threaded-images.json').read_text())
    images={}
    for key,spec in specs.items():
        raw=fetch(spec['sourceUrl'])
        if spec.get('pdfPage'):
            pdf=CACHE/(hashlib.sha256(raw).hexdigest()+'.pdf');pdf.write_bytes(raw)
            prefix=CACHE/(key.replace(':','-')+'-embedded')
            subprocess.run(['pdfimages','-f',str(spec['pdfPage']),'-l',str(spec['pdfPage']),'-png',str(pdf),str(prefix)],check=True,capture_output=True)
            raw=(Path(str(prefix)+f'-{spec["pdfImageIndex"]:03}.png')).read_bytes()
        photo=Image.open(io.BytesIO(raw)).convert('RGBA')
        source_size=photo.size
        if spec.get('pdfMaskIndex') is not None:
            mask=Image.open(Path(str(prefix)+f'-{spec["pdfMaskIndex"]:03}.png')).convert('L')
            assert mask.size==photo.size
            photo.putalpha(mask)
        if spec.get('trimWhiteBorder'):
            # Discard only blank source margins, never the part itself.
            gray=photo.convert('RGB').convert('L')
            bounds=gray.point(lambda v: 255 if v < 245 else 0).getbbox()
            assert bounds
            photo=photo.crop(bounds)
        # Keep entire product: white framing only, no cropping, no enlargement.
        photo.thumbnail((1000,1000),Image.Resampling.LANCZOS)
        edge=int(max(photo.size)/0.84+.999)
        canvas=Image.new('RGBA',(edge,edge),'white')
        canvas.alpha_composite(photo,((edge-photo.width)//2,(edge-photo.height)//2))
        output=io.BytesIO();canvas.convert('RGB').save(output,'WEBP',quality=94)
        blob=output.getvalue();sha=hashlib.sha256(blob).hexdigest()
        path=Path('public/images/catalog/uploads')/f'part-{sha}.webp';path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(blob)
        images[key]={'path':str(path),'url':f'/api/catalogue/images/part-{sha}.webp','sha256':sha,
            'byteSize':len(blob),'width':edge,'height':edge,'sourceWidth':source_size[0],'sourceHeight':source_size[1],
            'sourceUrl':spec['sourceUrl'],'sourcePage':spec['sourcePage'],'sourceSha256':hashlib.sha256(raw).hexdigest(),
            'imageKind':'product-photo','notes':spec['notes']+' Full fitting retained with white framing; no upscaling.'}
        if spec.get('pdfPage'):
            images[key].update({'pdfPage':spec['pdfPage'],'pdfImageIndex':spec['pdfImageIndex']})
    return images


if __name__=='__main__':
    products,excluded=rows()
    photos=build_images()
    assert all(r['imageKey'] in photos for r in products)
    source_urls=sorted({SOURCE}|{v['sourceUrl'] for v in photos.values()})
    output={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in products)),
            'sources':[{'url':u,'sha256':hashlib.sha256(fetch(u)).hexdigest()} for u in source_urls],
            'exclusions':excluded,'rows':products,'images':photos}
    OUT.write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'rows':len(products),'photos':len(photos),'classes':dict(Counter(str(r['pressureClass']) for r in products)),'exclusions':excluded},indent=2))
