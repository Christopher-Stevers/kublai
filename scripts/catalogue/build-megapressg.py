#!/usr/bin/env python3
"""Build factual MegaPressG catalogue rows from Viega's published article tables.
Requires requests, beautifulsoup4 and Pillow. No prices are inferred.
"""
import concurrent.futures, hashlib, io, json, re
from pathlib import Path
from fractions import Fraction
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
from PIL import Image
from press_catalogue_labels import clean_press_row
BASE='https://www.viega.us/en/products/Catalog/Metal-systems/MegaPressG'
CACHE=Path('.tmp/megapressg'); CACHE.mkdir(parents=True,exist_ok=True)
def page(url):
    cached=CACHE/(url.rsplit('/',1)[-1])
    if cached.exists(): return BeautifulSoup(cached.read_text(),'html.parser')
    r=requests.get(url,timeout=60);r.raise_for_status()
    (CACHE/(url.rsplit('/',1)[-1])).write_text(r.text)
    return BeautifulSoup(r.text,'html.parser')
def text(e): return e.get_text(' ',strip=True).replace('\u200b','').replace('\u00ad','')
def inch(raw):
    for ch,val in {'½':'1/2','¼':'1/4','¾':'3/4','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8'}.items():
        raw=raw.replace(ch,' '+val)
    raw=' '.join(raw.split())
    assert re.fullmatch(r'\d+(?:/\d+)?(?: \d+/\d+)?',raw),raw
    return raw, sum(float(Fraction(v)) for v in raw.split())
def model(url):
    s=page(url);title=text(s.find('h1')); m=title.split(' - Model ')[-1]
    assert 'MegaPressG' in title and m!=title,title
    name=title.split(' - Model ')[0]
    product=next(json.loads(node.string) for node in s.select('script[type="application/ld+json"]') if node.string and json.loads(node.string).get('@type')=='Product')
    t=s.select('table')[0]
    headers=[text(c) for c in t.select('thead tr')[0].find_all(['th','td'])]
    assert 'Part No' in headers and 'Quantity' in headers,(url,headers)
    sizecols=next(i for i,h in enumerate(headers) if h.startswith('Wt'))
    image=next(i['src'] for i in s.select('img[src]') if '/PPm' in i['src'])
    r=requests.get(image,timeout=60);r.raise_for_status()
    pic=Image.open(io.BytesIO(r.content));pic.thumbnail((800,800))
    out=io.BytesIO();pic.convert('RGB').save(out,format='WEBP',quality=90)
    raw=out.getvalue();sha=hashlib.sha256(raw).hexdigest()
    path=Path('public/images/catalog/uploads')/f'part-{sha}.webp';path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    asset={'path':str(path),'url':f'/api/catalogue/images/part-{sha}.webp','sha256':sha,'byteSize':len(raw),'sourceUrl':image,'model':m}
    rows=[]
    for tr in t.select('tbody tr'):
        cells=[text(c) for c in tr.find_all('td',recursive=False)]
        if not cells:continue
        skuRaw=cells[headers.index('Part No')]
        sku=skuRaw.split()[0];assert re.fullmatch(r'\d{5,}',sku),(url,cells)
        availability='Available while supplies last' if '*)' in skuRaw else 'Listed in manufacturer catalogue'
        if '*)' in skuRaw: assert 'Available while supplies last' in text(s),url
        connectionIndices=[i for i in range(sizecols) if re.fullmatch(r'P[123]?|MPT|FPT|FTG \(IPS\)',headers[i])]
        assert connectionIndices,(url,headers)
        connectionHeaders=[headers[i] for i in connectionIndices]
        dims=[inch(cells[i]) for i in connectionIndices]
        connectionLabel=' x '.join(re.sub(r'^P[123]?$', 'Press',h).replace('FTG (IPS)','FTG') for h in connectionHeaders)
        size=' x '.join(v[0]+'"' for v in dims)
        if len(set(v[0] for v in dims))==1:size=dims[0][0]+'"'
        rows.append({'sku':sku,'availability':availability,'model':m,'displayName':f'{name} {size} ({connectionLabel}) - {m} - {sku}', 'sizeLabel':size,'sizeNominal':max(v[1] for v in dims), 'connections':dict(zip(connectionHeaders,[v[0]+'"' for v in dims])), 'articleData':dict(zip(headers,cells)),'sourceUrl':url,'imageKey':m,'category':'Fitting','material':'MegaPressG (Natural Gas)', 'description':f'Viega MegaPressG {m}. Natural gas / fuel gas fitting; carbon steel with HNBR sealing elements. Connections: '+', '.join(f'{h} {v[0]} in' for h,v in zip(connectionHeaders,dims))+'. Manufacturer part number '+sku+'. '+availability+'.', 'aliases':[f'MegaPressG {sku}',f'MegaPress G {sku}',f'Viega {sku}',f'Natural gas {name.removeprefix("Viega MegaPressG ")} {size}']})
    assert rows,url
    return [clean_press_row({**row, 'manufacturerDescription': product['description']}) for row in rows],asset
root=page(BASE+'.html')
categories=sorted(set(urljoin(BASE+'.html',a['href']) for a in root.select('a[href]') if a['href'].startswith('/en/products/Catalog/Metal-systems/MegaPressG/')))
models=set()
for u in categories:
    s=page(u)
    for a in s.select('a[href]'):
        link=urljoin(u,a['href'])
        if link.startswith(u[:-5]+'/') and link.endswith('.html'):models.add(link)
rows=[];images={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for rs,im in pool.map(model,sorted(models)):
        rows+=rs;images[im['model']]=im
        print(im['model'],len(rs),flush=True)
assert len({r['sku'] for r in rows})==len(rows)
Path('data/catalogue/megapressg.json').write_text(json.dumps({'sourceUrl':BASE+'.html','rows':rows,'images':images},indent=2)+'\n')
print('TOTAL',len(rows),'MODELS',len(images))
