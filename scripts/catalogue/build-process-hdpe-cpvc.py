"""Build exact industrial PE100 fusion products and CPVC plain-end pipe.

Manufacturer PDF/XLS supply the bounded candidate range; current GF article and
product APIs verify identities/specifications. No database writes or pricing.
Run --discover to refresh catalogue discovery before building from cached data.
"""
import hashlib, html, io, json, math, re, subprocess, sys
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path
import openpyxl, requests
from PIL import Image, ImageDraw, ImageOps

CACHE=Path('.tmp/process-hdpe-cpvc'); CACHE.mkdir(exist_ok=True)
BASE='https://www.gfps.com/com/en/products-solutions.commerce.api.json/catalog/'
PDF='https://www.gfps.com/content/dam/gfps/us/products/piping-systems/ecofit/gfps-us-catalog-ecofit-polyethylene-en.pdf'
XLS='https://www.gfps.com/content/dam/gfps/us/products/price-lists/gfps/gfps-us-pricelist-cpvc-pipe-en.xlsx'
OUT=Path('data/catalogue/process-hdpe-cpvc.json')
S=requests.Session();S.headers['User-Agent']='Mozilla/5.0'
SOURCES={};IMAGES={};EXCLUDED=[]
BAD_IMAGES={'7gMdwM8Ke':'Dimension drawing, not a photograph.',
            'wxOEkOVZN':'CAD flange illustration, not a photograph.'}


def sha(b):return hashlib.sha256(b).hexdigest()
def clean(s):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',str(s)))).strip()
def fetch(url,name):
    path=CACHE/name
    if not path.exists():
        r=S.get(url,timeout=30);r.raise_for_status();path.write_bytes(r.content)
    raw=path.read_bytes()
    SOURCES[url]={'url':url,'sha256':sha(raw),'cachePath':str(path)}
    return raw


def selected():
    pdf=fetch(PDF,'ecofit.pdf')
    subprocess.run(['pdftotext','-layout',str(CACHE/'ecofit.pdf'),str(CACHE/'ecofit.txt')],check=True)
    rows=[]
    for pi,page in enumerate((CACHE/'ecofit.txt').read_text().split('\f'),1):
        if not 4<=pi<=20:continue
        for li,line in enumerate(page.splitlines(),1):
            m=re.search(r'\b((?:193|753|700|153))\s+(\d{3})\s+(\d{3})\b',line)
            if m:rows.append({'sku':''.join(m.groups()),'sourcePage':pi,'sourcePrintedPage':pi+200,
                             'sourceRow':li,'sourceLine':line.strip(),'material':'HDPE'})
    w=openpyxl.load_workbook(io.BytesIO(fetch(XLS,'cpvc-pipe.xlsx')),read_only=True,data_only=True)
    for sn in ['ChlorFIT® CPVC80 CORZAN®','CPVC40 CORZAN®']:
        for i,v in enumerate(w[sn].values,1):
            if isinstance(v[0],str) and re.match('H0[48]0',v[0]) and isinstance(v[1],str) and "20' Plain End" in v[1]:
                rows.append({'sku':v[0],'sourceSheet':sn,'sourceRow':i,'sourceLine':v[1],'material':'CPVC'})
    return rows


def discover(rows):
    articles={};products={};failures=[]
    for r in rows:
        code=r['sku']
        if code in articles:continue
        try:
            a=json.loads(fetch(BASE+'article?code='+code,'article-'+code+'.json'))
            if not a.get('code'):continue
            articles[code]=a;pc=a.get('product',{}).get('code')
            if pc and pc not in products:
                p=json.loads(fetch(BASE+'product?code='+pc,'product-'+pc+'.json'));products[pc]=p
                for v in p.get('articles',[]):
                    v['product']={k:p.get(k) for k in ['code','name','description','active']};articles[v['code']]=v
        except (requests.RequestException,ValueError) as e:
            failures.append({'sku':code,'reason':str(e)})
    (CACHE/'discovery.json').write_text(json.dumps({'rows':rows,'articles':articles,'products':products,
        'sources':{u:m['cachePath'] for u,m in SOURCES.items()},'failures':failures},indent=2))


def photograph(a):
    url=a.get('imageUrl')
    if not url:return None
    ident=url.rsplit('/',1)[-1]
    if ident in BAD_IMAGES:return None
    key='gf:'+ident
    if key in IMAGES:return key
    raw=fetch(url,'image-'+ident+'.jpg');im=Image.open(io.BytesIO(raw)).convert('RGB');native=im.size
    if max(native)<300:return None
    im.thumbnail((1000,1000),Image.Resampling.LANCZOS)
    edge=math.ceil(max(im.size)/.88);canvas=Image.new('RGB',(edge,edge),'white')
    canvas.paste(im,((edge-im.width)//2,(edge-im.height)//2));b=io.BytesIO();canvas.save(b,'WEBP',quality=95)
    data=b.getvalue();path=Path('public/images/catalog/uploads')/('part-'+sha(data)+'.webp');path.write_bytes(data)
    IMAGES[key]={'path':str(path),'url':'/api/catalogue/images/'+path.name,'sha256':sha(data),'byteSize':len(data),
        'width':edge,'height':edge,'sourceWidth':native[0],'sourceHeight':native[1],
        'sourceUrl':url,'sourcePage':BASE+'article?code='+a['code'],'sourceSha256':sha(raw),
        'imageKind':'product-photo','notes':'Official GF photo mapped to the exact catalogue article/family. Representative across listed diameters and wall grades; full source composition retained with white padding and no upscaling.'}
    return key


def inch(v):
    v=clean(v).replace('∕','/').replace('⁄','/').replace('-', ' ')
    n=sum(Fraction(x) for x in v.split())
    return v+'"',float(n)


def build(rows,d):
    out=[];seen=set()
    for r in rows:
        sku=r['sku'];a=d['articles'].get(sku)
        if sku in seen:continue
        seen.add(sku)
        def exclude(reason):EXCLUDED.append({**r,'reason':reason})
        if not a or not a.get('active'):
            exclude('Exact article not available/active in current manufacturer catalogue.');continue
        p=a['product'];title=clean(p['name']);low=title.lower();f=a.get('features',{})
        facet=defaultdict(list)
        for x in f.get('facet',[]):facet[clean(x['type'])].append(clean(x['value']))
        main={clean(x['type']):clean(x['value']) for x in f.get('main_measurement',[])}
        texts=[clean(x) for v in f.get('article_text_category',{}).values() for x in v.get('text',[])]
        attrs={'manufacturer_article_features':json.dumps(f,separators=(',',':')),
               'catalogue_product_code':p['code'],'manufacturer_article_url':BASE+'article?code='+sku}
        for group in ('main_measurement','additional_measurement'):
            for x in f.get(group,[]):attrs[clean(x['type'])]=' '.join(filter(None,[clean(x['value']),x.get('unit')]))
        for k,vals in facet.items():attrs[k]='; '.join(vals)
        ispipe=' pipe' in low
        if r['material']=='CPVC':
            if 'PVC-C' not in facet['Plastic Material'] or not ispipe:
                exclude('Current article does not verify CPVC pipe.');continue
            if not ('Plain End Pipe' in title and '20 Ft' in title):
                exclude('Current pipe end or length conflicts with regional listing.');continue
            sl,nom=inch(main['Size']);sizes=[sl]
            source_size=r['sourceLine'].split('"')[0].replace('-',' ')
            if inch(source_size)[1]!=nom:
                exclude('Current and regional nominal pipe size conflict.');continue
            schedule='80' if 'Schedule 80' in title else '40'
            name=f'{sl} Sch {schedule} CPVC Plain-End Pipe x 20 ft'
            attrs.update({'length_ft':'20','schedule':schedule,'regional_order_unit':'feet','size_basis':'Nominal IPS'})
            kind='Pipe';connection='Plain End';ends=['Plain End','Plain End'];unit='in';family='cpvc-pipe'
            row={'sourceUrl':XLS,'sourceSheet':r['sourceSheet'],'sourceRow':r['sourceRow'],
                 'manufacturerDescription':r['sourceLine'],'schedule':schedule}
            aliases=['CORZAN','ChlorFIT' if schedule=='80' else 'Harvel','PVC-C','Solvent weld']
        else:
            if 'PE' not in facet['Plastic Material'] or 'PE100' not in title:
                exclude('Required PE100 grade is not verified by current article family.');continue
            if 'd' not in main or not re.fullmatch(r'\d+(?:\.\d+)?',main['d']):
                exclude('No unambiguous metric outside diameter.');continue
            diameter=main['d'];nums=[diameter];kind='';ends=[]
            joints=facet['Jointing Technology']
            if ispipe:kind='Pipe';connection='Plain End';ends=['Plain End','Plain End']
            elif 'hose connector' in low:
                kind='Hose Adapter';connection='Butt Fusion x Hose';nums.append(main['d2']);ends=['Fusion Spigot','Hose Tail']
            elif 'saddle' in low:
                kind='Tapping Saddle Kit' if 'tapping' in low else 'Branch Saddle'
                # Di1 is the branch socket diameter. d2 on this family is the
                # hole/cutter bore, not the outlet connection size.
                outlet=main.get('Do3') if 'tapping' in low else main.get('Di1')
                if not outlet or not re.fullmatch(r'\d+(?:\.\d+)?',outlet):
                    exclude('Saddle outlet connection cannot be separated from bore dimensions.');continue
                prefix=r['sourceLine'].split(sku[:3]+' ',1)[0].split()
                if len(prefix)<2 or prefix[0]!=diameter or prefix[1]!=outlet:
                    exclude('Current saddle connecting diameters conflict with regional table.');continue
                nums.append(outlet);connection='Electrofusion';ends=['Main Pipe Saddle','Electrofusion Socket']
                attrs['outlet_diameter_mm']=outlet
                if 'd2' in main:attrs['hole_bore_diameter_mm']=main['d2']
            else:
                connection='Butt Fusion' if 'Butt Fusion' in joints else 'Electrofusion' if 'Electrofusion' in joints else ''
                if not connection:
                    exclude('Fusion connection type cannot be verified.');continue
                end='Fusion Spigot' if connection=='Butt Fusion' else 'Electrofusion Socket'
                if 'flange adaptor' in low:
                    kind='Flange Adapter';connection='Butt Fusion x Flange';ends=['Fusion Spigot','Flange Face']
                    attrs['flange_face_type']=main.get('Type','')
                elif 'elbow' in low:
                    kind=('45°' if '45°' in title else '90°')+' Elbow';ends=[end,end]
                elif 'tee' in low:
                    if 'reduced' in low:
                        if 'd2' not in main:exclude('Reducing tee branch diameter missing.');continue
                        nums=[diameter,diameter,main['d2']];kind='Reducing Tee'
                    else:kind='45° Wye' if '45°' in title else 'Tee'
                    ends=[end]*3
                    if connection=='Electrofusion':
                        # The manufacturer's cross-section shows two run
                        # sockets and an unfused spigot branch, not three EF
                        # sockets. Keep this distinction visible/searchable.
                        ends=['Electrofusion Socket','Electrofusion Socket','Fusion Spigot']
                        attrs['branch_connection']='Fusion Spigot'
                        attrs['connection_layout']='Two electrofusion run sockets with a fusion-spigot branch'
                        url=a.get('datasheetUrl')
                        if not url:exclude('No source diagram to verify tee branch connection.');continue
                        fetch(url,'tee-'+p['code']+'-datasheet.pdf')
                        attrs['connection_diagram_source_url']=url
                elif 'coupler' in low:kind='Coupling';ends=[end,end]
                elif 'reducer' in low:
                    if 'd2' not in main:exclude('Reducer second connection diameter missing.');continue
                    nums.append(main['d2']);kind='Reducer Kit' if '(kit)' in low else 'Reducer';ends=[end,end]
                elif 'end cap' in low:kind='Cap Kit' if '(kit)' in low else 'Cap';ends=[end]
                elif 'branch 45' in low:kind='45° Wye';ends=[end]*3
                else:exclude('Family requires additional manual classification.');continue
            sourcefirst=re.match(r'^\s*(\d+(?:\.\d+)?)',r['sourceLine'])
            if sourcefirst and float(sourcefirst.group(1))!=float(diameter):
                exclude('Regional and current primary connecting size differ.');continue
            sizes=[x+' mm' for x in nums];sl=' x '.join(sizes);nom=max(map(float,nums));unit='mm'
            pn=main.get('PN') or next(iter(facet.get('Pressure (PN)',[])),None)
            sdr=main.get('SDR') or next(iter(facet.get('SDR',[])),None)
            if sdr:sdr=sdr.replace('SDR','')
            if not sdr:
                sm=re.search(r'\bSDR\s*(\d+(?:\.\d+)?)',title)
                if sm:sdr=sm.group(1)
            name=' '.join(x for x in [sl,'PE100 HDPE','SDR'+sdr if sdr else '',connection,kind] if x)
            if attrs.get('branch_connection')=='Fusion Spigot':name+=' with Spigot Branch'
            attrs.update({'grade':'PE100','size_basis':'Outside diameter','sdr':sdr or '',
                          'supported_jointing_technologies':'; '.join(joints)})
            row={'sourceUrl':PDF,'sourcePage':r['sourcePage'],'sourcePrintedPage':r['sourcePrintedPage'],
                 'sourceRow':r['sourceRow'],'sourceTableRow':r['sourceLine'],'manufacturerDescription':title,'grade':'PE100'}
            if pn:row['pressureClass']='PN'+pn
            if sdr:row['sdr']=sdr
            if ispipe:
                # Current linked family datasheets, not the older regional
                # catalogue, establish 5 m packaging and current wall dimensions.
                filename='pe-sdr11-datasheet.pdf' if sdr=='11' else 'pe-sdr176-datasheet.pdf'
                url=a.get('datasheetUrl')
                if not url:exclude('No linked current pipe datasheet.');continue
                fetch(url,filename)
                subprocess.run(['pdftotext','-layout',str(CACHE/filename),str(CACHE/(filename+'.txt'))],check=True)
                text=(CACHE/(filename+'.txt')).read_text()
                if not re.search(r'Pipe length:\s*5m',text) or ' '.join([sku[:3],sku[3:6],sku[6:]]) not in text:
                    exclude('Current pipe packaging not corroborated by linked datasheet.');continue
                row['sourceUrl']=url;row['sourcePage']=1;row.pop('sourceRow',None);row.pop('sourcePrintedPage',None)
                row['regionalSourceUrl']=PDF;row['regionalSourcePage']=r['sourcePage']
                row['regionalSourceTableRow']=row.pop('sourceTableRow')
                row['sourceTableRow']=next(line.strip() for line in text.splitlines()
                    if ' '.join([sku[:3],sku[3:6],sku[6:]]) in line)
                row['sourceConflict']='Older regional catalogue states 10 m. Current linked manufacturer datasheet confirms 5 m; only current data used.'
                attrs['length_m']='5';name+=' x 5 m'
            aliases=['HDPE','Polyethylene','PE100','ELGEF Plus' if 'ELGEF' in title else 'ecoFIT',
                     'PN'+pn if pn else '', 'SDR'+sdr if sdr else '']
            family='hdpe-pipe' if ispipe else 'hdpe-fusion-fittings'
        if a.get('imageUrl','').rsplit('/',1)[-1] in BAD_IMAGES:
            exclude(BAD_IMAGES[a['imageUrl'].rsplit('/',1)[-1]]);continue
        key=photograph(a)
        if not key:exclude('Accurate source photograph unavailable or too small.');continue
        row.update({'family':family,'manufacturer':'GF Piping Systems','sku':sku,
            'material':r['material'],'category':'Pipe' if ispipe else 'Plastic Fusion Fittings','fittingType':kind,
            'displayName':name,'description':name,'connectionType':connection,'connectionSizes':sizes,
            'connectionEnds':ends,'sizeLabel':sl,'sizeNominal':nom,'sizeUnit':unit,
            'imageKey':key,'productPage':BASE+'article?code='+sku,'model':'; '.join(facet['Systems']),
            'attributes':attrs})
        # All manufacturer identification stays searchable, without provenance
        # notes or source citations entering the visible name/description.
        ean=a.get('ean')
        if ean:row['ean']=ean
        row['aliases']=list(dict.fromkeys(x for x in ['GF Piping Systems','GF','Georg Fischer',sku,ean,
            row['model'],row['manufacturerDescription'],title,*aliases,*texts] if x and len(x)<=255))
        out.append(row)
    assert len({r['sku'] for r in out})==len(out)
    names=Counter(r['displayName'] for r in out)
    assert max(names.values(),default=0)==1,[n for n,v in names.items() if v>1]
    doc={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in out)),
         'coverageByType':dict(Counter(r['fittingType'] for r in out)),
         'sources':list(SOURCES.values()),'rows':out,'images':IMAGES,'exclusions':EXCLUDED,
         'notes':['Only explicitly published regional candidate codes verified by current manufacturer article records are included.',
                  'PE100 dimensions are actual metric outside diameters; CPVC uses nominal IPS inch sizes.',
                  'Current 2026 GF pipe datasheets corroborate PE100 5 m lengths and current SDR/wall values, superseding older regional 10 m catalogue text.',
                  'All source pressure, wall, temperature and jointing qualifications remain in article attributes; no size-based rating was inferred.',
                  'Photographs are native manufacturer family photographs. CAD/dimension drawings excluded. No upscaling, generated art, prices or supplier changes.',
                  'CPVC includes only verified Schedule 40/80 20 ft plain-end pipe. Belled ends and other lengths are outside this bounded slice.']}
    OUT.write_text(json.dumps(doc,indent=2)+'\n')
    for start in range(0,len(IMAGES),20):
        portion=list(IMAGES.items())[start:start+20];c=Image.new('RGB',(1500,math.ceil(len(portion)/4)*370),'#eeeeee');draw=ImageDraw.Draw(c)
        for n,(k,m) in enumerate(portion):
            x=n%4*375;y=n//4*370;im=ImageOps.contain(Image.open(m['path']),(350,300));c.paste(im,(x+(375-im.width)//2,y))
            row=next(r for r in out if r['imageKey']==k)
            draw.text((x+5,y+305),k+'\n'+row['connectionType']+' '+row['fittingType']+f"\nNative {m['sourceWidth']} x {m['sourceHeight']}",fill='black')
        c.save(CACHE/f'final-contact-{start//20}.jpg',quality=95)
    print(json.dumps({'rows':len(out),'images':len(IMAGES),'excluded':len(EXCLUDED),'counts':doc['counts']},indent=2))


if __name__=='__main__':
    rows=selected()
    if '--discover' in sys.argv:discover(rows)
    d=json.loads((CACHE/'discovery.json').read_text())
    for u,path in d['sources'].items():
        raw=Path(path).read_bytes();SOURCES[u]={'url':u,'sha256':sha(raw),'cachePath':path}
    build(rows,d)
