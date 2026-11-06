"""Build sourced flange accessories and branch outlets; never writes the database.

Input rows are explicit ASC article rows, Dixon product option rows, and published
D&D / Spiraltec catalogue variants. Vendor variant IDs are not manufacturer SKUs.
Photos are exact manufacturer/vendor family photographs, not generated artwork.
Run from repository root with requests, bs4, xlrd, Pillow, and Poppler installed.
"""
import hashlib
import io
import json
import math
import re
import subprocess
from collections import Counter
from datetime import date
from fractions import Fraction
from pathlib import Path

import requests
import xlrd
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw

CACHE = Path('.tmp/process-flange-branch')
OUT = Path('data/catalogue/process-flange-branch.json')
ASC_XLS = 'https://s3.us-east-1.amazonaws.com/ue1.asc-es.com/price-sheets/excel/UAN-6.26-website.xls'
DD_JSON = 'https://shop.ddenginc.com/products.json?limit=250'
DIXON = 'https://myportal.dixonvalve.com'
SOURCES, IMAGES, ROWS, EXCLUDED = {}, {}, [], []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fetch(url, name=None):
    path = CACHE / (name or sha(url.encode()) + '.source')
    if not path.exists():
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        path.write_bytes(response.content)
    data = path.read_bytes()
    SOURCES[url] = {'url': url, 'sha256': sha(data)}
    return data


def inch(raw, asc=False):
    v = raw.strip().replace('"', '').replace('”', '')
    if asc:
        v = re.sub(r'^(\d+)([123])/([248])$', r'\1 \2/\3', v)
    else:
        v = v.replace('-', ' ')
    n = sum(Fraction(x) for x in v.split())
    assert 0 < n <= 100, raw
    whole, rem = divmod(n.numerator, n.denominator)
    return ((str(whole) + ' ' if whole else '') + f'{rem}/{n.denominator}' if rem else str(whole)) + '"', float(n)


def photograph(key, source_url, source_page, raw, notes, mask=None, **extra):
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    native = im.size
    if mask is not None:
        im.putalpha(Image.open(io.BytesIO(mask)).convert('L'))
    im.thumbnail((850, 850), Image.Resampling.LANCZOS)
    # Keep the complete source composition, including original vendor marks.
    edge = math.ceil(max(im.size) / .88)
    canvas = Image.new('RGBA', (edge, edge), 'white')
    canvas.alpha_composite(im, ((edge-im.width)//2, (edge-im.height)//2))
    output = io.BytesIO()
    canvas.convert('RGB').save(output, 'WEBP', quality=94)
    data = output.getvalue()
    path = Path('public/images/catalog/uploads') / ('part-' + sha(data) + '.webp')
    path.write_bytes(data)
    IMAGES[key] = {'path': str(path), 'url': '/api/catalogue/images/' + path.name,
                   'sha256': sha(data), 'byteSize': len(data), 'width': edge, 'height': edge,
                   'sourceUrl': source_url, 'sourcePage': source_page,
                   'sourceSha256': sha(raw), 'sourceWidth': native[0], 'sourceHeight': native[1],
                   'imageKind': 'product-photo', 'notes': notes + ' Complete source retained, framed on white, no upscaling.', **extra}


def finish(row, name, extra_aliases=()):
    row['displayName'] = row['description'] = name
    aliases = [row.get('manufacturer'), row.get('sourceVendor'), row.get('brand'), row['sku'],
               row.get('upc'), row.get('model'), row.get('manufacturerDescription'), *extra_aliases]
    row['aliases'] = list(dict.fromkeys(x for x in aliases if x))
    assert all(len(x) <= 255 for x in [name] + row['aliases']), name
    ROWS.append(row)


def asc():
    photo_defs = {
        'bw-std': ('bwanvilet-buttweld-anvilets', 1, 0),
        'bw-xs': ('bwanvilet-buttweld-anvilets', 2, 2),
        'bw-heavy': ('bwanvilet-buttweld-anvilets', 3, 4),
        'th-3000': ('thanvilet-threaded-anvilets', 1, 0),
        'th-6000': ('thanvilet-threaded-anvilets', 1, 2),
        'sw-3000': ('swanvilets-socket-weld', 1, 0),
        'sw-6000': ('swanvilets-socket-weld', 1, 2),
    }
    extracted = set()
    for key, (slug, page_number, index) in photo_defs.items():
        page_url = 'https://www.asc-es.com/products/' + slug
        page = BeautifulSoup(fetch(page_url, slug + '.html'), 'html.parser')
        resource = json.loads(page.select_one('submittal-widget')['submittal-file-url'])[0]
        url = 'https://www.asc-es.com' + resource
        pdf = fetch(url, slug + '.pdf')
        if slug not in extracted:
            subprocess.run(['pdfimages', '-png', str(CACHE / (slug+'.pdf')), str(CACHE / ('extract-'+slug))], check=True, capture_output=True)
            extracted.add(slug)
        raw = (CACHE / f'extract-{slug}-{index:03}.png').read_bytes()
        mask = (CACHE / f'extract-{slug}-{index+1:03}.png').read_bytes()
        photograph('asc-outlet:'+key, url, page_number, raw,
                   'Exact Anvil family/class photograph from the manufacturer submittal, representative across its listed sizes.',
                   mask=mask, sourcePdfSha256=sha(pdf), sourceImageIndex=index, sourceMaskSha256=sha(mask))
    sheet = xlrd.open_workbook(file_contents=fetch(ASC_XLS, 'UAN-6.26-website.xls')).sheet_by_index(0)
    for ri in range(2, sheet.nrows):
        a = sheet.row_values(ri)
        if a[4] != 'UANVILET' or 'ELBOWLET' in a[5]:
            continue
        source = {'manufacturer': 'Anvil / ASC', 'sku': a[2], 'manufacturerDescription': a[5],
                  'sourceUrl': ASC_XLS, 'sourceSheet': sheet.name, 'sourceRow': ri+1}
        run, branch = a[5].split()[0].split('X')
        if run == 'FLAT':
            EXCLUDED.append({**source, 'reason': 'Flat-base outlet requires a distinct photograph; curved saddle photo not substituted.'})
            continue
        run_sizes = sorted([inch(x, asc=True) for x in run.split('-')], key=lambda x:x[1])
        bs, bn = inch(branch, asc=True)
        run_label = '–'.join(x[0] for x in run_sizes)
        spec = a[5].split()[1]
        if 'BW ' in a[5] or 'B/W ' in a[5]:
            conn, fitting, alias = 'Butt Weld', 'Weld Outlet', 'Weldolet'
            schedule = {'STD':'STD', 'XS':'XS', 'XXS':'XXS', 'S160':'Sch 160'}[spec]
            rating = schedule
            key = 'bw-std' if spec=='STD' else 'bw-xs' if spec=='XS' else 'bw-heavy'
            end = 'BW'
        elif 'S/W' in a[5]:
            conn, fitting, alias = 'Socket Weld', 'Socket Weld Outlet', 'Sockolet'
            rating = spec.replace('#','')+'#'; key = 'sw-'+spec.replace('#',''); end='SW'
        else:
            conn, fitting, alias = 'Threaded', 'Threaded Outlet', 'Thredolet'
            rating = spec.replace('#','')+'#'; key = 'th-'+spec.replace('#',''); end='FNPT'
        row = {**source, 'family':'forged-steel-branch-outlets', 'model':a[4], 'upc':a[1],
               'material':'Forged Steel', 'category':'Branch Outlets', 'connectionType':conn,
               'connectionSizes':[bs], 'connectionEnds':[end], 'sizeLabel':bs+' (run '+run_label+')',
               'sizeNominal':bn, 'runSizeMin':run_sizes[0][0], 'runSizeMax':run_sizes[-1][0],
               'runSizeLabel':run_label, 'runSizeSource':run, 'fittingType':fitting,
               'pressureClass':spec.replace('#','') if '#' in spec else '',
               'schedule':schedule if conn=='Butt Weld' else '', 'standard':'ASTM A105; MSS SP-97',
               'imageKey':'asc-outlet:'+key}
        name=f'{bs} {rating} Forged Steel {fitting} (Run {run_label})'
        finish(row,name,[alias,'Anvilet','Anvil','ASC Engineered Solutions','ASTM A105','MSS SP-97',
                         'Run '+run_label,'Branch '+bs, 'Anvil '+a[2], 'Class '+spec.replace('#','') if '#' in spec else schedule])
    assert sum(r['family']=='forged-steel-branch-outlets' for r in ROWS)==185


def dixon():
    pages = ['flange-gasket', '150-lb-neoprene-flange-gasket-kit', '150-lb-ptfe-flange-gasket-kit']
    for slug in pages:
        url=DIXON+'/en/products/'+slug
        filename=slug+'.html'
        page=BeautifulSoup(fetch(url,filename),'html.parser')
        headers=[t.get_text(' ',strip=True).split('All')[0].strip() for t in page.select('table thead th')]
        for tr in page.select('table tbody tr'):
            vals=[t.get_text(' ',strip=True) for t in tr.select('td')]
            if not vals:continue
            # First cell repeats the linked SKU in a mobile label.
            sku=tr.select_one('a').get_text(' ',strip=True)
            vals[0]=sku
            data=dict(zip(headers,vals))
            size=inch(data['Size']); material=data['Material'].replace(' ®','').replace('®','').strip()
            kit='kit' in slug
            prefix=sku[:2]
            imagekey='dixon:'+('kit-'+prefix if kit else 'gasket-'+prefix)
            if imagekey not in IMAGES:
                photo_page=url if kit else DIXON+'/en/products/flange-gasket/'+{'NG':'ng40','AG':'ag40','PG':'pg40'}[prefix]
                photo_html=page if kit else BeautifulSoup(fetch(photo_page,'flange-gasket-'+{'NG':'ng40','AG':'ag40','PG':'pg40'}[prefix]+'.html'),'html.parser')
                image_url=DIXON+photo_html.select_one('img.image-style-product')['data-src']
                photo=fetch(image_url)
                photograph(imagekey,image_url,photo_page,photo,'Official Dixon photo for the exact gasket material and '+('bolt/gasket kit' if kit else 'drop-ring gasket')+' family. Representative across sizes; original manufacturer watermark retained.')
            thickness=inch(data['Thickness'])[0]
            name=f'{size[0]} 150# {material} '+('Flange Gasket & Bolt Kit' if kit else 'Ring Flange Gasket')
            extra=['Dixon Valve','Class 150','Drop-ring','Thickness '+thickness]
            if kit:
                length=inch(data['Length'])[0]
                name+=' ('+length+' Bolts)';extra+=['Bolt length '+length,'Nuts and lock washers included']
            row={'family':'flange-accessories', 'manufacturer':'Dixon', 'brand':'Dixon', 'sku':sku,
                 'manufacturerDescription':sku+' '+material+' '+('Flange Gasket Kit' if kit else 'Flange Gasket'),
                 'sourceUrl':url,'productPage':DIXON+tr.select_one('a')['href'],
                 'material':material,'category':'Flange Accessories','connectionType':'Flanged',
                 'connectionSizes':[size[0]],'sizeLabel':size[0],'sizeNominal':size[1],
                 'fittingType':'Gasket & Bolt Kit' if kit else 'Ring Flange Gasket', 'pressureClass':'150',
                 'gasketMaterial':material,'gasketFaceStyle':'Drop-ring','gasketThickness':thickness,
                 'imageKey':imagekey}
            if kit:row['boltLength']=length
            finish(row,name,extra)
    assert sum(r.get('manufacturer')=='Dixon' for r in ROWS)==34


def dd():
    products=json.loads(fetch(DD_JSON,'dd-products.json'))['products']
    # Published kit variants contain a copied Class150 length in every Class300
    # option. One Class150 10-inch option conflicts with the official kit chart.
    # Neither inconsistency is silently repaired into an invented article.
    chart150='https://ddenginc.com/wp-content/uploads/DD_Flange_Bolting_Kit_Class150.pdf'
    chart300='https://ddenginc.com/wp-content/uploads/DD_Flange_Bolting_Kit_Class300.pdf'
    SOURCES[chart150]={'url':chart150,'notes':'Official Class150 chart checked against kit options; 10-inch length discrepancy excluded.'}
    SOURCES[chart300]={'url':chart300,'notes':'Official Class300 chart contradicts copied Class150 shop option lengths; all14 excluded.'}
    selected={'b7-bolt-up-kits','b7-a193-stud-bolt-black','b7-a193-stud-bolt-zinc-plated','2h-nuts','f436-washer-carbon-steel','f436-washer-zinc-plated'}
    for p in products:
        spiral=p['title'].startswith('Style') and 'DIN' not in p['title']
        if not spiral and p['handle'] not in selected:continue
        url='https://shop.ddenginc.com/products/'+p['handle']
        photo_variant=next((v for v in p['variants'] if v['title']=='4"'),p['variants'][0])
        photo=photo_variant['featured_image'] or p['images'][0]
        imagekey='dd:'+p['handle']
        photograph(imagekey,photo['src'],url,fetch(photo['src'],p['handle']+'.jpg'),
                   'First-party catalogue family photograph, representative across the listed sizes. Exact published '+p['title']+' family; source example variant '+str(photo_variant['id'])+'.',sourceVariantId=str(photo_variant['id']))
        for v in p['variants']:
            title=v['title']
            source={'sku':str(v['id']), 'skuKind':'catalogue-variant-id', 'sourceVariantId':str(v['id']),
                    'sourceProductId':str(p['id']), 'sourceVendor':'D&D Engineered Products',
                    'manufacturerDescription':p['title']+' — '+title,'sourceUrl':DD_JSON,
                    'productPage':url+'?variant='+str(v['id'])}
            if p['handle']=='b7-bolt-up-kits' and (v['option1']=='300' or title.startswith('300 /') or title.startswith('150 / 10"')):
                EXCLUDED.append({**source,'reason':'Published shop stud length conflicts with the official bolting chart.','comparisonSource':chart300 if title.startswith('300') else chart150})
                continue
            row={**source,'family':'flange-accessories','category':'Flange Accessories','imageKey':imagekey}
            extra=[]
            if spiral:
                m=re.fullmatch(r'Style (WR[I]?) (304|316)/FG \(Flexible Graphite\) (\d+)#',p['title']);assert m,p['title']
                style,grade,rating=m.groups();s,n=inch(title)
                row.update(manufacturer='Spiraltec',brand='Spiraltec',material=grade+' Stainless / Graphite',
                           connectionType='Flanged',connectionSizes=[s],sizeLabel=s,sizeNominal=n,
                           fittingType='Spiral Wound Gasket',pressureClass=rating,gasketStyle=style,
                           gasketMaterial=grade+' Stainless Steel / Flexible Graphite',gasketFaceStyle='Ring',
                           standard='ASME B16.20',innerRingMaterial=grade+' Stainless Steel' if style=='WRI' else '',
                           hasInnerRing=style=='WRI')
                name=f'{s} {rating}# {grade} Stainless/Graphite Spiral Wound Gasket'+(' with Inner Ring' if style=='WRI' else ' with Outer Ring')
                extra=[style,grade+' SS','Flexible Graphite','ASME B16.20','Class '+rating,'Spiraltec Gasket Co.']
            elif p['handle']=='b7-bolt-up-kits':
                rating,szlen=title.split(' / ',1);sz,lt=szlen.split('|');s,n=inch(sz.strip())
                length=re.search(r'Standard Stud ([^\(]+)',lt).group(1).strip();length=inch(length)[0]
                row.update(material='Alloy Steel B7',connectionType='Flanged',connectionSizes=[s],sizeLabel=s,sizeNominal=n,
                           fittingType='Flange Stud & Nut Kit',pressureClass=rating,studGrade='ASTM A193 B7',nutGrade='ASTM A194 2H',studLength=length)
                name=f'{s} {rating}# B7 Flange Stud & Nut Kit'
                extra=['ASTM A193 B7','ASTM A194 2H','Stud length '+length,'Washers optional','Gasket not included']
            elif p['handle'].startswith('b7-a193-stud-bolt'):
                m=re.fullmatch(r'(.+?) - (\d+) x (.+?) \(OAL (.+?)\)',title);assert m,title
                diameter,tpi,length,oal=m.groups();s,n=inch(diameter);length=inch(length)[0]
                zinc='zinc' in p['handle'];finish_='Zinc Plated' if zinc else 'Black Oxide'
                row.update(material='Alloy Steel B7',connectionType='Threaded',connectionSizes=[s],sizeLabel=s+' x '+length,sizeNominal=n,
                           fittingType='Stud Bolt & Nuts' if zinc else 'Stud Bolt',pressureClass='',studGrade='ASTM A193 B7',
                           threadPitchTPI=tpi,studLength=length,overallLength=inch(oal)[0],finish=finish_,includedNutCount=2 if zinc else 0)
                name=f'{s}-{tpi} x {length} B7 {finish_} Stud Bolt'+(' with 2H Nuts' if zinc else '')
                extra=['ASTM A193 B7',finish_,'Thread '+s+'-'+tpi,'Standard stud length '+length,'Overall length '+inch(oal)[0]]
                if zinc:extra+=['Includes two ASTM A194 2H nuts']
            elif p['handle']=='2h-nuts':
                diameter,tpi=title.split(' - ');s,n=inch(diameter)
                row.update(material='Carbon Steel 2H',connectionType='Threaded',connectionSizes=[s],sizeLabel=s,sizeNominal=n,
                           fittingType='Heavy Hex Nut',pressureClass='',nutGrade='ASTM A194 2H',threadPitchTPI=tpi)
                name=f'{s}-{tpi} 2H Heavy Hex Nut';extra=['ASTM A194 2H','Heavy hex','Thread '+s+'-'+tpi]
            else:
                s,n=inch(title);zinc='zinc' in p['handle'];finish_='Zinc Plated' if zinc else 'Plain'
                row.update(material='Carbon Steel F436',connectionType='Bolted',connectionSizes=[s],sizeLabel=s,sizeNominal=n,
                           fittingType='Hardened Washer',pressureClass='',standard='ASTM F436',finish=finish_)
                name=f'{s} F436 {finish_} Hardened Washer';extra=['ASTM F436',finish_]
            finish(row,name,extra)


def main():
    CACHE.mkdir(exist_ok=True,parents=True)
    asc();dixon();dd()
    assert len({(r.get('manufacturer',r.get('sourceVendor')),r['sku']) for r in ROWS})==len(ROWS)
    names=Counter(r['displayName'] for r in ROWS)
    assert max(names.values())==1, [x for x,n in names.items() if n>1]
    assert all(r['imageKey'] in IMAGES for r in ROWS)
    result={'sourceDate':date.today().isoformat(),'counts':dict(Counter(r['family'] for r in ROWS)),
            'coverageByType':dict(Counter(r['fittingType'] for r in ROWS)),
            'notes':['No prices imported. All rows correspond to explicit source rows or published catalogue variants.',
                     'Anvilet run ranges retained as supplied; connectionSizes denotes outlet only, not invented range expansions.',
                     'Weldolet/Sockolet/Thredolet are search aliases for generic branch geometry; the listed manufacturer is Anvil.',
                     'D&D variant IDs are catalogue identities, not manufacturer part numbers. D&D is a source vendor for bolting. Spiraltec is its documented gasket manufacturing brand.',
                     'Dixon current product options list PG25 gasket thickness as 1/8 inch; old catalogue generic 1/16-inch statement not applied to that SKU.',
                     'Fifteen contradictory D&D bolt-kit variants and one distinct flat outlet with no verified photo excluded.'],
            'sources':list(SOURCES.values()),'exclusions':EXCLUDED,'rows':ROWS,'images':IMAGES}
    OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    # Compact sheet showing every distinct image, labels and native resolution.
    width,height=1200,290*math.ceil(len(IMAGES)/4)
    sheet=Image.new('RGB',(width,height),'white');draw=ImageDraw.Draw(sheet)
    for i,(key,meta) in enumerate(IMAGES.items()):
        im=Image.open(meta['path']);im.thumbnail((280,230));x=i%4*300;y=i//4*290
        sheet.paste(im,(x+(300-im.width)//2,y));label=key.replace('dd:style-','').replace('flexible-graphite','FG')
        draw.text((x+6,y+232),label[:45],fill='black');draw.text((x+6,y+250),f"native {meta['sourceWidth']} x {meta['sourceHeight']}",fill='black')
    sheet.save(CACHE/'final-contact.jpg',quality=93)
    print(json.dumps({'rows':len(ROWS),'images':len(IMAGES),'counts':result['counts'],'coverage':result['coverageByType'],'exclusions':len(EXCLUDED)},indent=2))

if __name__=='__main__':main()
