#!/usr/bin/env python3
"""Extract every published nipple SKU; do not invent missing size/length combinations."""
import re,json,hashlib,subprocess,urllib.request,urllib.parse
from pathlib import Path
from fractions import Fraction
from collections import Counter
root=Path('.tmp/cb-nipples-20261019');root.mkdir(parents=True,exist_ok=True)
sources=[('PN','PN - Steel Nipples (Standard) - IPL.pdf','2025-03-26'),('XHN','XHN - Steel Nipples (Extra Heavy) - IPS.pdf','2024-03-27'),('SSPN','SSPN - Stainless Steel Nipples.pdf','2022-06-06')]
rows=[];excluded=[];publications=[]
def number(s):return float(sum(Fraction(x) for x in s.split()))
for key,filename,date in sources:
 url='https://www.cbsupplies.ca/sheets/en/'+urllib.parse.quote(filename)
 file=root/(key+'.pdf')
 if not file.exists():urllib.request.urlretrieve(url,file)
 subprocess.run(['pdftotext','-layout',str(file),str(root/(key+'.txt'))],check=True)
 publications.append(dict(number=key,url=url,effectiveDate=date,sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
 for page,text in enumerate((root/(key+'.txt')).read_text().split('\f'),1):
  for line in text.splitlines():
   if not re.match(r'^\s*\d{9}\s',line):continue
   m=re.match(r'^\s*(\d{9})\s+(.+?)\s+(\d{11,13})\s+(.*?)\$\s*([\d,.]+)\s*$',line)
   assert m,repr(line)
   sku,desc,upc,packing,price=m.groups();desc=' '.join(desc.split())
   if 'RACK FOR' in desc:
    excluded.append(dict(sku=sku,description=desc,reason='Storage rack, not a pipe nipple'));continue
   pack='PACK' in desc
   # Fraction must be considered before integer; numeric prefix cannot truncate 1/8.
   dim=re.match(r'^(\d+ \d+/\d+|\d+/\d+|\d+)\s*[Xx]\s*(CLOSE|\d+ \d+/\d+|\d+/\d+|\d+)\b',desc)
   if pack:
    diameter=re.match(r'^(\d+ \d+/\d+|\d+/\d+|\d+)\s',desc).group(1);length=None
   else:
    assert dim,desc
    diameter,length=dim.groups()
   galvanized=bool(re.search(r'\b(?:GALV|GLV)\b',desc));ss=key=='SSPN';lr='L-R' in desc;toe='ONE END' in desc
   schedule='80' if 'XH NIPPLE' in desc else '40'
   material='Stainless steel' if ss else 'Galvanized Steel' if galvanized else 'Carbon Steel'
   finish='304 Stainless Steel' if ss else 'Galvanized Steel' if galvanized else 'Black Steel'
   thread='Left x Right Hand' if lr else 'Threaded One End' if toe else 'Threaded Both Ends'
   imageKey='stainless' if ss else 'galvanized' if galvanized else 'left-right' if lr else 'one-end' if toe else 'black'
   pieces=None
   if pack:
    p=re.search(r'(\d+) PACK',desc)
    if p:pieces=int(p.group(1));imageKey='pack-'+str(pieces)
    else:imageKey='single-run'
    label=f'{diameter}" {finish} Sch {schedule} Nipple '+(f'{pieces}-Piece Assortment Pack' if pieces else 'Single Run Assortment Pack')
   else:
    lengthLabel='Close' if length=='CLOSE' else length+'"'
    label=f'{diameter}" x {lengthLabel} {finish} Sch {schedule} Nipple'+(' - '+thread if lr or toe else '')
   rows.append(dict(sku=sku,displayName=label,description=label+'. CB Supplies '+sku+'. '+thread+'.',supplierDescription=desc,upc=upc,publishedListPrice=price.replace(',',''),priceEffectiveDate=date,material=material,category='Nipples',catalog='Plumbing',sizeLabel=diameter,sizeNominal=number(diameter),lengthInches=None if length in (None,'CLOSE') else number(length),lengthLabel=length,pipeSchedule=schedule,thread=thread,finish=finish,piecesPerPack=pieces,bulkUnit='pack' if pieces else None,individualUnit='pcs',imageKey=imageKey,aliases=[desc,sku,'CB Supplies '+sku],source=dict(publication=key,url=url,page=page)))
assert len({r['sku'] for r in rows})==len(rows)

for name,count in Counter(r['displayName'] for r in rows).items():
 if count>1:print([r for r in rows if r['displayName']==name])
assert len({r['displayName'] for r in rows})==len(rows)
out=dict(manufacturer='CB Supplies',publications=publications,rows=rows,excluded=excluded,counts=dict(Counter(r['source']['publication'] for r in rows)))
Path('data/catalogue').mkdir(parents=True,exist_ok=True)
Path('data/catalogue/cb-steel-nipples.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(dict(total=len(rows),counts=out['counts'],images=dict(Counter(r['imageKey'] for r in rows)),excluded=excluded),indent=2))
