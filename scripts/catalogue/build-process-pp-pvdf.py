"""Source explicit current GF PP/PVDF article rows and genuine family photos.
Reads public manufacturer XLS and catalogue JSON; never writes the database.
"""
import hashlib,io,json,math,re,sys,time,html
from pathlib import Path
from collections import Counter,defaultdict
from fractions import Fraction
import openpyxl,requests
from PIL import Image,ImageDraw

CACHE=Path('.tmp/process-industrial'); CACHE.mkdir(exist_ok=True)
BASE='https://www.gfps.com/com/en/products-solutions.commerce.api.json/catalog/'
XLS='https://www.gfps.com/content/dam/gfps/us/products/price-lists/gfps/gfps-us-pricelist-eps-pressure-en.xlsx'
S=requests.Session();S.headers['User-Agent']='Mozilla/5.0'
SOURCES={};FAILURES=[]
# Independently reviewed manufacturer assets. Product illustrations and cutaway
# graphics do not satisfy this catalogue import's genuine photograph contract.
NON_PHOTOGRAPHIC={'kvWJz2dxM','6BERwE7J2','qD3q9OM0m','2yv4kvKJq','Gobg8banA','qy9AO916z','Axl2Llyzr','wjwKawaYk'}
PHOTO_ALTERNATES={'wJrNw0QZA':'09jVJmN1L'}
def sha(b):return hashlib.sha256(b).hexdigest()
def fetch(url,path):
 p=CACHE/path
 if not p.exists():
  try:
   r=S.get(url,timeout=15);r.raise_for_status();p.write_bytes(r.content)
  except requests.RequestException as e:
   FAILURES.append({'url':url,'reason':str(e).split(' for url')[0]});return None
 b=p.read_bytes();SOURCES[url]={'url':url,'sha256':sha(b),'cachePath':str(p)};return b

def clean(s):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',str(s)))).strip()

def number(value):
 return float(sum(Fraction(p) for p in clean(value).replace('∕','/').replace('⁄','/').replace('-',' ').split()))

def regional_sizes(description):
 # Leading dimensions only; the following 45/90 degree angle is not a size.
 atom=r'(?:\d+\s*[- ]\s*\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)'
 match=re.match(r'^[*^\s]*('+atom+r'(?:\s*["”]?\s*[xX]\s*'+atom+r')*)',description)
 return [number(v.strip(' "”')) for v in re.split('[xX]',match[1])] if match else []

def selected():
 b=fetch(XLS,'gf-download-1.xlsx');w=openpyxl.load_workbook(io.BytesIO(b),read_only=True,data_only=True)
 rows=[]
 for sheet in ['PROGEF PP','SYGEF PVDF']:
  section='';group=0;prev=False
  for i,values in enumerate(w[sheet].iter_rows(max_col=5,values_only=True),1):
   sku,desc,unit=values[:3]
   if sku is None:
    if desc:section=str(desc)
    if prev:group+=1
    prev=False;continue
   if unit not in ['ea','M']:continue
   prev=True
   if not ('PIPE -' in section or 'FUSION FITTINGS' in section):continue
   if any(x in str(desc) for x in ['inventory is depleted','DRIVE','TOOL']):continue
   rows.append({'sku':str(sku),'manufacturerDescription':str(desc),'sourceSheet':sheet,'sourceRow':i,'sourceSection':section,'group':f'{sheet}:{group}','orderUnit':unit})
 return rows

def discover(rows):
 articles={};products={};seen=set();fails=[]
 # One family response supplies its explicitly published articles. Fetch individual
 # articles only when a family has not already supplied the requested current SKU.
 for index,row in enumerate(rows):
  code=row['sku']
  if code in articles:continue
  # GF's North American S-suffixed pipe codes have distinct packaging. Do not
  # silently substitute unsuffixed global codes.
  raw=fetch(BASE+'article?code='+code,'article-'+code+'.json')
  if not raw:continue
  try:a=json.loads(raw)
  except ValueError:continue
  if not a.get('code') or a.get('error'):continue
  articles[a['code']]=a
  pc=a.get('product',{}).get('code')
  if pc and pc not in seen:
   seen.add(pc)
   pr=fetch(BASE+'product?code='+pc,'product-'+pc+'.json')
   if pr:
    p=json.loads(pr);products[pc]=p
    for v in p.get('articles',[]):
     v['product']={k:p.get(k) for k in ['code','name','description','active']}
     articles[v['code']]=v
  if len(seen)%10==0:print('discovered',len(seen),'families',len(articles),'articles',index+1,'/',len(rows),flush=True)
 (CACHE/'pp-pvdf-discovery.json').write_text(json.dumps({'rows':rows,'articles':articles,'products':products,'sources':list(SOURCES.values()),'failures':FAILURES},indent=2))
 print('complete',len(rows),len(articles),len(products),'failures',len(FAILURES),flush=True)
 return articles,products

def picture(key,a,images):
 url=a.get('imageUrl')
 if not url:return None
 original_key=url.rsplit('/',1)[-1]
 if original_key in NON_PHOTOGRAPHIC:return None
 if original_key in PHOTO_ALTERNATES:
  alternate=url.rsplit('/',1)[0]+'/'+PHOTO_ALTERNATES[original_key]
  assert alternate in a.get('imageUrls',[]),'Alternate photograph must belong to this manufacturer article'
  url=alternate
 key='gf:'+url.rsplit('/',1)[-1]
 if key in images:return key
 raw=fetch(url,'image-'+key[3:]+'.jpg')
 if not raw:return None
 im=Image.open(io.BytesIO(raw)).convert('RGB');native=im.size
 if max(native)<250:return None
 im.thumbnail((900,900),Image.Resampling.LANCZOS)
 edge=max(300,math.ceil(max(im.size)/.88));canvas=Image.new('RGB',(edge,edge),'white');canvas.paste(im,((edge-im.width)//2,(edge-im.height)//2))
 out=io.BytesIO();canvas.save(out,'WEBP',quality=94);b=out.getvalue();digest=sha(b)
 file=Path('public/images/catalog/uploads')/('part-'+digest+'.webp');file.write_bytes(b)
 images[key]={'path':str(file),'url':'/api/catalogue/images/'+file.name,'sha256':digest,'byteSize':len(b),'width':edge,'height':edge,'sourceWidth':native[0],'sourceHeight':native[1],'sourceUrl':url,'sourcePage':a.get('datasheetUrl'),'sourceSha256':sha(raw),'imageKind':'product-photo','notes':'Official GF product-family photograph, representative of the stated fitting pattern; full image retained, framed on white without upscaling.'}
 return key

def build(rows,articles,products):
 out=[];excluded=[];images={};codes=set();names={}
 for r in rows:
  sku=r['sku'];a=articles.get(sku)
  def exclude(reason):excluded.append({**r,'reason':reason})
  if sku in codes:continue
  if not a or not a.get('active'):exclude('Current article specification unavailable or inactive in manufacturer catalogue.');continue
  p=a.get('product',{});title=clean(p.get('name',''));f=a.get('features',{});main=f.get('main_measurement',[])
  facets=defaultdict(list)
  for x in f.get('facet',[]):facets[clean(x['type'])].append(clean(x['value']))
  vals={clean(x['type']):clean(x['value']) for x in main}
  texts=[clean(x) for v in f.get('article_text_category',{}).values() for x in v.get('text',[])]
  modeltexts=[clean(x) for k,v in f.get('article_text_category',{}).items() if k.lower().startswith('model') for x in v.get('text',[])]
  rawdesc=r['manufacturerDescription'];pn=vals.get('PN')
  sourcepn=re.search(r'\bPN\s*(\d+(?:\.\d+)?)\b',rawdesc,re.I)
  if sourcepn and pn and float(pn)!=float(sourcepn.group(1)):
   exclude('Current regional table pressure conflicts with manufacturer article pressure.');continue
  # Several flush reducers have no material facet but an explicit model text.
  textmaterial=next((m[1] for t in modeltexts if (m:=re.match(r'Material:\s*(PP-H|PP-R|PVDF-HP|PVDF)\b',t))),None)
  facetmaterial=(facets.get('Plastic Material') or facets.get('Material') or [''])[0]
  if textmaterial and facetmaterial in ['PP-H','PP-R','PVDF','PVDF-HP'] and textmaterial!=facetmaterial:
   exclude('Manufacturer model text and article facet disagree on polymer grade.');continue
  material=textmaterial or facetmaterial
  if material not in ['PP-H','PP-R','PP','PP-n','PPN','PVDF','PVDF-HP']:
   exclude('Cannot verify the required polypropylene/PVDF material grade.');continue
  # Systems facets include compatibility (notably CONTAIN-IT Plus). The actual
  # product title identifies Standard/Plus/Natural and must not be upgraded by
  # another compatible system listed on the article.
  systemmatch=re.match(r'((?:PROGEF|SYGEF)\s+(?:Standard|Plus|Natural))\b',title,re.I)
  system=systemmatch[1] if systemmatch else title.split(' ')[0]
  highpurity=bool(re.search(r'\bPlus\b',system)) or material=='PVDF-HP'
  natural=bool(re.search(r'\bNatural\b',system))
  sourcepurity=bool(re.search(r'\b(?:Plus|HP)\b',rawdesc,re.I))
  if highpurity != sourcepurity:
   exclude('Regional description and global article disagree on standard versus high-purity series.');continue
  if natural != bool(re.search(r'\bPPn\b|\bNatural\b',rawdesc,re.I)):
   exclude('Regional description and global article disagree on natural polypropylene series.');continue
  sourcegrade=re.search(r'\bPP-[HR]\b',rawdesc)
  if sourcegrade and material not in ['PP',sourcegrade.group(0)]:
   exclude('Regional description and global article disagree on polymer grade.');continue
  metric=[x for x in main if clean(x['type']) in ['d','d1','d2','d3'] and x.get('unit')=='mm']
  # Verified in the 106596 manufacturer drawing: D is the larger fusion end
  # of this reducing bush, not a generic body diameter. Never generalize D.
  if p.get('code')=='106596':
   metric=[x for typ in ['D','d'] for x in main if clean(x['type'])==typ and x.get('unit')=='mm']
  if not metric:
   exclude('No unambiguous metric connecting diameter in article record.');continue
  if any(not re.fullmatch(r'\d+(?:\.\d+)?',clean(x['value'])) for x in metric):
   exclude('Non-numeric diameter compatibility range requires manual configuration.');continue
  sizes=[clean(x['value'])+' mm' for x in metric]
  # Size and d2 expressed in inches are exact mixed threaded ends, never an
  # approximate inch conversion of the metric fusion diameter.
  inchtypes=['Size','d2','d1','NPT','Rp','Rc','R','G']
  # These two ANSI flange families explicitly publish both the metric fusion
  # diameter and nominal flange size as separate d fields with different units.
  if p.get('code') in ['106575','106594']:inchtypes.append('d')
  inchends=[x for x in main if x.get('unit') in ['inch','in'] and clean(x['type']) in inchtypes]
  sanitary='Sanitary end' in facets.get('End Connection',[]) or 'sanitary adaptor' in title.lower()
  flanged='flange adaptor' in title.lower()
  if p.get('code')=='106672':
   # The regional article description supplies the nominal sanitary clamp size;
   # current D1 is the flange OD and must not be substituted for that nominal size.
   clamp=re.search(r'with\s+([\d./ ]+)"\s+Sanitary Adapter',rawdesc,re.I)
   if not clamp:exclude('Published sanitary clamp size unavailable.');continue
   value=Fraction(clamp[1].strip())
   whole,remainder=divmod(value.numerator,value.denominator)
   size=(str(whole)+' ' if whole and remainder else str(whole) if whole else '')+(str(remainder)+'/'+str(value.denominator) if remainder else '')
   inchends.append({'type':'Size','value':size,'unit':'inch'})
  thread=[] if sanitary or flanged else inchends
  sizes += [clean(x['value']).replace('∕','/').replace('⁄','/')+'"' for x in inchends]
  if not inchends and len(set(sizes))==1:sizes=sizes[:1]
  label=' x '.join(sizes);nominal=max(float(clean(x['value'])) for x in metric)
  # Every stated leading diameter must match a verified connecting end. This
  # also checks mixed metric/threaded ends, without treating fractions as mm.
  source_sizes=regional_sizes(rawdesc)
  published_sizes=[number(x['value']) for x in metric+inchends]
  if any(n not in published_sizes for n in source_sizes):
   exclude('Regional leading sizes conflict with the manufacturer connection sizes.');continue
  low=title.lower();ispipe=' pipe' in low
  joints=facets.get('Jointing Technology',[])
  if ispipe:connection='Plain End'
  elif 'Electrofusion' in ' '.join(joints)+title:connection='Electrofusion'
  elif 'Socket Fusion' in joints:connection='Socket Fusion'
  elif any('Butt' in x for x in joints) or any('Conventional butt-welding' in x for x in modeltexts):connection='Butt Fusion'
  elif any('Infrared' in x for x in joints) or re.search(r'\bIR\b',vals.get('FM','')):connection='Infrared Fusion'
  elif any('Bead' in x for x in joints) or re.search(r'\bBCF\b',vals.get('FM','')):connection='Bead and Crevice Free Fusion'
  elif 'Socket' in facets.get('End Connection',[]):connection='Socket Fusion'
  elif 'Spigot' in facets.get('End Connection',[]):connection='Butt Fusion'
  else:
   exclude('No unambiguous fusion/end connection type.');continue
  gender=''
  if thread:
   tt=vals.get('Thread Type') or next((clean(x['type']) for x in thread if clean(x['type']) in ['NPT','Rp','Rc','R','G']),'') or next((x for x in facets.get('Thread Type',[]) if x!='G'),'')
   if not tt:exclude('Mixed inch connection has no verified thread standard.');continue
   endtypes=facets.get('End Connection',[])
   if 'Female thread' in endtypes or re.search(r'\bfemale\b',title,re.I) or tt in ['Rp','Rc']:gender='Female'
   elif 'Male thread' in endtypes or re.search(r'\bmale\b',title,re.I) or tt=='R':gender='Male'
   # Instrument fitting 106645 states NPT without gender; retain only what is
   # published, rather than inferring its gender from a generic family name.
   connection+=' x '+(' '.join([gender,tt]).strip())
  else:tt=''
  if sanitary:connection+=' x Sanitary Clamp'
  if 'flange adaptor' in low:connection+=' x Flanged'
  if 'hose' in low:connection+=' x Hose'
  # Manufacturer family descriptions define the pattern; codes and provenance
  # remain aliases/attributes rather than being appended to the display name.
  kind=title
  kind=re.sub(r'^(?:PROGEF|SYGEF)\s*(?:Standard|Plus|Natural)?\s*','',kind,flags=re.I)
  kind=re.split(r'\b(?:SDR|PN)\s*\d',kind,maxsplit=1,flags=re.I)[0].strip(' ,-/')
  kind=re.sub(r'\b(?:PP-[HR]|PVDF(?:-HP)?)\b','',kind).strip()
  kind=re.sub(r'\s+',' ',kind)
  kind=kind.replace('adaptor','adapter').replace('Adaptor','Adapter')
  kind=re.sub(r'\bPP\s+d\d+\s*[-–]\s*\d+\s*mm\b','',kind,flags=re.I).strip()
  kind=re.sub(r'^Electrofusion\s+','',kind,flags=re.I)
  if sanitary and 'ASME BPE' in title:kind+=' (ASME BPE)'
  if ispipe:kind='Pipe'
  if not kind or len(kind)>85:exclude('Family needs a concise verified basic description.');continue
  kind=kind[0].upper()+kind[1:]
  # Include seals and nominal wall because otherwise these are real but
  # visually indistinguishable SKU variants.
  seal='/'.join(facets.get('Sealing Material',[]))
  # Some unions publish FKM and its colour only in the actual product title.
  title_seal=re.search(r'\b(EPDM|FKM|FPM|FFKM|PTFE|NBR)(?:\s+(white|black))?\b',title)
  if title_seal:
   if seal and title_seal[1].replace('FPM','FKM') not in seal.replace('FPM','FKM'):
    exclude('Manufacturer product title and article facet disagree on seal material.');continue
   seal=title_seal[0]
  source_seals=re.findall(r'\b(?:EPDM|FKM|FPM|FFKM|PTFE|NBR)\b',rawdesc)
  if any(s.replace('FPM','FKM') not in seal.replace('FPM','FKM') for s in source_seals):
   exclude('Regional seal material cannot be verified against the article.');continue
  sdr=vals.get('SDR') or '/'.join(facets.get('SDR',[]))
  if not sdr:
   sm=re.search(r'\bSDR\s*(\d+(?:[.,]\d+)?(?:[/-]\d+(?:[.,]\d+)?)?)',title)
   if sm:sdr=sm[1]
  if sdr and not sdr.startswith('SDR'):sdr='SDR'+sdr
  mat=('Natural '+material) if natural else material
  if highpurity and material!='PVDF-HP':mat+=' High Purity'
  pressure='PN'+pn if pn else ''
  name=' '.join(x for x in [label,mat,pressure,sdr,connection,kind] if x)
  if seal and seal.lower() not in kind.lower():name+=' ('+seal+')'
  if ispipe:
   length=next((re.search(r'Pipe length:\s*(\d+)\s*mm',t,re.I).group(1) for t in texts if re.search(r'Pipe length:\s*(\d+)\s*mm',t,re.I)),None)
   if not length:
    metres=next((re.search(r'\bLength:\s*(\d+(?:\.\d+)?)\s*m\s+units\b',t,re.I).group(1) for t in texts if re.search(r'\bLength:\s*(\d+(?:\.\d+)?)\s*m\s+units\b',t,re.I)),None)
    if metres:length=str(float(metres)*1000)
   if length:name+=' x '+str(float(length)/1000).removesuffix('.0')+' m'
  if name.lower() in names:
   exclude('Same visible specification as '+names[name.lower()]+'; distinct order configuration not established.');continue
  if len(name)>255:exclude('Description requires manual simplification.');continue
  key=picture('unused',a,images)
  if not key:
   exclude('Available manufacturer image is a drawing, cutaway or product illustration rather than a genuine photograph.' if a.get('imageUrl','').rsplit('/',1)[-1] in NON_PHOTOGRAPHIC else 'Matching product image unavailable or too small.');continue
  names[name.lower()]=sku
  item={
   'manufacturer':'GF Piping Systems','sku':sku,'family':'industrial-pvdf' if material.startswith('PVDF') else 'industrial-polypropylene',
   'material':'PVDF' if material.startswith('PVDF') else 'Polypropylene','category':'Pipe' if ispipe else 'Plastic Fusion Fittings',
   'connectionType':connection,'connectionSizes':sizes,'sizeUnit':'mm','sizeBasis':'Outside diameter','sizeNominal':nominal,'sizeLabel':label,
   'displayName':name,'description':name,'fittingType':kind,'sourceUrl':XLS,'sourceSheet':r['sourceSheet'],'sourceRow':r['sourceRow'],
   'manufacturerDescription':rawdesc,'model':system,'grade':material,'imageKey':key,
   'aliases':list(dict.fromkeys([sku,'GF','Georg Fischer','GF Piping Systems',system,title,clean(rawdesc)])),
   'productPage':BASE+'article?code='+sku,'attributes':{'manufacturer_article_features':json.dumps(f,separators=(',',':')),'regional_section':r['sourceSection'],'regional_order_unit':r['orderUnit'],'catalogue_product_code':p.get('code',''),'size_basis':'Outside diameter'},
  }
  item['aliases']=[x for x in item['aliases'] if x and len(x)<=255]
  if pn:item['pressureClass']='PN'+pn
  if seal:item['sealMaterial']=seal
  if sdr:item['sdr']=sdr
  if tt:item['threadStandard']=tt
  if gender:item['threadGender']=gender
  if joints:item['fusionTechnologies']=joints
  if facets.get('End Connection'):item['connectionEndTypes']=facets['End Connection']
  if ispipe and length:item['length']=str(float(length)/1000).removesuffix('.0')+' m'
  if texts:item['manufacturerNote']=' | '.join(texts)
  out.append(item)
  codes.add(sku)
 # All final used image mappings only; original source photographs are archived.
 used={r['imageKey'] for r in out};images={k:v for k,v in images.items() if k in used}
 result={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in out)),'coverageByType':dict(Counter(r['fittingType'] for r in out)),
 'notes':['Only explicit current regional SKUs with matching published manufacturer article specifications and photographs are imported.','Regional/global pressure, grade, size and purity conflicts are excluded. No supplier prices are imported.','Fusion sizes are actual metric outside diameters; nominal pipe inch approximations are not substituted.'],
 'sources':list(SOURCES.values()),'exclusions':excluded,'rows':out,'images':images}
 Path('data/catalogue/process-pp-pvdf.json').write_text(json.dumps(result,indent=2)+'\n')
 for start in range(0,len(images),20):
  portion=list(images.items())[start:start+20];canvas=Image.new('RGB',(1400,math.ceil(len(portion)/5)*310),'#eeeeee');draw=ImageDraw.Draw(canvas)
  for i,(k,im) in enumerate(portion):
   im2=Image.open(im['path']);im2.thumbnail((270,250));x=(i%5)*280;y=(i//5)*310;canvas.paste(im2,(x+(280-im2.width)//2,y));name=next(r['fittingType'] for r in out if r['imageKey']==k)
   draw.text((x+5,y+252),k+'\n'+name+'\n'+str(im['sourceWidth'])+'x'+str(im['sourceHeight']),fill='black')
  canvas.save(CACHE/('pp-pvdf-contact-'+str(start//20)+'.jpg'),quality=93)
 print(json.dumps({'rows':len(out),'images':len(images),'excluded':len(excluded),'counts':result['counts']},indent=2))

if __name__=='__main__':
 rows=selected();print('Current PP/PVDF candidate rows',len(rows),flush=True)
 if '--discover-only' in sys.argv:discover(rows)
 else:
  d=json.loads((CACHE/'pp-pvdf-discovery.json').read_text());SOURCES.update({v['url']:v for v in d['sources']});build(rows,d['articles'],d['products'])
