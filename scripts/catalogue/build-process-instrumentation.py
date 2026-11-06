"""Bounded exact Dwyer/Omega instrument articles, with genuine manufacturer photos.

Thermometer and thermowell SKUs are explicit rows in manufacturer tables. Gauge
and flowmeter SKUs are individually listed on official product pages (one gauge
on the official category table). Do not expand configurable model combinations.
Measurement ranges, dial/stem dimensions, process connections and pressure
limits are independent specifications. No supplier prices or availability.
"""
from collections import Counter
from fractions import Fraction
from pathlib import Path
import hashlib, io, json, re, subprocess, textwrap
import requests
from PIL import Image, ImageOps, ImageDraw

ROOT = Path('.')
CACHE = ROOT / '.tmp/process-instrumentation'
OUT = ROOT / 'data/catalogue/process-instrumentation.json'
ASSETS = 'https://assets.dwyeromega.com/'
BT_PDF = ASSETS + 'manuals-do/BT.pdf'
TE_PDF = ASSETS + 'manuals-do/TE-TNS_1.pdf'
PGS_PDF = ASSETS + 'pdf/test-and-measurement-equipment/pressure/pressure-gauges/PGS.pdf'
VFC_PDF = ASSETS + 'spec/VFC_VFCII.pdf'
BT_PAGE = 'https://www.dwyeromega.com/en-ca/bimetal-thermometers-for-chillers-boilers-stainless-steel-sealed/p/Series-BT'
TE_PAGE = 'https://www.dwyeromega.com/en-us/stainless-steel-thermowells-for-sensors-corrosion-resistant-easy-install/p/Series-TE-TNS'
PGS_PAGE = 'https://www.dwyeromega.com/en-us/corrosion-weather-and-dust-resistant-pressure-gauges/PGS/p/'
PGS_CATEGORY = 'https://www.dwyeromega.com/en-us/pressure/gauges-manometers/c/pressure-gauges?view=list'
VFC_PAGE = 'https://www.dwyeromega.com/en-us/acrylic-flowmeter-for-gas-liquid-pvc-acetal-1-npt-nist-option/Series-VFC-VFCII/p/'
IMAGES = {}


def inch(n):
    f=Fraction(str(n));w,r=divmod(f.numerator,f.denominator)
    return (str(w) if not r else (f'{w} ' if w else '')+f'{r}/{f.denominator}')+'"'


def get(filename, url):
    p=CACHE/filename
    if not p.exists():
        r=requests.get(url,timeout=90);r.raise_for_status();p.write_bytes(r.content)
    return p


def pdf_text(filename,url):
    p=get(filename,url)
    return subprocess.run(['pdftotext','-layout',str(p),'-'],capture_output=True,text=True,check=True).stdout


def picture(key,filename,url,page,notes):
    source=get(filename,url);raw=source.read_bytes()
    native=Image.open(io.BytesIO(raw)).convert('RGBA');side=round(max(native.size)*1.25)
    canvas=Image.new('RGBA',(side,side),'white');canvas.alpha_composite(native,((side-native.width)//2,(side-native.height)//2))
    buff=io.BytesIO();canvas.convert('RGB').save(buff,format='WEBP',quality=94,method=6)
    data=buff.getvalue();digest=hashlib.sha256(data).hexdigest()
    dest=ROOT/'public/images/catalog/uploads'/f'part-{digest}.webp'
    if not dest.exists():dest.write_bytes(data)
    IMAGES[key]={'path':str(dest),'url':f'/api/catalogue/images/{dest.name}','sha256':digest,'byteSize':len(data),
        'width':side,'height':side,'sourceWidth':native.width,'sourceHeight':native.height,
        'sourceSha256':hashlib.sha256(raw).hexdigest(),'sourceUrl':url,'sourcePage':page,
        'imageKind':'product-photo','notes':notes+' White square padding; original pixels retained without enlargement.'}
    return key


def row(sku,maker,family,category,fitting,name,sizes,connection,image,source,original,attrs,**extras):
    return {'manufacturer':maker,'sku':sku,'family':family,'category':category,'fittingType':fitting,
        'displayName':name,'description':name,'material':'Stainless steel','connectionType':connection,
        'connectionSizes':[inch(s) for s in sizes],'sizeLabel':' x '.join(inch(s) for s in sizes),
        'sizeNominal':float(sizes[0]),'sizeBasis':'NPT nominal','sizeUnit':'in','pressureClass':None,
        'imageKey':image,'sourceUrl':source,'manufacturerDescription':original,
        'aliases':[maker,sku,original],'attributes':attrs,**extras}


def thermometers():
    text=pdf_text('bt.pdf',BT_PDF)
    photo=picture('instrument:bt-back','bt-web.jpg',ASSETS+'0/images/1340_dwyer_series-bt_bt_default_1000.jpg',BT_PAGE,
        'Official Dwyer BT back-connection family photograph. Dial scale, dial diameter and stem length vary by exact article. Not used for adjustable-angle or lower-connection thermometers.')
    # Exact printed rows, not combinations derived from the part-number convention.
    data=[('BTB22551',2,2.5,0,250,None,None,2,None),('BTB2405D',2,4,0,250,-20,120,2,2),
        ('BTB2409D',2,4,200,1000,100,550,10,5),('BTB32510D',3,2.5,0,200,-20,100,2,2),
        ('BTB3255D',3,2.5,0,250,-20,120,2,2),('BTB3257D',3,2.5,50,550,10,290,5,5),
        ('BTB34010D',3,4,0,200,-20,100,2,2),('BTB3405D',3,4,0,250,-20,120,2,2),
        ('BTB3407D',3,4,50,550,10,290,5,5),('BTB3605D',3,6,0,250,-20,120,2,2)]
    rows=[]
    for sku,dial,stem,fmin,fmax,cmin,cmax,df,dc in data:
        pattern=rf'{sku}\*?\s+{dial}˝\s+{("2-1/2" if stem==2.5 else str(stem))}˝\s+Back\s+{fmin} to {fmax}'
        match=re.search(pattern,text);assert match,(sku,'Table specification differs')
        if cmin is not None:assert re.match(rf'\s*\({cmin} to\s*{cmax}\)',text[match.end():]),sku
        npt=0.25 if dial==2 else 0.5
        frange=f'{fmin}–{fmax}°F';crange=f'{cmin}–{cmax}°C' if cmin is not None else None
        range_label=frange+(f' / {crange}' if crange else '')
        name=f'{inch(npt)} MNPT Stainless Steel Bimetal Thermometer, {inch(dial)} Dial, {inch(stem)} Stem, Back Mount, {range_label}'
        original=f'{sku} | {inch(dial)} dial | {inch(stem)} stem | Back | {range_label}'
        attrs={'Measurement range Fahrenheit':frange,'Dial diameter':inch(dial),'Stem length':inch(stem),
            'Mounting':'Back connection','Process connection':inch(npt)+' MNPT','Wetted material':'304 stainless steel',
            'Case material':'300 series stainless steel','Lens material':'Glass','Accuracy':'±1% full scale',
            'Response time':'≤40 seconds','Stem diameter':'1/4" OD','Minimum immersion liquids':'2"',
            'Minimum immersion gas':'4"','Maximum head temperature':'200°F / 93°C',
            'Stem temperature limits':'Do not exceed 50% over-range or 1000°F (538°C), or 800°F (427°C) continuously.',
            'Fahrenheit scale divisions':str(df)+'°F','Scale type':'Fahrenheit only' if crange is None else 'Fahrenheit / Celsius'}
        if crange:attrs.update({'Measurement range Celsius':crange,'Celsius scale divisions':str(dc)+'°C'})
        rows.append(row(sku,'Dwyer','bimetal-thermometers','Thermometers','Bimetal Thermometer',name,[npt],'MNPT',photo,BT_PDF,original,attrs,
            sourcePage=1,sourceTable='Series BT model chart',sourceLine=match[0],model='BT'))
    return rows


def thermowells():
    text=pdf_text('te-tns.pdf',TE_PDF)
    photos={
        'Machined':picture('instrument:thermowell-machined','te-machined-web.jpg',ASSETS+'0/images/2555_dwyer_te-tns_n064n-14_angle_2000.jpg',TE_PAGE,
            'Official Dwyer TE-TNS-N064N-14 machined thermowell photograph, representative of the machined family across insertion lengths/thread sizes/grades.'),
        'Fabricated':picture('instrument:thermowell-fabricated','te-fabricated-web.jpg',ASSETS+'0/images/2554_dwyer_te-tns_n063n-00_angle_2000.jpg',TE_PAGE,
            'Official Dwyer TE-TNS-N063N-00 fabricated welded thermowell photograph, representative of the fabricated family across insertion lengths.')}
    pattern=r'(TE-TNS-[A-Z0-9-]+)\s+(304|316) SS\s+(\d+(?:\.\d+)?)˝\s+(Machined|Fabricated)\s+(1/[24])˝ (NPT|NPSM) / (1/2|3/4)˝ NPT'
    rows=[]
    for m in re.finditer(pattern,text):
        sku,grade,length,construction,internal,thread,external=m.groups();ext=float(Fraction(external));ins=float(Fraction(internal))
        long_label=inch(length);construction_label='Fabricated Welded' if construction=='Fabricated' else construction
        conn=f'MNPT x F{thread}'
        name=f'{inch(ext)} MNPT x {inch(ins)} F{thread} {grade} Stainless Steel {construction_label} Thermowell, {long_label} Insertion'
        maximum_pressure='140 psi' if construction=='Fabricated' else '3700 psi' if grade=='304' else '5500 psi'
        attrs={'Process connection':inch(ext)+' MNPT','Instrument connection':inch(ins)+' F'+thread,'Insertion length':long_label,
            'Construction':construction_label,'Material grade':grade,'Maximum pressure':maximum_pressure,
            'Maximum temperature':'1000°F / 538°C' if construction=='Fabricated' else '1200°F / 648°C',
            'Pressure-temperature note':'Separate manufacturer maximum pressure and temperature values; not a simultaneous operating rating.',
            'Size basis':'First size is process thread; second size is instrument thread.'}
        original=' '.join(m[0].split())
        rows.append(row(sku,'Dwyer','stainless-thermowells','Thermowells','Thermowell',name,[ext,ins],conn,photos[construction],TE_PDF,original,attrs,
            sourcePage=1,sourceTable='TE-TNS model chart',sourceLine=original,model='TE-TNS',grade=grade,construction=construction_label))
    assert len(rows)==24,len(rows)
    return rows


def gauges():
    pdf_text('pgs.pdf',PGS_PDF)
    photo=picture('instrument:pgs-lower','pgs-web.jpg',ASSETS+'do-product-images/PGS_l.jpg',PGS_PAGE+'PGS-25L-100',
        'Official Omega PGS lower-connection product-family photograph used on the exact model pages. The depicted dial range is representative; measurement range is specified per article. Not used for back connections.')
    rows=[]
    for maximum in [15,30,60,100,160]:
        sku=f'PGS-25L-{maximum}'
        source=PGS_CATEGORY if maximum==30 else PGS_PAGE+sku
        original=f'2.5" Dial, 0 to {maximum} psi, Gauge, Bottom mounting'
        name=f'1/4" MNPT Stainless Steel Pressure Gauge, 2 1/2" Dial, Bottom Mount, 0–{maximum} psi'
        attrs={'Measurement range':f'0–{maximum} psi','Measurement type':'Gauge pressure','Dial diameter':'2 1/2"',
            'Process connection':'1/4" MNPT','Connection location':'Lower fitting','Fill':'Unfilled',
            'Wetted material':'316 stainless steel Bourdon tube and fitting','Case material':'Polished stainless steel',
            'Window material':'Polycarbonate','Window gasket':'Neoprene','Accuracy':'±1% full scale',
            'Maximum operating temperature':'66°C / 150°F','Mounting options':'Stem, flange or U bracket',
            'Pressure range note':'Displayed psi values are measurement ranges, not flange pressure classes.'}
        rows.append(row(sku,'Omega','mechanical-pressure-gauges','Pressure Gauges','Pressure Gauge',name,[.25],'MNPT',photo,source,original,attrs,
            model='PGS',specificationUrl=PGS_PDF,sourceVerification='Official model page read 2026-11-05' if maximum!=30 else 'Explicit PGS-25L-30 row in official category table read 2026-11-05'))
    return rows


def flowmeters():
    pdf_text('vfc.pdf',VFC_PDF)
    photo=picture('instrument:vfc-back','vfc-web.jpg',ASSETS+'0/images/1179_dwyer_series-vfc-vfcii_vfc_default_1000.jpg',VFC_PAGE+'VFC-142',
        'Official Dwyer VFC back-connection water flowmeter photograph used by the exact product pages. Depicted scale range is representative; exact calibrated water range is specified per article. Not used for end connections or air flowmeters.')
    rows=[]
    for sku,lo,hi in [('VFC-141',.5,5),('VFC-142',1,10)]:
        interval=f'{lo:g}–{hi:g} GPM';original=f'{sku} {lo:g}-{hi:g} GPM WATER'
        name=f'1" FNPT Acrylic Water Flowmeter, Back Connections, {interval}'
        attrs={'Calibrated medium':'Water','Flow measurement range':interval,'Flow units':'GPM',
            'Process connections':'1" FNPT, back connections','Mounting orientation':'Vertical',
            'Body material':'Acrylic','Connection material':'PVC','Float and metal parts':'Stainless steel',
            'O-ring material':'Buna-N','Accuracy':'±2% full scale','Scale length':'5"',
            'Pressure-temperature limit':'100 psig at 120°F / 6.9 bar at 48°C'}
        rows.append(row(sku,'Dwyer','water-flowmeters','Flowmeters','Variable Area Flowmeter',name,[1,1],'FNPT',photo,VFC_PAGE+sku,original,attrs,
            material='Acrylic',model='VFC',specificationUrl=VFC_PDF,sourceVerification='Official model page read 2026-11-05'))
    return rows


def main():
    CACHE.mkdir(parents=True,exist_ok=True)
    rows=thermometers()+thermowells()+gauges()+flowmeters()
    assert len(rows)==41
    assert len({(r['manufacturer'],r['sku'].casefold()) for r in rows})==len(rows)
    assert len({r['displayName'].casefold() for r in rows})==len(rows)
    sources=[{'manufacturer':maker,'url':url,'sha256':hashlib.sha256((CACHE/filename).read_bytes()).hexdigest()} for maker,filename,url in [('Dwyer','bt.pdf',BT_PDF),('Dwyer','te-tns.pdf',TE_PDF),('Omega','pgs.pdf',PGS_PDF),('Dwyer','vfc.pdf',VFC_PDF)]]
    sources.extend({'manufacturer':r['manufacturer'],'url':url} for url,r in {r['sourceUrl']:r for r in rows if r['sourceUrl'] not in [s['url'] for s in sources]}.items())
    exclusions=[{'family':'Bimetal thermometers','reason':'Six adjustable-angle and one lower-mount BT model excluded: available official photo shows back mounting.'},
        {'family':'Instrument configurable ranges','reason':'No unlisted gauge/flowmeter model combinations generated from configuration charts. Back-mounted gauges, oil-filled options, end-connected flowmeters, air flowmeters and additional ranges outside this bounded exact-SKU slice.'}]
    result={'sourceDate':'2026-11-05','counts':dict(Counter(r['family'] for r in rows)),'sources':sources,'excluded':exclusions,'rows':rows,'images':IMAGES}
    OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    canvas=Image.new('RGB',(1500,450),'#eee');draw=ImageDraw.Draw(canvas)
    for i,(key,photo) in enumerate(IMAGES.items()):
        thumb=ImageOps.contain(Image.open(photo['path']),(285,315));canvas.paste(thumb,(i*300+(300-thumb.width)//2,0))
        labels=[key,f'{photo["sourceWidth"]} x {photo["sourceHeight"]} native']
        for row_idx,label in enumerate(labels):draw.text((i*300+8,325+row_idx*20),label,fill='black')
    canvas.save(CACHE/'instrument-contact.jpg',quality=94)
    print(json.dumps({'rows':len(rows),'counts':result['counts'],'photos':len(IMAGES),'excluded':exclusions},indent=2))

if __name__=='__main__':main()
