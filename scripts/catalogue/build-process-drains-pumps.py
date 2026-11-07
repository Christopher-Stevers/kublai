"""Build verified drain assemblies and pumps from cached manufacturer sources.

No database access. Model combinations are limited to explicitly enumerated
manufacturer tables. Photos retain the complete product, with no upscaling.
"""
import hashlib
import io
import json
import math
from collections import Counter
from datetime import date
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageOps
from bs4 import BeautifulSoup

CACHE = Path('.tmp/process-drains-pumps')
OUT = Path('data/catalogue/process-drains-pumps.json')
ROWS, IMAGES, SOURCES = [], {}, {}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source(url, filename):
    raw = (CACHE / filename).read_bytes()
    SOURCES[url] = {'url': url, 'sha256': sha(raw), 'cachedFile': str(CACHE / filename)}
    return url


def photo(key, filename, url, page, notes, mask=None, pdf=None):
    raw = (CACHE / filename).read_bytes()
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    native = im.size
    if mask:
        im.putalpha(Image.open(CACHE / mask).convert('L'))
    bg = Image.new('RGBA', im.size, 'white')
    bg.alpha_composite(im)
    im = bg.convert('RGB')
    # Remove only blank source margins; never crop the object or source marks.
    diff = ImageChops.difference(im, Image.new('RGB', im.size, 'white'))
    box = diff.point(lambda v: 255 if v > 12 else 0).getbbox()
    if box:
        im = im.crop(box)
    im.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
    edge = max(300, math.ceil(max(im.size) / .88))
    canvas = Image.new('RGB', (edge, edge), 'white')
    canvas.paste(im, ((edge-im.width)//2, (edge-im.height)//2))
    b = io.BytesIO(); canvas.save(b, 'WEBP', quality=95)
    data = b.getvalue()
    path = Path('public/images/catalog/uploads') / ('part-'+sha(data)+'.webp')
    path.write_bytes(data)
    IMAGES[key] = {'path': str(path), 'url': '/api/catalogue/images/'+path.name,
                   'sha256': sha(data), 'byteSize': len(data), 'width': edge, 'height': edge,
                   'sourceUrl': url, 'sourcePage': page, 'sourceSha256': sha(raw),
                   'sourceWidth': native[0], 'sourceHeight': native[1],
                   'imageKind': 'product-photo',
                   'notes': notes+' Blank margins trimmed; entire product retained; white padding; no upscaling.'}
    if pdf:
        IMAGES[key]['sourcePdfSha256'] = sha((CACHE / pdf).read_bytes())
    if mask:
        IMAGES[key]['sourceMaskSha256'] = sha((CACHE / mask).read_bytes())


def add(row, name, aliases=()):
    row['displayName'] = row['description'] = name
    row.setdefault('sizeUnit', 'in')
    row['attributes'] = {k:str(v) for k,v in row.get('attributes',{}).items()}
    row['aliases'] = list(dict.fromkeys(x for x in [row['manufacturer'], row['sku'],
        row.get('model'), row.get('upc'), row.get('manufacturerDescription'), *aliases,
        *(f'{k}: {v}' for k,v in row['attributes'].items())] if x))
    assert all(isinstance(x,str) and len(x)<=255 for x in row['aliases']), row['sku']
    assert row['imageKey'] in IMAGES
    ROWS.append(row)


def mifab():
    meta = json.loads((CACHE/'mifab-metadata.json').read_text())
    slugs = {'f1100-c-floor-drain':'f1100-c-floor-drain', 'mifab-f1100':'f1100-floor-drain',
             'fs1720':'fs1720', 'fs1520':'fs1520', 'r1200':'large-sump-roof-drain-2',
             'r1200r':'large-sump-roof-drain-with-water-dam', 'mi-g':'mi-g',
             'mi-g-ss':'mi-g-ss-stainless-steel-hydromechanical-interceptor'}
    # Verbatim product headings from each linked manufacturer source table.
    descriptions = {
        'f1100-c-floor-drain': 'FLOOR DRAIN WITH ROUND ADJUSTABLE NICKEL BRONZE STRAINER',
        'mifab-f1100': 'FLOOR DRAIN WITH ROUND ADJUSTABLE NICKEL BRONZE STRAINER',
        'fs1520': '8" x 8" x 6" DEEP FLOOR SINK',
        'fs1720': '12" x 12" x 6" DEEP FLOOR SINK',
        'r1200': 'LARGE SUMP ROOF DRAIN',
        'r1200r': 'LARGE SUMP ROOF DRAIN WITH EXTERNAL 2” HIGH WATER DAM',
        'mi-g': 'HYDRO MECHANICAL GREASE INTERCEPTOR',
        'mi-g-ss': '4 TO 50 G.P.M. STAINLESS STEEL GREASE INTERCEPTOR',
    }
    for key, slug in slugs.items():
        page = 'https://mifab.com/products/'+slug+'/'
        source(page,key+'.html')
        for i in range(2):
            source('https://mifab.com'+meta[key]['links'][i],key+f'-doc{i}.pdf')
        photo('mifab:'+key,key+'-photo.img',meta[key]['photo'],page,
              'Manufacturer photograph of this material/configuration family; representative across listed sizes. '
              + ('Models 6 and 7 use four lid bolts; illustrated smaller family member has one bolt.' if key.startswith('mi-g') else ''))

    def base(key,sku,family,mat,category,kind,size,attrs):
        return {'family':family,'manufacturer':'MIFAB','sku':sku,
                'manufacturerDescription':descriptions[key],
                'sourceUrl':'https://mifab.com'+meta[key]['links'][1], 'sourcePage':1,
                'productPage':'https://mifab.com/products/'+slugs[key]+'/',
                'specificationUrl':'https://mifab.com'+meta[key]['links'][0],
                'material':mat,'category':category,'fittingType':kind,
                'connectionType':'No Hub','connectionSizes':[str(size)+'"'],
                'connectionEnds':['No Hub'],'sizeLabel':str(size)+'"','sizeNominal':size,
                'imageKey':'mifab:'+key,'attributes':attrs}

    for clamp in (True,False):
        key='f1100-c-floor-drain' if clamp else 'mifab-f1100'
        for outlet in (2,3,4):
            for grate in (5,6,7,8,10):
                sku=f'F110{outlet}'+('-C' if clamp else '')+f'-{grate}-1'
                row=base(key,sku,'floor-drains','Cast Iron','Floor Drains','Floor Drain',outlet,
                         {'body_material':'Lacquered cast iron','strainer_material':'Nickel bronze',
                          'strainer_diameter_in':grate,'membrane_clamp':'Included' if clamp else 'Not included',
                          'outlet':'No hub','strainer_shape':'Round','strainer_adjustment':'Adjustable'})
                row['sourceRow']=f'F1102,3,4-C-{grate}; Nickel Bronze (-1) column'+('; delete -C for no clamp per listed variation' if not clamp else '')
                add(row,f'{outlet}" Cast Iron Floor Drain with {grate}" Nickel Bronze Strainer'+(' and Membrane Clamp' if clamp else ''),['F1100-C' if clamp else 'F1100'])
    for key,width in [('fs1520',8),('fs1720',12)]:
        for outlet in (2,3,4):
            sku=('FS152' if width==8 else 'FS172')+str(outlet)
            row=base(key,sku,'floor-sinks','Cast Iron','Floor Sinks','Floor Sink',outlet,
                     {'body_material':'Cast iron','interior_finish':'White acid-resistant porcelain enamel',
                      'grate_finish':'White acid-resistant porcelain enamel','grate':'Full grate included',
                      'sink_width_in':width,'sink_length_in':width,'sink_depth_in':6,
                      'outlet':'No hub','anti_splash_dome':'Included'})
            row['sourceRow']=sku
            if sku=='FS1524': row['attributes']['outlet_body']='4-inch transition outlet body'
            add(row,f'{outlet}" Outlet Cast Iron Floor Sink with {width}" x {width}" Full Grate')
    for waterdam in (False,True):
        key='r1200r' if waterdam else 'r1200'
        for outlet in (2,3,4,5,6,8):
            sku=f'R120{outlet}'+('-R' if waterdam else '')+'-M'
            row=base(key,sku,'roof-drains','Cast Iron','Roof Drains','Roof Drain',outlet,
                     {'body_material':'Cast iron','dome_material':'Cast iron','dome_option':'-M',
                      'anchor_flange_diameter_in':15,'membrane_clamp':'Included',
                      'water_dam_height_in':2 if waterdam else 0,'outlet':'No hub'})
            row['sourceRow']=f'R120{outlet}'+('-R' if waterdam else '')+'; Cast Iron Dome (-M) column'
            add(row,f'{outlet}" Cast Iron Roof Drain with Cast Iron Dome'+(' and 2" Water Dam' if waterdam else ''))
    flow=[4,7,10,15,20,25,35,50];cap=[8,14,20,30,40,50,70,100]
    length=[16.75,17.75,21.25,23.75,23.75,27.75,31.25,31.25]
    width=[11.25,13.75,15.75,15.75,15.75,18.75,23.75,23.75]
    height=[11,12,13,15,17.5,17.5,22,24]
    volume=[4.43,6,9.74,13.59,16.18,23.34,41.31,46.82]
    for stainless in (False,True):
        key='mi-g-ss' if stainless else 'mi-g'; mat='Stainless Steel' if stainless else 'Steel'
        for n in range(8):
            outlet=2 if n<4 else 3;sku=f'MI-G-{n}'+('-SS' if stainless else '')
            row=base(key,sku,'grease-interceptors',mat,'Grease Interceptors','Grease Interceptor',outlet,
                     {'body_material':'14-gauge 304 stainless steel' if stainless else '10-gauge epoxy-coated steel',
                      'flow_rating_gpm':flow[n],'grease_capacity_lb':cap[n],'length_in':length[n],
                      'width_in':width[n],'height_in':height[n],'water_volume_us_gal':volume[n],
                      'flow_control':'External vented flow-control fitting included',
                      'connection':'No-hub inlet and outlet','lid_bolts':4 if n>=6 else 1,
                      'standard':'ASME A112.14.3'})
            row['connectionSizes']=[f'{outlet}"',f'{outlet}"'];row['connectionEnds']=['No Hub','No Hub']
            row['sourceRow']=sku
            add(row,f'{flow[n]} GPM {mat} Grease Interceptor with {outlet}" Connections',[f'{cap[n]} lb grease capacity','Hydromechanical Grease Interceptor'])


def nds():
    pages=json.loads((CACHE/'nds-pages.json').read_text())
    pages['864']={'url':'https://www.ndspro.com/us/en/product/drainage/channel-and-trench-drains-and-grates/864-5-in-pro-series-channel-drain-kit-5-1-2-in-x-39-3-8-in-deep-profile-channel-gray-plastic-grates-end-caps-outlet'}
    for sku,nominal,grate in [('764',3,'Gray Plastic'),('864',5,'Gray Plastic'),('864GMTL',5,'Galvanized Steel')]:
        url=source(pages[sku]['url'],'nds'+sku+'.html')
        m=json.loads((CACHE/('nds'+sku+'-photo.json')).read_text())
        heading=BeautifulSoup((CACHE/('nds'+sku+'.html')).read_text(), 'html.parser').find('h1').get_text(' ', strip=True)
        photo('nds:'+sku,'nds'+sku+'-photo.img',m.get('url',m.get('src')),url,
              'Exact manufacturer photograph of the complete kit; '+m['alt'])
        attrs={'channel_material':'Polypropylene','grate_material':'Galvanized steel' if sku.endswith('GMTL') else 'HDPE',
               'nominal_channel_width_in':nominal,'overall_width_in':'4 1/16' if nominal==3 else '5 1/2',
               'length_in':'39 3/8','included':'Channel, two grates, end cap, end outlet',
               'outlet_compatibility':'3-inch sewer-and-drain fitting' if nominal==3 else '3-inch sewer-and-drain pipe or 4-inch sewer-and-drain fitting'}
        add({'family':'trench-drains','manufacturer':'NDS','sku':sku,'model':'Pro Series',
             'manufacturerDescription':heading,
             'sourceUrl':url,'material':'Polypropylene','category':'Trench Drains','fittingType':'Trench Drain Kit',
             'connectionType':'Drain Outlet','connectionSizes':[],'sizeLabel':str(nominal)+'" Channel',
             'sizeNominal':nominal,'imageKey':'nds:'+sku,'attributes':attrs},
            f'{nominal}" x 39 3/8" Trench Drain Kit with {grate} Grates',['Channel drain','Pro Series'])


def zoeller():
    for sku in ('53-0001','63-0001','264-0001','267-0001'):
        j=json.loads((CACHE/('salsify-'+sku+'.json')).read_text());p=j['product']
        url=source(j['sourceUrl'],'salsify-'+sku+'.json')
        photo('zoeller:'+sku,'zoeller-'+sku+'.img',j['imageUrl'],url,'Exact model photograph from Zoeller Pump Company official product database.')
        props={x['property']:'; '.join(str(v) for v in x['values']) for s in p['propertySets'] for x in s['properties']}
        attrs={x['property']:'; '.join(str(v) for v in x['values']) for s in p['propertySets'] if s['label'] in ('Specs - Material','Specs - Motor','Functional Specifications') for x in s['properties']}
        sewage=sku.startswith(('264','267'));size=2 if sewage else 1.5;sl='2"' if sewage else '1 1/2"'
        typ='Sewage Pump' if sewage else 'Sump Pump';power={'53-0001':'3/10','63-0001':'3/10','264-0001':'4/10','267-0001':'1/2'}[sku]
        body='All-Cast-Iron' if sku=='63-0001' else 'Cast Iron'
        add({'family':'sewage-pumps' if sewage else 'sump-pumps','manufacturer':'Zoeller','sku':sku,
             'model':props['Model Family - Secondary'],'upc':props['UPC'],'manufacturerDescription':props['Marketing Smart Title'],
             'sourceUrl':url,'material':'Cast Iron','category':'Sewage Pumps' if sewage else 'Sump Pumps',
             'fittingType':typ,'connectionType':'Threaded','connectionSizes':[sl],'connectionEnds':['FNPT discharge'],
             'sizeLabel':sl,'sizeNominal':size,'imageKey':'zoeller:'+sku,'attributes':attrs},
            f'{sl} {power} HP {body} Automatic {typ}',[props['Model Family'],'115V','Single phase'])
    pdf='https://zoellerpumps.com/wp-content/uploads/sites/3/2023/11/FM3012-Sales-Slick-98-lit-plug.pdf'
    source(pdf,'fm3012.pdf')
    model_source=source('https://ca.zoeller.com/wp-content/uploads/sites/9/2025/06/FM3112-Switch-Explanation.pdf','fm3112.pdf')
    photo('zoeller:98-0001','fm3012-embedded-000.png',pdf,1,'Exact M98 automatic model photograph with illuminated plug from manufacturer sell sheet.',mask='fm3012-embedded-001.png',pdf='fm3012.pdf')
    add({'family':'sump-pumps','manufacturer':'Zoeller','sku':'98-0001','model':'M98','upc':'053514029463',
         'manufacturerDescription':'MODEL 98 Professional Sump Pump',
         'sourceUrl':model_source,'sourcePage':2,'specificationUrl':pdf,'productPage':'https://zoellerpumps.com/product/m98-sump-pump-with-led-plug-and-9-cord/',
         'material':'Cast Iron','category':'Sump Pumps','fittingType':'Sump Pump','connectionType':'Threaded',
         'connectionSizes':['1 1/2"'],'connectionEnds':['FNPT discharge'],'sizeLabel':'1 1/2"','sizeNominal':1.5,
         'imageKey':'zoeller:98-0001','attributes':{'power_hp':'1/2','voltage':'115V','frequency':'60 Hz',
         'phase':'1','cord_length_ft':9,'body_material':'Cast iron','base_material':'Thermoplastic',
         'impeller_material':'Engineered plastic','operation':'Automatic','illuminated_plug':'Included',
         'maximum_flow_gpm':72,'maximum_head_ft':23,'solids_handling_in':'1/2'}},
        '1 1/2" 1/2 HP Cast Iron Automatic Sump Pump',['Flow-Mate','M98'])


def taco():
    url=source('https://www.tacocomfort.com/product/007e-ecm-high-efficiency-circulator/','taco007.html')
    spec=source('https://www.tacocomfort.com/documents/FileLibrary/007e_ECM%20High-Efficiency%20Circulator_Submittal_101-177.pdf','taco007spec.pdf')
    guide=source('https://www.tacocomfort.com/documents/FileLibrary/ECM_Circulator_Comparison_Chart_102-586.pdf','tacoguide.pdf')
    source('https://www.tacocomfort.com/wp-content/uploads/2022/04/IMAP-Pricing_4-11-22.pdf','tacoimap.pdf')
    items=[('007e-2F2','Cast Iron','Standard Flanges','ci','https://www.tacocomfort.com/wp-content/uploads/2019/05/007e.png'),
           ('007e-SF4','Stainless Steel','Universal Flanges','ss-flange','https://www.tacocomfort.com/wp-content/uploads/2021/05/007e_SS_Flanged_QtrRF.jpg'),
           ('007e-SU','Stainless Steel','Unions','ss-union','https://www.tacocomfort.com/wp-content/uploads/2021/05/007e_SS_Union_QtrRF.jpg')]
    for sku,mat,ends,key,img in items:
        photo('taco:'+sku,'taco-'+key+'.img',img,url,'Exact body material and flange/union configuration photograph from Taco.')
        union=sku.endswith('SU')
        attrs={'voltage':'115V','frequency':'50/60 Hz','maximum_input_watts':44,'maximum_current_a':.54,
               'maximum_flow_gpm':16,'shutoff_head_ft':10,'minimum_rpm':1590,'maximum_rpm':4830,
               'maximum_working_pressure_psi':125 if mat=='Cast Iron' else 150,
               'fluid_temperature_f':'36–230','motor':'ECM permanent magnet',
               'connection_detail':'ISO 228-G1 (DIN 259 / BS 2779) union ends' if union else ends,
               'application':'Closed-loop heating' if mat=='Cast Iron' else 'Heating or domestic hot-water recirculation',
               'location':'Indoor','electrical_specification_source':'2026 manufacturer comparison chart'}
        row={'family':'circulator-pumps','manufacturer':'Taco','sku':sku,'model':'007e','sourceUrl':spec,
             'manufacturerDescription':'007e® ECM High-Efficiency Circulator',
             'productPage':url,'specificationUrl':guide,'material':mat,'category':'Circulator Pumps',
             'fittingType':'Circulator Pump','connectionType':'Union' if union else 'Flanged',
             'connectionSizes':['1"','1"'] if union else [],'sizeLabel':'1"' if union else ends,
             'sizeNominal':1 if union else None,'imageKey':'taco:'+sku,'attributes':attrs}
        if sku=='007e-2F2':row['upc']='190145175647'
        configuration='Union-End' if union else ('Standard-Flange' if ends=='Standard Flanges' else 'Universal-Flange')
        add(row,('1" ' if union else '')+f'{mat} {configuration} ECM Circulator',['Taco Comfort Solutions','007e',ends])


def burcam():
    url=source('https://burcam.com/wp-content/uploads/sites/8/2024/10/POP-506532SS-AF.pdf','burcam506532.pdf')
    photo('burcam:506532SS','burcam-embedded-059.png',url,1,'Exact stainless-steel booster pump photograph from manufacturer sell sheet.',mask='burcam-embedded-060.png',pdf='burcam506532.pdf')
    add({'family':'booster-pumps','manufacturer':'Burcam','sku':'506532SS','sourceUrl':url,'sourcePage':1,
         'manufacturerDescription':'Water Supply Pressure Booster / Shallow Well Jet Pump with electronic control',
         'productPage':'https://burcam.com/product/shallow-well-stainless-steel-jet-pump/',
         'material':'Stainless Steel','category':'Booster Pumps','fittingType':'Booster Pump','connectionType':'Threaded',
         'connectionSizes':['1"','1"'],'connectionEnds':['NPT suction','NPT discharge'],'sizeLabel':'1"','sizeNominal':1,
         'imageKey':'burcam:506532SS','attributes':{'power_hp':'3/4','voltage':'115V','frequency':'60 Hz',
         'body_material':'Stainless steel','control':'Electronic with dry-run protection',
         'maximum_suction_lift_ft':25,'flow_at_5_ft_lift_us_gph':900,'flow_at_25_ft_lift_us_gph':475,
         'motor':'Totally enclosed fan-cooled with thermal and overload protection',
         'application':'Water-supply pressure booster or shallow-well jet pump',
         'pressure_tank':'Not required','sand_point_application':'Not recommended in manufacturer sell sheet'}},
        '1" 3/4 HP Stainless Steel Booster and Shallow-Well Jet Pump',['BUR-CAM','Fluomac'])


def main():
    mifab();nds();zoeller();taco();burcam()
    assert len(ROWS)==76 and len(IMAGES)==20
    assert len({(r['manufacturer'],r['sku']) for r in ROWS})==len(ROWS)
    exclusions=[
        {'family':'MIFAB floor drains','reason':'Ductile-iron strainer range omitted: price and specification disagree on 7-inch availability; nickel-bronze range is supported by both.'},
        {'family':'MIFAB roof drains','reason':'Standard plastic-dome versions excluded because available photographs show cast-iron dome. Only explicit -M versions included.'},
        {'family':'MIFAB trench drains','reason':'T300 and T1350 manufacturer thumbnails are CAD renders, not photographs; replaced with exact complete NDS kits.'},
        {'sku':'007e-2F4','manufacturer':'Taco','reason':'No clear native photo of four-bolt cast-iron version; two-bolt photo not substituted.'},
        {'manufacturer':'Grundfos','family':'SCALA2','reason':'Current exact models 93013251/93013250 identified, but available product artwork appears rendered; real-photo Burcam booster used instead. Obsolete 98562818/98562817 not added.'},
        {'manufacturer':'Zoeller','reason':'Additional electrical/cord/switch variants not inferred from family specifications; only exact model evidence used.'}]
    notes=[
        'All rows are complete assemblies or pumps, not drain components. No pricing or supplier assignments included.',
        'MIFAB configured model codes expand only explicit outlet/strainer tables and published suffixes; no arbitrary combinations.',
        'MIFAB MI-G-SS specifies stainless body but epoxy-coated-steel lid. No stainless-lid claim made.',
        'MIFAB FS1520 current specification describes poly anti-splash dome while older price sheet says aluminum. Dome material omitted.',
        'Zoeller current exact Salsify model values override older family sheets, including M267 115 GPM/20.5 ft and 10 ft cord.',
        'Taco 2026 chart electrical values 115V 50/60Hz used; older 2023 submittal says 120V 60Hz. Both primary sources retained.',
        'MIFAB roof-drain photos native 344px; accurate original resolution preserved instead of upscaling.',
        'All 20 distinct photos visually inspected; photographs are exact model/configuration or clearly identified representative family images.'
    ]
    doc={'sourceDate':str(date.today()),'counts':dict(Counter(r['family'] for r in ROWS)),
         'coverageByType':dict(Counter(r['fittingType'] for r in ROWS)),
         'sources':list(SOURCES.values()),'notes':notes,'exclusions':exclusions,'rows':ROWS,'images':IMAGES}
    OUT.write_text(json.dumps(doc,indent=2)+'\n')
    canvas=Image.new('RGB',(1500,math.ceil(len(IMAGES)/4)*350),'#eeeeee');d=ImageDraw.Draw(canvas)
    for n,(key,m) in enumerate(IMAGES.items()):
        x=n%4*375;y=n//4*350
        d.text((x+8,y+8),key,fill='black');d.text((x+8,y+24),f"Native {m['sourceWidth']} x {m['sourceHeight']}",fill='black')
        im=Image.open(m['path']);im=ImageOps.contain(im,(350,295));canvas.paste(im,(x+(375-im.width)//2,y+46))
    canvas.save(CACHE/'final-contact.jpg',quality=95)
    print(json.dumps({'rows':len(ROWS),'images':len(IMAGES),'counts':doc['counts']},indent=2))


if __name__=='__main__':main()
