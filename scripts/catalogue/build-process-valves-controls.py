"""Import-ready, explicit manufacturer articles. Does not mutate the database.
NIBCO public product JSON and Watts' 2026 order-code tables are authoritative.
Only reviewed photographs matched to the actual configuration are included.
"""
import hashlib, io, json, re, subprocess
from collections import Counter
from fractions import Fraction
from pathlib import Path
import requests
from PIL import Image

CACHE=Path('.tmp/process-valves-controls'); CACHE.mkdir(parents=True,exist_ok=True)
OUT=Path('data/catalogue/process-valves-controls.json')
SOURCE_CONFIG=json.loads(Path('scripts/catalogue/process-valves-controls-sources.json').read_text())

# Model, clean configuration name, body material, type, connection, pressure class,
# cold working pressure. Class is not inferred from psi or the connection class.
NIBCO=[
('T-113-LF','Lead-Free Bronze Threaded Non-Rising Stem Gate Valve','Bronze','Gate Valve','Threaded',None,300),
('S-113-LF','Lead-Free Bronze Solder Non-Rising Stem Gate Valve','Bronze','Gate Valve','Solder',None,300),
('T-111-LF','Lead-Free Bronze Threaded Rising Stem Gate Valve','Bronze','Gate Valve','Threaded',None,300),
('S-111-LF','Lead-Free Bronze Solder Rising Stem Gate Valve','Bronze','Gate Valve','Solder',None,300),
('T-174-A','Bronze Class 300 Threaded Rising Stem Gate Valve','Bronze','Gate Valve','Threaded','300',600),
('F-617-O','Cast Iron Class 125 Flanged OS&Y Gate Valve','Cast Iron','Gate Valve','Flanged','125',200),
('F-619','Cast Iron Class 125 Flanged Non-Rising Stem Gate Valve','Cast Iron','Gate Valve','Flanged','125',200),
('F-637-31','Ductile Iron Class 150 Raised-Face Flanged OS&Y Gate Valve','Ductile Iron','Gate Valve','Flanged','150',250),
('T-211-Y','Bronze Class 125 Threaded PTFE-Disc Globe Valve','Bronze','Globe Valve','Threaded','125',200),
('S-211-Y','Bronze Class 125 Solder PTFE-Disc Globe Valve','Bronze','Globe Valve','Solder','125',200),
('T-235-Y','Bronze Class 150 Threaded PTFE-Disc Globe Valve','Bronze','Globe Valve','Threaded','150',300),
('T-275-Y','Bronze Class 300 Threaded PTFE-Disc Globe Valve','Bronze','Globe Valve','Threaded','300',600),
('F-718-B','Cast Iron Class 125 Flanged Bronze-Trim Globe Valve','Cast Iron','Globe Valve','Flanged','125',200),
('F-738-31','Ductile Iron Class 150 Raised-Face Flanged Bronze-Trim Globe Valve','Ductile Iron','Globe Valve','Flanged','150',250),
('T-413-Y-LF','Lead-Free Bronze Threaded PTFE-Disc Swing Check Valve','Bronze','Swing Check Valve','Threaded',None,200),
('S-413-Y-LF','Lead-Free Bronze Solder PTFE-Disc Swing Check Valve','Bronze','Swing Check Valve','Solder',None,200),
('T-480-Y-LF','Lead-Free Bronze Threaded Spring Lift Check Valve','Bronze','Spring Lift Check Valve','Threaded',None,250),
('S-480-Y-LF','Lead-Free Bronze Solder Spring Lift Check Valve','Bronze','Spring Lift Check Valve','Solder',None,250),
('T-473-Y','Bronze Class 300 Threaded PTFE-Disc Swing Check Valve','Bronze','Swing Check Valve','Threaded','300',600),
('F-918-B','Cast Iron Class 125 Flanged Bronze-Trim Swing Check Valve','Cast Iron','Swing Check Valve','Flanged','125',200),
('F-938-31','Ductile Iron Class 150 Raised-Face Flanged Bronze-Trim Swing Check Valve','Ductile Iron','Swing Check Valve','Flanged','150',250),
('W-920-W-LF - 2 - 12 inch','Lead-Free Cast Iron Class 125 Wafer Twin-Disc Check Valve','Cast Iron','Twin-Disc Check Valve','Wafer','125',250),
('LD-2000','Ductile Iron Lug Butterfly Valve, Bronze Disc, EPDM Seat','Ductile Iron','Butterfly Valve','Lug',None,200),
('LD-2022','Ductile Iron Lug Butterfly Valve, Stainless Disc, EPDM Seat','Ductile Iron','Butterfly Valve','Lug',None,200),
('WD-2000','Ductile Iron Wafer Butterfly Valve, Bronze Disc, EPDM Seat','Ductile Iron','Butterfly Valve','Wafer',None,200),
('T-FP600A-LF','Lead-Free Brass Threaded Full-Port Ball Valve','Brass','Ball Valve','Threaded',None,600),
('S-FP600A-LF','Lead-Free Brass Solder Full-Port Ball Valve','Brass','Ball Valve','Solder',None,600),
('PC-FP600A-LF','Lead-Free Brass Press Full-Port Ball Valve','Brass','Ball Valve','Press',None,250),
('T-585-66-LF','Lead-Free Bronze Threaded Full-Port Ball Valve, Stainless Trim','Bronze','Ball Valve','Threaded',None,600),
('S-585-66-LF','Lead-Free Bronze Solder Full-Port Ball Valve, Stainless Trim','Bronze','Ball Valve','Solder',None,600),
('T-595-CS-R-66-LL','Carbon Steel Threaded Three-Piece Full-Port Ball Valve, Locking Lever','Carbon Steel','Ball Valve','Threaded',None,1000),
('T-585-S6-R-66-LL','Stainless Steel Threaded Two-Piece Full-Port Ball Valve, Locking Lever','Stainless Steel','Ball Valve','Threaded',None,1000),
('F-515-CS-F-66-FS','Carbon Steel Class 150 Flanged Fire-Safe Full-Port Ball Valve','Carbon Steel','Ball Valve','Flanged','150',285),
('F-515-S6-F-66-FS','Stainless Steel Class 150 Flanged Fire-Safe Full-Port Ball Valve','Stainless Steel','Ball Valve','Flanged','150',275),
('F-535-CS-F-66-FS','Carbon Steel Class 300 Flanged Fire-Safe Full-Port Ball Valve','Carbon Steel','Ball Valve','Flanged','300',740),
('F-535-S6-F-66-FS','Stainless Steel Class 300 Flanged Fire-Safe Full-Port Ball Valve','Stainless Steel','Ball Valve','Flanged','300',720),
('TM-585-70-66-AP','Bronze Threaded Full-Port Pneumatic Ball Valve','Bronze','Pneumatic Ball Valve','Threaded',None,600),
]

def fetch(url):
 p=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.source')
 if not p.exists():
  r=requests.get(url,headers={'Accept':'application/json','User-Agent':'Mozilla/5.0'},timeout=60);r.raise_for_status();p.write_bytes(r.content)
 return p.read_bytes()

def normsize(raw):
 raw=raw.replace('in.','').replace('IN','').replace('"','').strip().replace('-',' ')
 assert re.fullmatch(r'\d+(?: \d+/\d+|/\d+)?',raw),raw
 value=sum(Fraction(n) for n in raw.split());return raw,float(value)

def make_image(key,url,page,note):
 raw=fetch(url);im=Image.open(io.BytesIO(raw)).convert('RGBA');size=im.size
 im.thumbnail((1200,1200),Image.Resampling.LANCZOS)
 # The source contains complete product. Add quiet framing without cropping or upscaling.
 edge=int(max(im.size)/.9+.999);canvas=Image.new('RGBA',(edge,edge),'white');canvas.alpha_composite(im,((edge-im.width)//2,(edge-im.height)//2))
 out=io.BytesIO();canvas.convert('RGB').save(out,'WEBP',quality=94);blob=out.getvalue();sha=hashlib.sha256(blob).hexdigest()
 path=Path('public/images/catalog/uploads')/f'part-{sha}.webp';path.write_bytes(blob)
 return {'path':str(path),'url':f'/api/catalogue/images/part-{sha}.webp','sha256':sha,'byteSize':len(blob),'width':edge,'height':edge,'sourceWidth':size[0],'sourceHeight':size[1],'sourceSha256':hashlib.sha256(raw).hexdigest(),'sourceUrl':url,'sourcePage':page,'imageKind':'product-photo','notes':note+' Whole product retained; no upscaling.'}

def nibco_rows():
 result=[];images={};excluded=[];sources=[]
 for model,base,material,kind,connection,cls,cwp in NIBCO:
  url=SOURCE_CONFIG['nibcoUrls'][model]
  # Preserve the downloaded manufacturer's explicit list, not generated size combinations.
  data=fetch(url);j=json.loads(data);sources.append({'url':url,'sha256':hashlib.sha256(data).hexdigest(),'type':'manufacturer-product-json','model':model})
  for v in j['viewModel']['variants']:
   token=v['text'].split()[0].replace('-','');normal=model.split(' - ')[0].replace('-','');handle=v.get('handleType')
   imageindex=0;reason=None;suffix=''
   if v.get('isInternationalOnly'):reason='International-only variant excluded from North American selection'
   elif model=='TM-585-70-66-AP':suffix=', '+('Double-Acting' if token.endswith('NDA') else 'Spring-Return')
   elif model=='LD-2000':
    if re.search(r'SQ NUT|MEM STOP|FLG IND|17-4PH',v['text']):reason='Special operator or stem option outside selected standard configuration'
    else:
     imageindex={'Bare Stem / Bare Shaft':0,'Lever-Lock Handle':2,'Gear Operator':1}[handle]
     suffix=', '+{'Bare Stem / Bare Shaft':'Bare Stem','Lever-Lock Handle':'Lever Lock','Gear Operator':'Gear Operated'}[handle]
   elif model=='WD-2000':
    if handle=='Bare Stem / Bare Shaft' or 'SON' in token:reason='No reviewed photo of the actual operator configuration'
    else:imageindex={'Lever-Lock Handle':0,'Gear Operator':1}[handle];suffix=', '+('Lever Lock' if imageindex==0 else 'Gear Operated')
   elif model=='LD-2022':
    if handle!='Lever-Lock Handle':reason='No reviewed photo of the actual operator configuration'
    else:suffix=', Lever Lock'
   elif token!=normal:reason='Special model, trim, cleaning or operator option outside selected base configuration'
   elif handle not in [None,'Standard Handwheel','CS Standard Lever Handle','CS Locking Lever Handle']:
    if model=='F-535-S6-F-66-FS' and handle=='Gear Operator':imageindex=1;suffix=', Gear Operated'
    else:reason='No reviewed photo of the actual operator configuration'
   if reason:
    excluded.append({'manufacturer':'NIBCO','sku':v['variantId'],'model':model,'description':v['text'],'reason':reason});continue
   rawsize=v['size']
   if ';' in rawsize:
    assert v['variantId'] in ['NG316FA','NG306FA','NL99J4A'] and v['text'].split()[1]=='1',v
    rawsize='1 in.'  # These three published descriptions explicitly say 1; the CMS facet erroneously contains 7/8 too.
   sizes=[normsize(s) for s in rawsize.split(' x ')];assert len(set(sizes))==1,(model,v)
   size,n=sizes[0];label=size+'"';pressure=400 if model in ['T-FP600A-LF','S-FP600A-LF'] and n>2 else cwp
   name=f'{label} {base}{suffix}'
   if kind=='Ball Valve' and connection=='Flanged' and not suffix:name+=', Lever Handle'
   key=f'nibco:{model}:{imageindex}'
   if key not in images:
    photo=j['viewModel']['familyImages'][imageindex]['featuredSrc']
    images[key]=make_image(key,photo,url,'Official manufacturer product photo, representative size in this exact model and operator configuration; internal trim variants may share the manufacturer exterior photo.')
   attrs={'Model':model,'Cold Working Pressure':str(pressure)+' psi','Manufacturer Description':v['text'],'Manufacturer Features':' | '.join(j.get('features',[]))}
   if handle:attrs['Operator']=handle
   if suffix and model=='TM-585-70-66-AP':attrs['Actuator']=suffix[2:]
   if 'Lead-Free' in base:attrs['Lead Free']='Yes'
   if 'PTFE' in base:attrs['Seat/Disc']='PTFE'
   aliases=list(dict.fromkeys(['NIBCO',model,v['variantId'],v['upc'],v['text'],'NIBCO '+model,'NIBCO '+v['variantId'],name.replace('Threaded','NPT')]))
   result.append({'family':'process-valves','manufacturer':'NIBCO','sku':v['variantId'],'model':model,'upc':v['upc'],'manufacturerDescription':v['text'],'displayName':name,'description':name,'material':material,'category':'Valves','fittingType':kind,'connectionType':connection,'connectionSizes':[label,label],'sizeLabel':label,'sizeNominal':n,'sizeUnit':'in','pressureClass':cls,'aliases':aliases,'imageKey':key,'sourceUrl':url,'listingUrl':v.get('cadbimLink') or url,'attributes':attrs})
 return result,images,excluded,sources

if __name__=='__main__':
 rows,images,excluded,sources=nibco_rows()
 w=SOURCE_CONFIG['watts'];rows+=w['rows'];sources+=w['sources'];excluded+=w.get('exclusions',[])
 for key,photo in w['images'].items():images[key]=make_image(key,photo['sourceUrl'],photo['sourcePage'],photo['notes'])
 dup={k:n for k,n in Counter(r['displayName'] for r in rows).items() if n>1}
 assert not dup,dup
 assert len({(r['manufacturer'],r['sku']) for r in rows})==len(rows)
 for r in rows:
  assert r['manufacturer'] in r['aliases'] and r['sku'] in r['aliases']
  assert r['imageKey'] in images
  assert r['displayName']==r['description'] and len(r['displayName'])<=255
 result={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in rows)),'modelCounts':dict(Counter(r['model'] for r in rows)),'sources':sources,'exclusions':excluded,'rows':rows,'images':images}
 OUT.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'rows':len(rows),'images':len(images),'models':result['modelCounts'],'excluded':len(excluded)},indent=2))
