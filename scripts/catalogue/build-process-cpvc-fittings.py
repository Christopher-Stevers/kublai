"""Build explicit NIBCO CPVC fitting SKUs and reviewed genuine photos; no DB writes.

Manufacturer JSON lists are the article authority. Source dimensions are preserved,
except CB13030, whose exact manufacturer item page corrects its erroneous size facet.
Flange Class 150 is dimensional compatibility, never an inferred working pressure.
"""
import hashlib, io, json, re
from collections import Counter
from fractions import Fraction
from pathlib import Path
import requests
from PIL import Image, ImageDraw

CACHE=Path('.tmp/process-cpvc-fittings'); CACHE.mkdir(parents=True,exist_ok=True)
CONFIG=json.loads(Path('scripts/catalogue/process-cpvc-fittings-sources.json').read_text())
CORRECTION='https://catalog.nibco.com/item/cpvc-schedule-80-fittings-1/bushing-mpt-x-fpt-corzan-cpvc-schedule-80-5118-3-4/cb13030'
# Model: clean description, fitting type, end connections.
FAMILIES={
 '5101':('Socket Coupling','Coupling',['Socket','Socket']),
 '5101-3-3':('FNPT Coupling','Coupling',['FNPT','FNPT']),
 '5103':('Socket x FNPT Female Adapter','Female Adapter',['Socket','FNPT']),
 '5104':('Socket x MNPT Male Adapter','Male Adapter',['Socket','MNPT']),
 '5106':('Socket 45° Elbow','45° Elbow',['Socket','Socket']),
 '5106-3-3':('FNPT 45° Elbow','45° Elbow',['FNPT','FNPT']),
 '5107':('Socket 90° Elbow','90° Elbow',['Socket','Socket']),
 '5107-3':('Socket x FNPT 90° Elbow','90° Elbow',['Socket','FNPT']),
 '5107-3-3':('FNPT 90° Elbow','90° Elbow',['FNPT','FNPT']),
 '5111, 5111R':('Socket Tee','Tee',['Socket','Socket','Socket']),
 '5112':('Socket x Socket x FNPT Tee','Tee',['Socket','Socket','FNPT']),
 '5112-3-3':('FNPT Tee','Tee',['FNPT','FNPT','FNPT']),
 '5116-4':('MNPT Plug','Plug',['MNPT']),
 '5117':('Socket Cap','Cap',['Socket']),
 '5117-3':('FNPT Cap','Cap',['FNPT']),
 '5118':('Spigot x Socket Flush Reducing Bushing','Reducing Bushing',['Spigot','Socket']),
 '5118-3':('Spigot x FNPT Flush Reducing Bushing','Reducing Bushing',['Spigot','FNPT']),
 '5118-3-4':('MNPT x FNPT Flush Reducing Bushing','Reducing Bushing',['MNPT','FNPT']),
 '5119-H':('Solid Blind Flange','Blind Flange',['Flanged']),
 '5119-W':('Webbed Blind Flange','Blind Flange',['Flanged']),
 '5133':('Socket Union, FKM Seal','Union',['Socket','Socket']),
 '5133-3':('Socket x FNPT Union, FKM Seal','Union',['Socket','FNPT']),
 '5133-3-3':('FNPT Union, FKM Seal','Union',['FNPT','FNPT']),
 '5133E':('Socket Union, EPDM Seal','Union',['Socket','Socket']),
 '5133E-3':('Socket x FNPT Union, EPDM Seal','Union',['Socket','FNPT']),
 '5133E-3-3':('FNPT Union, EPDM Seal','Union',['FNPT','FNPT']),
 '5151-A':('Socket Van Stone Flange','Van Stone Flange',['Socket','Flanged']),
 '5151-H':('Socket Solid Flange','Solid Flange',['Socket','Flanged']),
 '5151-H-3':('FNPT Solid Flange','Solid Flange',['FNPT','Flanged']),
 '5151-W':('Socket Webbed Flange','Webbed Flange',['Socket','Flanged']),
 '5151-W-3':('FNPT Webbed Flange','Webbed Flange',['FNPT','Flanged']),
}

def fetch(url, filename):
 p=CACHE/filename
 if not p.exists():
  r=requests.get(url,headers={'Accept':'application/json','User-Agent':'Mozilla/5.0'},timeout=60);r.raise_for_status();p.write_bytes(r.content)
 return p.read_bytes()

def size(raw):
 raw=raw.replace('in.','').strip().replace('-',' ')
 assert re.fullmatch(r'\d+(?: \d+/\d+|/\d+)?',raw),raw
 return raw+'"',float(sum(Fraction(n) for n in raw.split()))

def photo(url,page):
 raw=fetch(url,'nibco-'+hashlib.sha256(url.encode()).hexdigest()+'.img')
 im=Image.open(io.BytesIO(raw)).convert('RGBA'); original=im.size
 im.thumbnail((1200,1200),Image.Resampling.LANCZOS)
 edge=max(300,int(max(im.size)/.9+.999));canvas=Image.new('RGBA',(edge,edge),'white')
 canvas.alpha_composite(im,((edge-im.width)//2,(edge-im.height)//2))
 out=io.BytesIO();canvas.convert('RGB').save(out,'WEBP',quality=94);blob=out.getvalue();sha=hashlib.sha256(blob).hexdigest()
 path=Path('public/images/catalog/uploads')/f'part-{sha}.webp';path.write_bytes(blob)
 return dict(path=str(path),url=f'/api/catalogue/images/part-{sha}.webp',sha256=sha,byteSize=len(blob),width=edge,height=edge,sourceWidth=original[0],sourceHeight=original[1],sourceSha256=hashlib.sha256(raw).hexdigest(),sourceUrl=url,sourcePage=page,imageKind='product-photo',notes='Genuine manufacturer photograph, representative size of this exact fitting geometry and connection configuration. Manufacturer shares union exterior photos between EPDM and FKM seals. Entire product retained, alpha composited onto white, no upscaling.')

def main():
 rows=[];images={};sources=[];excluded=[];photo_keys={}
 for config in CONFIG:
  model=config['model'];base,kind,ends=FAMILIES[model]
  raw=fetch(config['url'],config['file']);j=json.loads(raw)
  sources.append(dict(url=config['url'],sha256=hashlib.sha256(raw).hexdigest(),type='manufacturer-product-json',model=model))
  for v in j['viewModel']['variants']:
   sku=v['variantId'];rawsize=v['size'];note=None
   if sku=='CB05340':
    excluded.append(dict(manufacturer='NIBCO',sku=sku,model=model,reason='Manufacturer size facet says 3/8 x 5/8 but product description says 3/8 equal elbow; exact old item page is gone. Omitted until dimensions are verified.'));continue
   if sku=='CB13030':
    rawsize='3/8 in. x 1/4 in.'
    note='Manufacturer item page confirms 3/8 x 1/4, matching original product description; current JSON size facet incorrectly says 3/4 x 1/4.'
   sizes=[size(x) for x in rawsize.split(' x ')]
   if len(sizes)==1:sizes*=len(ends)
   assert len(sizes)==len(ends),(model,v,sizes,ends)
   reduced=len(set(sizes))>1
   if model=='5101-3-3' and reduced:
    excluded.append(dict(manufacturer='NIBCO',sku=sku,model=model,reason='Exact threaded reducing coupling has no reviewed manufacturer reducing photograph; available family image is straight coupling.'));continue
   namebase=base;rowkind=kind;imageindex=0
   if reduced and model in ['5101','5111, 5111R']:
    imageindex=1;namebase=base.replace(kind,'Reducing '+kind);rowkind='Reducing '+kind
   labels=[x[0] for x in sizes];label=labels[0] if not reduced else ' x '.join(labels)
   name=f'{label} CPVC Schedule 80 {namebase}'
   url=j['viewModel']['familyImages'][imageindex]['featuredSrc']
   if url not in photo_keys:
    key=f'nibco:cpvc:{model}:{imageindex}';photo_keys[url]=key;images[key]=photo(url,config['url'])
   key=photo_keys[url]
   attrs={'Model':model,'Schedule':'80','End Connections':' x '.join(ends),'Manufacturer Description':v['text'],'Manufacturer Size':v['size'],'Manufacturer Features':' | '.join(j.get('features',[]))}
   attrs={k:x for k,x in attrs.items() if x}
   if 'Seal' in base:attrs['Seal Material']='EPDM' if 'EPDM' in base else 'FKM'
   if 'Flange' in kind:
    attrs['Flange Compatibility']='ANSI B16.5 Class 150 connection dimensions; not an operating pressure rating'
   if note:attrs['Source Size Correction']=note;attrs['Size Correction Source']=CORRECTION
   aliases=list(dict.fromkeys(['NIBCO',sku,model,v['upc'],v['text'],'NIBCO '+sku,'NIBCO '+model,j['displayName']]))
   rows.append(dict(family='cpvc-fittings',manufacturer='NIBCO',sku=sku,model=model,upc=v['upc'],manufacturerDescription=v['text'],displayName=name,description=name,material='CPVC',category='CPVC Fittings',fittingType=rowkind,connectionType=' x '.join(ends) if len(set(ends))>1 else ends[0],connectionSizes=labels,sizeLabel=label,sizeNominal=sizes[0][1],sizeUnit='in',pressureClass=None,aliases=aliases,imageKey=key,sourceUrl=config['url'],listingUrl=v.get('cadbimLink') or config['catalogUrl'],attributes=attrs))
 correction=fetch(CORRECTION,'nibco-CB13030-official-correction.html')
 sources.append(dict(url=CORRECTION,sha256=hashlib.sha256(correction).hexdigest(),type='manufacturer-exact-sku-page',sku='CB13030'))
 assert len({(r['manufacturer'],r['sku']) for r in rows})==len(rows)
 assert len({r['displayName'] for r in rows})==len(rows)
 result=dict(sourceDate='2026-11-05',counts=dict(Counter(r['family'] for r in rows)),modelCounts=dict(Counter(r['model'] for r in rows)),typeCounts=dict(Counter(r['fittingType'] for r in rows)),sources=sources,exclusions=excluded,rows=rows,images=images)
 Path('data/catalogue/process-cpvc-fittings.json').write_text(json.dumps(result,indent=2)+'\n')
 entries=list(images.items())
 for start in range(0,len(entries),16):
  selected=entries[start:start+16];sheet=Image.new('RGB',(1200,((len(selected)+3)//4)*310),'#eeeeee');draw=ImageDraw.Draw(sheet)
  for n,(key,imeta) in enumerate(selected):
   im=Image.open(imeta['path']);im.thumbnail((280,250));x=n%4*300;y=n//4*310;sheet.paste(im,(x+(300-im.width)//2,y+(250-im.height)//2));draw.text((x+8,y+258),key.replace('nibco:cpvc:',''),fill='black');draw.text((x+8,y+278),f"Source {imeta['sourceWidth']} x {imeta['sourceHeight']}",fill='black')
  sheet.save(CACHE/f'final-contact-{start//16}.jpg',quality=92)
 print(json.dumps(dict(rows=len(rows),images=len(images),excluded=len(excluded),types=result['typeCounts']),indent=2))

if __name__=='__main__':main()
