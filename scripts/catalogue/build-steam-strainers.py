"""Build only explicit manufacturer articles with verified photographs; no database writes.
Watts 2026 order tables and Hoffman catalogue pp.119–121 supply article identities.
No sizes, pressure combinations, prices or availability are generated.
"""
import hashlib,io,json,re,subprocess
from pathlib import Path
from fractions import Fraction
from collections import Counter
import requests
from PIL import Image
P=Path('.tmp/steam-strainers');P.mkdir(parents=True,exist_ok=True)
CAT='https://www.watts.com/dfsmedia/0533dbba17714b1ab581ab07a4cbb521/18056-source/639017551510000000/pl-watts-2604.pdf'
HOFFMAN='https://s3.amazonaws.com/s3.supplyhouse.com/manuals/1344859234933/77278_PROD_FILE.pdf'
HOFFMAN_PRIMARY='https://www.xylem.com/siteassets/brand/bell-amp-gossett/resources/brochure/s-0692d-hs-pumps-brochure.pdf'
WFT='https://www.watts.com/dfsmedia/0533dbba17714b1ab581ab07a4cbb521/20518-source/639004241230000000/es-wft-pdf.pdf'
BASE='https://www.watts.com/products/plumbing-flow-control-solutions/'
PHOTOS={
 'wft-h':'183086-50060/639224730720000000','wft-c':'21733-50060/639250062340000000','97fb-ci':'21739-50060/639250062350000000',
 '77s':'25045-50060/639216960120000000','lf777':'21957-50060/639250062480000000','lf777-small':'80083-50060/639223338220000000','lfs777':'20664-50060/639250056130000000',
 '77f-di-125':'25048-50060/639216960240000000','77f-di-250':'21396-50060/639250062170000000','77f-csi':'21016-50060/639250056330000000',
 '87si':'22053-50060/639250068130000000','88s':'24993-50060/639216942360000000','88csi':'22054-50060/639250068130000000',
 '77f-cssi':'21017-50060/639250056330000000','97fb-cssi':'21989-50060/639250062500000000','wtd':'21737-50060/639216240110000000',
 'pump-simplex':'https://d3501hjdis3g5w.cloudfront.net/images/products/zoom/160029-1.jpg',
 'pump-duplex':'https://static.grainger.com/rp/s/is/image/Grainger/4RD33_AS01?%24adapimg%24=&hei=536&wid=536'}
# page, exact model regex, descriptive name, material, type, connection, class,
# working steam pressure, water/oil/gas pressure, photo, manufacturer series URL.
CONFIG=[
 (88,r'77SM1-20','Cast Iron Threaded Y-Strainer, 400 psi','Cast Iron','Y-Strainer','Threaded',None,250,400,'77s','77s'),
 (88,r'77F-DI-125','Cast Iron Class 125 Flanged Y-Strainer','Cast Iron','Y-Strainer','Flanged','125',125,200,'77f-di-125','77f-di-125'),
 (89,r'77F-DI-250','Ductile Iron Class 250 Flanged Y-Strainer','Ductile Iron','Y-Strainer','Flanged','250',250,500,'77f-di-250','77f-di-250'),
 (89,r'LF777M1-20|LF777M120|LF777M3-20|LF777-20|LF777-04|LF777-12','Lead-Free Bronze Threaded Y-Strainer, Solid Cap','Bronze','Y-Strainer','Threaded',None,125,400,'lf777','lf777'),
 (89,r'LFS777M1-20|LFS777M3-20','Lead-Free Bronze Solder Y-Strainer, Solid Cap','Bronze','Y-Strainer','Solder',None,125,400,'lfs777','lf777'),
 (92,r'88CSI-T','Carbon Steel Class 600 Threaded Y-Strainer','Carbon Steel','Y-Strainer','Threaded','600',600,1480,'88csi','88csi'),
 (92,r'77F-CSI','Carbon Steel Class 150 Flanged Y-Strainer','Carbon Steel','Y-Strainer','Flanged','150',150,285,'77f-csi','77f-csi'),
 (92,r'87SI-T','Stainless Steel Class 300 Threaded Y-Strainer','Stainless Steel','Y-Strainer','Threaded','300',300,720,'87si','87si'),
 (93,r'88S','Stainless Steel Class 600 Threaded Y-Strainer','Stainless Steel','Y-Strainer','Threaded','600',600,1440,'88s','88s'),
 (93,r'77F-CSSI','Stainless Steel Class 150 Flanged Y-Strainer','Stainless Steel','Y-Strainer','Flanged','150',150,275,'77f-cssi','77f-cssi'),
 (94,r'97FB-CIB','Cast Iron Class 125 Flanged Simplex Basket Strainer','Cast Iron','Basket Strainer','Flanged','125',125,200,'97fb-ci','97fb-ci'),
 (94,r'97FB-CSSIB','316 Stainless Steel Class 150 Flanged Simplex Basket Strainer','Stainless Steel','Basket Strainer','Flanged','150',None,275,'97fb-cssi','97fb-cssi'),
 (112,r'WFT-(?:15|30|75|125)','Cast Iron Threaded Float and Thermostatic Steam Trap','Cast Iron','Float and Thermostatic Steam Trap','Threaded',None,None,None,'wft-h','wft'),
 (113,r'WTD 600','Stainless Steel Threaded Thermodynamic Steam Trap, 600 psi','Stainless Steel','Thermodynamic Steam Trap','Threaded',None,600,None,'wtd','wtd'),
]
def fetch(url):
 p=P/(hashlib.sha256(url.encode()).hexdigest()+'.source')
 if not p.exists():
  r=requests.get(url,timeout=60);r.raise_for_status();p.write_bytes(r.content)
 return p.read_bytes()
def pdftext(url,name):
 b=fetch(url);p=P/(name+'.pdf');p.write_bytes(b);subprocess.run(['pdftotext','-layout',str(p),str(P/(name+'.txt'))],check=True)
 return (P/(name+'.txt')).read_text(),hashlib.sha256(b).hexdigest()
def sizevalue(s):return float(sum(Fraction(x) for x in s.split()))
def image(k,page):
 url=PHOTOS[k]
 if not url.startswith('https:'):url='https://www.watts.com/dfsmedia/0533dbba17714b1ab581ab07a4cbb521/'+url+'/product.jpg'
 raw=fetch(url);im=Image.open(io.BytesIO(raw)).convert('RGBA');native=im.size;im.thumbnail((1200,1200),Image.Resampling.LANCZOS)
 edge=int(max(im.size)/.9+.999);out=Image.new('RGBA',(edge,edge),'white');out.alpha_composite(im,((edge-im.width)//2,(edge-im.height)//2));buf=io.BytesIO();out.convert('RGB').save(buf,'WEBP',quality=94);b=buf.getvalue();sha=hashlib.sha256(b).hexdigest();path=Path('public/images/catalog/uploads')/('part-'+sha+'.webp');path.write_bytes(b)
 note='Official manufacturer product photo. Representative size in the exact stated material, connection and body pattern.'
 if k.startswith('pump-'):note='Genuine distributor photograph listed for the exact manufacturer SKU; representative receiver capacity within the same cast-iron '+('simplex' if k.endswith('simplex') else 'duplex')+' configuration. Manufacturer catalogue verifies assembly specifications. Source: '+('SupplyHouse' if k.endswith('simplex') else 'Grainger')+'.'
 return {'path':str(path),'url':'/api/catalogue/images/part-'+sha+'.webp','sha256':sha,'byteSize':len(b),'width':edge,'height':edge,'sourceWidth':native[0],'sourceHeight':native[1],'sourceSha256':hashlib.sha256(raw).hexdigest(),'sourceUrl':url,'sourcePage':page,'imageKind':'product-photo','notes':note+' Whole product retained with breathing room; no upscaling.'}

if __name__=='__main__':
 text,catsha=pdftext(CAT,'watts-catalog');pages=text.split('\f');htext,hsha=pdftext(HOFFMAN,'hoffman-catalog');wtext,wsha=pdftext(WFT,'wft-spec')
 rows=[];images={};counts={}
 for page,pattern,base,material,kind,conn,cls,wsp,wog,ph,slug in CONFIG:
  count=0
  for line in pages[page+1].splitlines():
   match=re.search(r'(?<![A-Z0-9])('+pattern+r')\s+(\d{7})\s+(\d+(?:\s+\d+/\d+|/\d+)?)\s+(\d{12})\b',line)
   if not match:continue
   model,sku,size,upc=match.groups();size=re.sub(r'\s+',' ',size);n=sizevalue(size);label=size+'"';name=label+' '+base;photo=ph
   attrs={'Model':model}
   if wsp:attrs['Working Steam Pressure']=str(wsp)+' psi'
   if wog:attrs['Water Oil Gas Pressure']=str(300 if model=='LF777-12' else wog)+' psi'
   if model.startswith('LF'):
    attrs['Lead Free']='Yes';attrs['Body Alloy']='Copper-Silicon Alloy'
    if conn=='Threaded' and n<=.375:photo='lf777-small'
   if model=='77SM1-20':attrs['Screen']='20 mesh';attrs['Blowdown']='Tapped'
   if model=='97FB-CSSIB':attrs['Material Grade']='316 stainless steel'
   if model.startswith('WFT-'):
    pressure=int(model.split('-')[1]);body='H' if n<1.25 or (n==1.25 and pressure in [15,30]) else 'C';photo='wft-'+body.lower();name+=', '+str(pressure)+' psi, '+body+'-Pattern';attrs.update({'Maximum Operating Pressure':str(pressure)+' psi','Body Pattern':body,'Body Material Grade':'ASTM A126 Class B cast iron'})
   path=('hydronic-steam-heating/steam-traps/' if kind.endswith('Steam Trap') else 'strainers/'+('basket-strainers/' if kind=='Basket Strainer' else 'y-wye-strainers/'))+slug;url=BASE+path
   key='watts-steam:'+photo
   if key not in images:images[key]=image(photo,url)
   orig=match.group(0);manufacturerDescription=base+'; '+orig
   rows.append({'family':'steam-traps' if kind.endswith('Steam Trap') else 'strainers','manufacturer':'Watts','sku':sku,'model':model,'upc':upc,'manufacturerDescription':manufacturerDescription,'displayName':name,'description':name,'material':material,'category':'Steam & Condensate' if kind.endswith('Steam Trap') else 'Strainers','fittingType':kind,'connectionType':conn,'connectionSizes':[label,label],'sizeLabel':label,'sizeNominal':n,'sizeUnit':'in','pressureClass':cls,'aliases':['Watts',sku,model,upc,'Watts '+model,'Watts '+sku,manufacturerDescription],'imageKey':key,'sourceUrl':CAT,'sourcePage':page,'listingUrl':url,'sourceRecord':orig,'attributes':attrs})
   count+=1
  assert count>0,(page,pattern);counts[pattern]=count
 # Every stock unit below is an explicit row in the manufacturer's ordering table, p.121.
 pumpdata=[('160029','WC-6-20-B',6,9,22,6000,'Simplex'),('160030','WC-8-20-B',9,12,21,8000,'Simplex'),('160031','WC-12-20-B',14,18,20,12000,'Simplex'),('160032','WCD-12-20-B MA',14,18,20,12000,'Duplex')]
 for sku,model,volume,gpm,pressure,edr,design in pumpdata:
  lines=[l.strip() for l in htext.splitlines() if sku in l];assert len(lines)==1 and model in lines[0],(sku,lines)
  photo='pump-'+design.lower();key='hoffman:'+photo
  url='https://www.supplyhouse.com/Hoffman-'+sku+'-'+{'160029':'WC6-20B-Watchman-Cast-Iron-Receiver-Condensate-Unit','160030':'WC8-20B-Watchman-Cast-Iron-Receiver-Condensate-Unit','160031':'WC12-20B-Watchman-Cast-Iron-Receiver-Condensate-Unit','160032':'WCD-12-20B-MA-Watchman-Condensate-Unit-w-Mechanical-Alternator'}[sku]
  if key not in images:images[key]=image(photo,'https://www.grainger.com/product/HOFFMAN-Condensate-Return-System-Duplex-4RD33' if design=='Duplex' else url)
  manufacturer='Hoffman Specialty';name=f'Cast Iron {design} Condensate Return Unit, {volume} Gallon, 1/3 HP, 115V, {gpm} GPM'
  attrs={'Model':model,'Receiver Capacity':str(volume)+' US gal','Motor Power':'1/3 HP per pump','Supply Voltage':'115 V, single phase; field convertible to 230 V','Pump Capacity':str(gpm)+' GPM','Discharge Pressure':str(pressure)+' psig','System Rating':str(edr)+' sq ft EDR','Pumps':'2' if design=='Duplex' else '1','Control':'Mechanical alternator' if design=='Duplex' else 'Float switch','Inlet':'2 in NPT','Discharge':'3/4 in NPT','Source Note':'Article ordering table from manufacturer-authored Hoffman catalogue p.121 hosted by SupplyHouse; specs cross-checked against Xylem current Watchman brochure.'}
  original='Watchman Series WC Cast Iron Receiver Condensate Units; '+re.sub(r'\s+',' ',lines[0])
  rows.append({'family':'condensate-equipment','manufacturer':manufacturer,'sku':sku,'model':model,'manufacturerDescription':original,'displayName':name,'description':name,'material':'Cast Iron','category':'Steam & Condensate','fittingType':'Condensate Return Unit','connectionType':'Threaded','connectionSizes':['2"','3/4"'],'sizeLabel':'3/4" discharge','sizeNominal':.75,'sizeUnit':'in','pressureClass':None,'aliases':[manufacturer,'Hoffman','Bell & Gossett','Xylem',sku,model,model.replace('-',''),'Watchman '+model,original],'imageKey':key,'sourceUrl':HOFFMAN,'sourcePage':121,'listingUrl':url,'attributes':attrs})
 assert len(set((r['manufacturer'],r['sku']) for r in rows))==len(rows)
 assert len(set(r['displayName'] for r in rows))==len(rows)
 assert counts=={'77SM1-20':9,'77F-DI-125':9,'77F-DI-250':8,'LF777M1-20|LF777M120|LF777M3-20|LF777-20|LF777-04|LF777-12':11,'LFS777M1-20|LFS777M3-20':5,'88CSI-T':3,'77F-CSI':6,'87SI-T':7,'88S':1,'77F-CSSI':6,'97FB-CIB':8,'97FB-CSSIB':5,'WFT-(?:15|30|75|125)':20,'WTD 600':3},counts
 exclusions=[{'manufacturer':'Watts','models':['77SI','87SI-SW','88CSI-SW','LF777S','LFS777S','77F-DI-FDA','77F-SS','77G-SS','97FB-FSFE'],'reason':'Alternative body, socket-weld, tapped cap, coating, grooved or fire-service configurations outside this selected range; not merged with included SKUs. Socket-weld product galleries showed threaded ends, so omitted until matching photos are verified.'},{'manufacturer':'Watts','models':['G','GH','MG'],'reason':'Radiator-trap series gallery mixes float and thermostatic models; exact model photo attribution unresolved. WFT and WTD complete trap assemblies included.'},{'manufacturer':'Hoffman Specialty','models':['WCS','WCD-30-30-B-MA','SCC'],'reason':'Additional steel receiver, larger duplex, and panel-controlled variants not included in this verified cast-iron stock selection.'}]
 out={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in rows)),'modelCounts':dict(Counter(r['model'] for r in rows)),'sources':[{'url':CAT,'sha256':catsha,'type':'manufacturer-catalog','title':'Watts 2026 PL-Watts 2604','pages':[88,89,92,93,94,112,113]},{'url':WFT,'sha256':wsha,'type':'manufacturer-specification','title':'ES-WFT body-pattern and operating-pressure matrix'},{'url':HOFFMAN,'sha256':hsha,'type':'manufacturer-catalog-distributor-mirror','title':'Hoffman Specialty catalogue, Pumps pp.119–121'},{'url':HOFFMAN_PRIMARY,'type':'manufacturer-brochure','title':'Xylem Hoffman Watchman current brochure, model/specification cross-check'}],'exclusions':exclusions,'rows':rows,'images':images}
 Path('data/catalogue/steam-strainers.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'rows':len(rows),'images':len(images),'counts':out['counts'],'models':out['modelCounts']},indent=2))
