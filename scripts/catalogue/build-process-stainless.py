"""Exact manufacturer articles: stainless flanges/pipe and hygienic clamp ranges.

Merit articles are captured from live public listing pages. Dixon articles come
from the official 2024 hygienic catalogue's explicit SKU tables. Rubber Fab
seals come from its official Type 1 catalogue. Never expand published ranges.
No supplier pricing is imported. Images are original manufacturer assets or
embedded catalogue photos; square padding never enlarges original pixels.
"""
from collections import Counter
from fractions import Fraction
from pathlib import Path
import hashlib, io, json, re, subprocess, importlib.util, textwrap
import requests
import fitz
from PIL import Image, ImageOps, ImageDraw

ROOT = Path('.')
CACHE = ROOT / '.tmp/process-stainless'
OUT = ROOT / 'data/catalogue/process-stainless.json'
DIXON_URL = 'https://dixonvalve.com/sites/default/files/documents/Dixon_Sanitary_Hygienic_Fittings_Catalog_2024.pdf'
RUBBER_URL = 'https://rubberfab.com/wp-content/uploads/dlm_uploads/2023/11/Sanitary-Tri-Clamp-Gaskets.pdf'
RUBBER_PAGE = 'https://rubberfab.com/products/sanitary-gaskets/standard-gaskets/sanitary-tri-clamp-gaskets/rubber-fab-tri-clamp-type-i-sanitary-gaskets/'
MERIT_URL = 'https://www.meritbrass.com/uploads/docs/PDF/Stainless-Steel-Catalog.pdf'
IMAGES, EXCLUDED = {}, []
SIZE_RE = r'(?:\d+-)?\d+(?:/\d+)?'

def inch(raw):
    f = sum(Fraction(v) for v in raw.replace('"','').replace('″','').replace('”','').replace('-', ' ').split())
    w, n = divmod(f.numerator, f.denominator)
    label = str(w) if not n else (f'{w} ' if w else '') + f'{n}/{f.denominator}'
    return label + '"', float(f)

def picture(key, path, url, page, notes):
    if key in IMAGES: return key
    data = Path(path).read_bytes()
    native = Image.open(io.BytesIO(data)).convert('RGBA')
    # Keep native pixel detail, add 12.5% white breathing room on each side.
    side = round(max(native.size) * 1.25)
    target = Image.new('RGBA', (side, side), 'white')
    target.alpha_composite(native, ((side-native.width)//2, (side-native.height)//2))
    output = io.BytesIO(); target.convert('RGB').save(output, format='WEBP', quality=94, method=6)
    body = output.getvalue(); digest = hashlib.sha256(body).hexdigest()
    dest = ROOT / 'public/images/catalog/uploads' / f'part-{digest}.webp'
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists(): dest.write_bytes(body)
    IMAGES[key] = {'path':str(dest), 'url':f'/api/catalogue/images/{dest.name}', 'sha256':digest,
        'byteSize':len(body), 'width':side,'height':side,'sourceWidth':native.width,'sourceHeight':native.height,
        'sourceSha256':hashlib.sha256(data).hexdigest(), 'sourceUrl':url,'sourcePage':page,
        'imageKind':'product-photo','notes':notes+' Original pixels retained without enlargement; white square padding.'}
    return key

def merit_rows():
    rows=[]
    for source in json.loads((CACHE/'merit-records.json').read_text()):
        row=dict(source); desc=' '.join(row['manufacturerDescription'].split()); upper=desc.upper()
        if row['sku'] in ['51160','74192','51192']:
            EXCLUDED.append({'manufacturer':'Merit Brass','sku':row['sku'],'reason':'Published pipe description does not identify welded versus seamless construction; do not infer from SKU.'});continue
        raw=re.match(r'^((?:\d+[- ]+\d+/\d+)|(?:\d+/\d+)|\d+)(?=[" ]|$)', re.sub(r'^\(SUD\)\s*', '', desc))[1].strip(); label,nominal=inch(raw)
        assert 0.125 <= nominal <= 24,(row,label)
        sku_size=re.sub(r'^[A-Za-z]*\d{2}', '', row['sku']) if row['family']=='stainless-pipe' else row['sku'].split('-')[-1]
        assert int(sku_size)/16==nominal,(row,label,sku_size)
        grade_match=re.search(r'(304|316)(?:/(?:304|316)?L)', upper)
        assert grade_match, row
        grade=grade_match[1]+'/'+grade_match[1]+'L'
        family=row['family']; attrs={'Size basis':'NPS'}
        if family=='stainless-pipe':
            schedule=re.search(r'(?:SCH|S/|S)\s*(10|40|80)', upper)[1]
            construction='Seamless' if 'SMLS' in upper else 'Welded' if 'WLD' in upper or 'WELD' in upper else None
            assert construction, row
            fitting='Pipe';category='Pipe';connection='Plain End';pressure=None
            name=f'{label} NPS {grade} Stainless Steel Schedule {schedule} {construction} Pipe'
            attrs.update({'Wall schedule':schedule,'Construction':construction,'Standard':'ASTM A312 / ASME SA312'})
            row.update({'schedule':schedule,'construction':construction,'standard':'ASTM A312 / ASME SA312'})
        else:
            pressure=re.search(r'(150|300)#',upper)[1]
            fitting={'stainless-blind-flange':'Blind Flange','stainless-slip-on-flange':'Slip-On Flange','stainless-weld-neck-flange':'Weld-Neck Flange'}[family]
            category='Flanges';connection='Flanged' if 'blind' in family else 'Slip-On x Flanged' if 'slip-on' in family else 'Butt Weld x Flanged'
            schedule=None
            if 'weld-neck' in family:
                schedule=re.search(r'(?:SCH|S/|S)\s*(10|40|80)',upper)[1]
            name=f'{label} NPS {grade} Stainless Steel Class {pressure} Raised-Face {fitting}' + (f' Schedule {schedule}' if schedule else '')
            attrs.update({'Face':'Raised Face','Standard':'ASTM A182','Pressure class':pressure})
            if schedule:attrs['Bore schedule']=schedule
            row.update({'standard':'ASTM A182','flangeFacing':'Raised Face','schedule':schedule})
        key='merit-process:'+family
        path=CACHE/(family+'.png')
        if not path.exists():
            response=requests.get(row['imageSourceUrl'],timeout=60);response.raise_for_status();path.write_bytes(response.content)
        picture(key,path,row['imageSourceUrl'],row['sourceUrl'],'Official Merit Brass product-family image, representative across published sizes/grades; flange bolt count and bore depend on size/class.' if family!='stainless-pipe' else 'Official Merit Brass straight stainless pipe bundle photo; representative across published sizes/grades and wall schedules.')
        row.update({'manufacturer':'Merit Brass','displayName':name,'description':name,'grade':grade,'material':'Stainless steel',
            'category':category,'connectionType':connection,'connectionSizes':[label],'sizeLabel':label,'sizeNominal':nominal,
            'sizeBasis':'NPS','sizeUnit':'in','fittingType':fitting,'pressureClass':pressure,'attributes':attrs,
            'aliases':['Merit Brass',row['sku'],desc],'imageKey':key})
        rows.append(row)
    return rows

# Family image assignments were checked against the rendered manufacturer pages.
DIXON_FAMILIES={
 '14WMP':(10,359,'Short Weld Ferrule','Clamp x Butt Weld'),
 'L14AM7':(10,363,'Long Weld Ferrule','Clamp x Butt Weld'),
 'B31RMP':(10,367,'Reducing Roll-On Ferrule','Clamp x Roll-On'),
 'B31WMP':(10,371,'Reducing Weld Ferrule','Clamp x Butt Weld'),
 '14RMP':(11,385,'Roll-On Ferrule','Clamp x Roll-On'),
 '14WLMP':(11,389,'Light-Duty Tank Ferrule','Clamp x Weld'),
 '14MPW':(11,381,'Heavy-Duty Tank Ferrule','Clamp x Weld'),
 'B2CMP':(12,400,'90° Elbow','Clamp'),
 'B2CMPL':(12,400,'90° Extended-Leg Elbow','Clamp'),
 'B2CM31MP':(12,412,'90° Non-Tapered Reducing Elbow','Clamp'),
 'B2KMP':(12,404,'45° Elbow','Clamp'),
 'B2SXLMP12':(13,423,'90° Sweep Elbow — 12" Radius','Clamp'),
 'B2SXLMP18':(13,423,'90° Sweep Elbow — 18" Radius','Clamp'),
 'B2SXLMP24':(13,423,'90° Sweep Elbow — 24" Radius','Clamp'),
 'B2SXLMP36':(13,423,'90° Sweep Elbow — 36" Radius','Clamp'),
 'B7MPS':(14,441,'Short-Outlet Tee','Clamp'),
 'B7MP':(14,433,'Tee','Clamp'),
 'B7RMP':(14,437,'Reducing Tee','Clamp'),
 'B3114MP':(15,450,'Concentric Reducer','Clamp'),
 'B3214MP':(16,462,'Eccentric Reducer','Clamp'),
 '16AMP':(17,471,'Solid End Cap','Clamp'),
 'B23BMP':(17,475,'Thermometer Cap','Clamp x FNPT'),
 '21MP':(20,514,'Male NPT Adapter','Clamp x MNPT'),
 '22MP':(21,522,'Female NPT Adapter','Clamp x FNPT'),
 'B28AMP':(22,537,'Lateral','Clamp'),
 'B28BMP':(22,533,'True Wye','Clamp'),
 'B9MP':(22,541,'Cross','Clamp'),
 'B2WUMP':(22,545,'180° Return Bend','Clamp'),
 'B38MP':(23,557,'Class 150 Flange Adapter','Clamp x Flanged'),
}
CLAMPS={
 '13MHHM-Q':(6,248,'Single-Pin Squeeze Clamp'),
 '13MHHM-SN':(6,240,'Single-Pin Heavy-Duty Clamp with Serrated Wing Nut'),
 '13MHHM-WNH':(6,252,'Single-Pin Heavy-Duty Clamp with Hex Nut'),
 '13MHHM':(6,244,'Single-Pin Heavy-Duty Clamp with Cross-Hole Wing Nut'),
 '13MHHM-DP':(7,263,'Double-Pin Heavy-Duty Clamp'),
 '13MHHM-3P':(7,267,'Three-Segment Clamp'),
 '13MHP':(7,275,'Bolted Clamp'),
 '13MHLA':(7,271,'Toggle Clamp'),
 '13MO':(8,289,'T-Bolt Clamp'),
 '13WGC':(8,293,'Dairy Clamp'),
}

def dixon_image(page,xref):
    key=f'dixon-process:{page}:{xref}'
    return picture(key,CACHE/f'dixon-{page}-{xref}.png',DIXON_URL,page,
       'Genuine embedded Dixon manufacturer catalogue product photo, representative of the named fitting family across sizes/grades.')

def dixon_rows():
    pages=(CACHE/'dixon-sanitary.txt').read_text().split('\f'); rows=[]
    for page in [6,7,8,10,11,12,13,14,15,16,17,20,21,22,23,118]:
        for line_no,line in enumerate(pages[page-1].splitlines(),1):
            tokens=re.findall(r'\b[A-Z0-9][A-Z0-9.-]*(?:[GR]\d)[A-Z0-9.-]*\b',line) if page>=10 else re.findall(r'\b13[A-Z0-9-]+\d[A-Z0-9-]*\b',line)
            if not tokens:continue
            for sku in tokens:
                attrs={'Size basis':'Tube OD'}; fitted_sizes=None; grade='304';model=None; category='Sanitary Fittings'; compatible=False
                raw_sizes=re.findall(SIZE_RE+r'"',line.split(sku)[0])
                if page<10:
                    if sku=='13SLN' or not raw_sizes:continue
                    model=next((m for m in ['13MHHM-Q','13MHHM-DP','13MHHM-3P','13MHP','13MHLA','13MO','13WGC'] if sku.startswith(m)),None)
                    if not model and sku.startswith('13MHHM'):model='13MHHM-SN' if sku.endswith('SN') else '13MHHM-WNH' if sku.endswith('WNH') else '13MHHM'
                    assert model in CLAMPS,(page,line,sku)
                    _,xref,fitting=CLAMPS[model];connection='Clamp';category='Sanitary Clamps'
                    # Page 7 has photo captions after the SKU: sizes only preceding SKU are data.
                    assert raw_sizes, (page,line)
                    fitted_sizes=[inch(s) for s in raw_sizes];compatible=len(fitted_sizes)>1
                    prefix=line.split(sku)[0]
                    end=list(re.finditer(SIZE_RE+r'"',prefix))[-1].end()
                    metrics=re.findall(r'\d+(?:\.\d+)?',prefix[end:])
                    assert len(metrics)>=3,(sku,metrics)
                    attrs.update({'Service pressure at 70 F / 21 C':metrics[0]+' psi','Service pressure at 250 F / 121 C':metrics[1]+' psi',
                        'Pressure rating conditions':'Manufacturer ratings require matched elastomer gaskets, aligned weld ferrules, specified clamp torque, and no shock loading; do not apply these ratings to PTFE seals.'})
                    if model=='13MO' and fitted_sizes[0][1]>=8:
                        EXCLUDED.append({'manufacturer':'Dixon','sku':sku,'sourcePage':page,'reason':'Two-bolt configuration; available catalogue photo shows one-bolt version.'});continue
                    if model=='13MHP' and fitted_sizes[0][1]<1:xref=279
                elif page==118:
                    if not sku.startswith('A270'):continue
                    model='A270';xref=2647;fitting='Sanitary Tubing';category='Sanitary Tubing';connection='Plain End'
                    grade='316L' if '-R' in sku else '304L';assert len(raw_sizes)==1,(page,line)
                    fitted_sizes=[inch(raw_sizes[0])]
                    wall=re.search(r'0\.\d+',line)[0]
                    construction='Seamless' if 'Seamless' in line else 'Passivated Laser Welded' if 'Passivated' in line else 'Laser Welded'
                    attrs.update({'Wall thickness':wall+' in','Length':'20 ft','Finish':'Polished ID and OD','Construction':construction,'Standard':'ASTM A270'})
                else:
                    model=next((m for m in sorted(DIXON_FAMILIES,key=len,reverse=True) if re.match(re.escape(m)+r'-?[GR]\d',sku)),None)
                    if model is None:continue
                    expected_page,xref,fitting,connection=DIXON_FAMILIES[model];assert page==expected_page,(page,model)
                    grade='304' if re.search(r'-?G\d',sku) else '316L'
                    suffix=re.split(r'-?[GR](?=\d)',sku)[-1]
                    if model in ['21MP','22MP','B23BMP']:
                        assert raw_sizes,(page,line)
                        npt=inch(raw_sizes[-1]);possible=[code for code in ['800','600','400','300','250','200','150','100','75','50'] if suffix.startswith(code)]
                        assert len(possible)==1,(sku,possible)
                        tube=inch(str(Fraction(int(possible[0]),100)))
                        fitted_sizes=[tube,npt]
                        attrs.update({'Connection sizes':'Tube OD x NPT nominal','Tube OD':tube[0],'NPT size':npt[0]})
                    else:
                        assert raw_sizes,(page,line)
                        fitted_sizes=[inch(s) for s in raw_sizes]
                        if model=='16AMP':compatible=len(fitted_sizes)>1
                        if model=='B7RMP':
                            assert len(fitted_sizes)==2,(sku,fitted_sizes)
                            fitted_sizes=[fitted_sizes[0],fitted_sizes[0],fitted_sizes[1]]
                    if model in ['14WMP','L14AM7','14WLMP','14MPW']:
                        data_part=line.split(sku)[0]
                        after_size=data_part[list(re.finditer(SIZE_RE+r'"',data_part))[-1].end():]
                        metrics=re.findall(r'(?:\d*\.\d+|\d+)',after_size)
                        attrs['Ferrule length']=str(float(metrics[0]))+' in'
                    if model=='B2CMPL':attrs['Center-to-end length']='3.50 in'
                    if model.startswith('B2SXLMP'):attrs['Bend radius']=model.replace('B2SXLMP','')+' in'
                    if model=='B38MP':attrs['Flange pressure class']='150'
                sizes=[s[0] for s in fitted_sizes]; label=(' / ' if compatible else ' x ').join(sizes)
                if compatible:attrs['Compatible tube sizes']='; '.join(sizes)
                attrs['Grade']=grade
                if page==118:
                    name=f'{label} OD {grade} Stainless Steel {attrs["Wall thickness"]} Wall Polished {attrs["Construction"]} Sanitary Tubing — 20 ft'
                elif model in ['21MP','22MP','B23BMP']:
                    name=f'{sizes[0]} OD x {sizes[1]} NPT {grade} Stainless Steel Tri-Clamp {fitting}'
                else:
                    name=f'{label} OD {grade} Stainless Steel Tri-Clamp {fitting}'
                row={'family':'sanitary-tubing' if page==118 else 'sanitary-clamps' if page<10 else 'sanitary-clamp-fittings',
                    'manufacturer':'Dixon','sku':sku,'model':model,'displayName':name,'description':name,'grade':grade,
                    'material':'Stainless steel','category':category,'connectionType':connection,'connectionSizes':sizes,
                    'sizeLabel':label,'sizeNominal':max(v[1] for v in fitted_sizes),'sizeBasis':'Tube OD','sizeUnit':'in',
                    'fittingType':fitting,'pressureClass':'150' if model=='B38MP' else None,'attributes':attrs,
                    'sourceUrl':DIXON_URL,'sourcePage':page,'cataloguePage':page-2,'sourceRow':line_no,'sourceLine':line.strip(),
                    'manufacturerDescription':fitting,'aliases':['Dixon',sku,model,'Sanitary','Tri-Clamp',fitting],
                    'imageKey':dixon_image(page,xref)}
                if page==118:
                    row['lengthSourcePage']=117
                    row['standard']='ASTM A270'
                if compatible:row['compatibleTubeSizes']=sizes
                rows.append(row)
    # One catalogue SKU is printed for both 1/8 and 1-1/4 female adapters: exclude
    # both interpretations rather than inventing a corrected manufacturer code.
    counts=Counter(r['sku'] for r in rows)
    duplicated={sku for sku,n in counts.items() if n>1}
    for sku in duplicated:
        EXCLUDED.append({'manufacturer':'Dixon','sku':sku,'reason':'Manufacturer table assigns this SKU to conflicting NPT sizes; needs source clarification.'})
    return [r for r in rows if r['sku'] not in duplicated]



def rubber_rows():
    rows=[]
    doc=fitz.open(CACHE/'rubberfab-gaskets.pdf')
    for page_index,page in enumerate(doc):
        lines=[l.strip() for l in page.get_text().splitlines()]
        for i,sku in enumerate(lines):
            if not re.fullmatch(r'40[A-Z]+(?:-[A-Z]+)?-\d+',sku):continue
            color=lines[i+1]
            if color in ['Clear','Gray']:
                EXCLUDED.append({'manufacturer':'Rubber Fab','sku':sku,'reason':'Exact SKU verified, but no reviewed individual clear/gray product photograph in this manufacturer source.'})
                continue
            raw=lines[i-1]
            label,nominal=inch(raw)
            assert int(sku.split('-')[-1])/100==nominal,(sku,raw)
            if re.match(r'40M[PO]U',sku):material='Buna-N'
            elif re.match(r'40M[PO]E',sku):material='EPDM'
            elif re.match(r'40M[PO]SFY',sku):material='FKM'
            elif re.match(r'40M[PO]G',sku):material='PTFE'
            elif sku.startswith('40RXPX'):material='Silicone'
            else:raise ValueError(sku)
            photo={'Black':1132,'White':1134,'Blue':1136}[color]
            key=picture(f'rubberfab-process:{color.lower()}',CACHE/f'rubberfab-1-{photo}.png',RUBBER_URL,1,
                f'Official Rubber Fab Type 1 gasket family photograph in {color.lower()}; representative standard gasket profile across listed sizes/materials of this color.')
            name=f'{label} OD {color} {material} Tri-Clamp Type 1 Gasket'
            attrs={'Size basis':'Tube OD','Material':material,'Color':color,'Gasket style':'Type 1 Standard / Unflanged'}
            if material=='Silicone':attrs['Cure']='Platinum cured'
            rows.append({'family':'sanitary-gaskets','manufacturer':'Rubber Fab','sku':sku,
                'displayName':name,'description':name,'material':material,'category':'Sanitary Gaskets',
                'connectionType':'Clamp','connectionSizes':[label],'sizeLabel':label,'sizeNominal':nominal,
                'sizeBasis':'Tube OD','sizeUnit':'in','fittingType':'Tri-Clamp Gasket','pressureClass':None,
                'attributes':attrs,'sourceUrl':RUBBER_URL,'sourcePage':page_index+1,'sourceRow':i+1,
                'sourceLine':f'{raw} | {sku} | {color}',
                'manufacturerDescription':f'{raw} {material} Type 1 Standard Gasket, {color}',
                'aliases':['Rubber Fab',sku,'Sanitary','Type 1 Standard Gasket','Tri-Clamp',material],
                'imageKey':key})
    return rows


def prepare_sources():
    CACHE.mkdir(parents=True,exist_ok=True)
    if not (CACHE/'merit-records.json').exists():
        spec=importlib.util.spec_from_file_location('weld_source','scripts/catalogue/build-weld-fittings.py')
        helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        helper.CACHE=CACHE
        helper.MERIT_CATEGORIES={'stainless-weld-neck-flange':'5637159590','stainless-blind-flange':'5637159594','stainless-slip-on-flange':'5637160337','stainless-pipe':'5637146838'}
        helper.collect_merit()
    for filename,url in [('dixon-sanitary.pdf',DIXON_URL),('rubberfab-gaskets.pdf',RUBBER_URL)]:
        path=CACHE/filename
        if not path.exists():
            response=requests.get(url,timeout=120);response.raise_for_status();path.write_bytes(response.content)
    if not (CACHE/'dixon-sanitary.txt').exists():
        subprocess.run(['pdftotext','-layout',str(CACHE/'dixon-sanitary.pdf'),str(CACHE/'dixon-sanitary.txt')],check=True)
    for filename,prefix,pages in [('dixon-sanitary.pdf','dixon',[6,7,8,10,11,12,13,14,15,16,17,20,21,22,23,118]),('rubberfab-gaskets.pdf','rubberfab',[1])]:
        doc=fitz.open(CACHE/filename)
        for page in pages:
            for xref,smask,w,h,*_ in doc[page-1].get_images(full=True):
                if min(w,h)<140:continue
                dest=CACHE/f'{prefix}-{page}-{xref}.png'
                if dest.exists():continue
                pixels=fitz.Pixmap(doc,xref)
                if pixels.colorspace and pixels.colorspace.n!=3:pixels=fitz.Pixmap(fitz.csRGB,pixels)
                if smask:pixels=fitz.Pixmap(fitz.Pixmap(pixels,0),fitz.Pixmap(doc,smask))
                pixels.save(dest)


def contact_sheets(rows):
    images=list(IMAGES.items())
    for start in range(0,len(images),12):
        canvas=Image.new('RGB',(1200,1000),'#eee');draw=ImageDraw.Draw(canvas)
        for index,(key,im) in enumerate(images[start:start+12]):
            x=(index%4)*300;y=(index//4)*333
            thumb=ImageOps.contain(Image.open(im['path']).convert('RGB'),(270,235))
            canvas.paste(thumb,(x+(300-thumb.width)//2,y))
            labels=[key,f'{im["sourceWidth"]} x {im["sourceHeight"]} native']
            types=sorted({r['fittingType'] for r in rows if r['imageKey']==key})
            labels+=textwrap.wrap(', '.join(types),35)
            for n,line in enumerate(labels[:6]):draw.text((x+5,y+235+n*16),line,fill='black')
        canvas.save(CACHE/f'process-contact-{start//12}.jpg',quality=92)

def main():
    prepare_sources()
    rows=merit_rows()+dixon_rows()+rubber_rows()
    assert len({(r['manufacturer'],r['sku'].upper()) for r in rows})==len(rows)
    names=Counter(r['displayName'].lower() for r in rows)
    duplicate_names=[n for n,v in names.items() if v>1]
    assert not duplicate_names,duplicate_names
    EXCLUDED.append({'sourceUrl':DIXON_URL,'sourcePage':119,'family':'BPE sanitary tubing','reason':'SF1/SF4 table headings conflict with PL/PM finish footnotes; standard A270 polished tubing imported instead.'})
    sources=[{'manufacturer':'Dixon','url':DIXON_URL,'sha256':hashlib.sha256((CACHE/'dixon-sanitary.pdf').read_bytes()).hexdigest()}, {'manufacturer':'Merit Brass','url':MERIT_URL}, {'manufacturer':'Rubber Fab','url':RUBBER_URL,'sha256':hashlib.sha256((CACHE/'rubberfab-gaskets.pdf').read_bytes()).hexdigest()}, {'manufacturer':'Rubber Fab','url':RUBBER_PAGE}]
    result={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in rows)),'sources':sources,'excluded':EXCLUDED,'rows':rows,'images':IMAGES}
    contact_sheets(rows)
    OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'rows':len(rows),'counts':result['counts'],'images':len(IMAGES),'excluded':EXCLUDED},indent=2))

if __name__=='__main__':main()
