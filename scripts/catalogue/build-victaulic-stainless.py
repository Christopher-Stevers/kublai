#!/usr/bin/env python3
"""Extract only published fitting/size combinations from pinned Victaulic submittals.
Run with the bundled Python (pdfplumber/Pillow). Source PDFs live outside git.
"""
import argparse, collections, hashlib, json, re
from fractions import Fraction
from pathlib import Path
import pdfplumber

parser=argparse.ArgumentParser();parser.add_argument('--sources',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
ROOT=args.sources
OD={'1.050':(.75,26.9),'1.315':(1,33.7),'1.660':(1.25,42.4),'1.900':(1.5,48.3),'2.375':(2,60.3),'2.875':(2.5,73.0),'3.000':(2.5,76.1),'3.500':(3,88.9),'4.000':(3.5,101.6),'4.500':(4,114.3),'5.000':(4.5,127.0),'5.500':(5,139.7),'5.563':(5,141.3),'6.500':(6,165.1),'6.625':(6,168.3),'8.625':(8,219.1),'10.750':(10,273.0),'12.750':(12,323.9),'14.000':(14,355.6),'16.000':(16,406.4),'18.000':(18,457.2),'20.000':(20,508.0),'22.000':(22,558.8),'24.000':(24,609.6),'216.3':(8,216.3),'267.4':(10,267.4),'318.5':(12,318.5)}
OD.update({'8.515':(8,216.3),'10.528':(10,267.4),'12.539':(12,318.5)})
SPECIAL={'8.515','10.528','12.539','3.000','5.500','6.500','216.3','267.4','318.5'}
rows=[];audit=[];images={}
LABELS={'410':'90° Elbow','410-DR':'90° Drain Elbow (1 inch NPT drain)','411':'45° Elbow','412':'22.5° Elbow','413':'11.25° Elbow','420':'Tee','425':'Reducing Tee','430':'45° Lateral','433':'True Wye','435':'Cross','440':'Adapter Nipple Grv x Male NPT','442':'Adapter Nipple Grv x Beveled','443':'Adapter Nipple Grv x Grv','449':'Adapter Nipple AGS x OGS','445R':'Flange Adapter Nipple ANSI 150 Raised Face','450':'Concentric Reducer','451':'Eccentric Reducer','460':'Cap','E490':'90° Elbow','E491':'45° Elbow','E412':'22.5° Elbow','E413':'11.25° Elbow','E492':'Tee','E493':'Reducing Tee','E494':'Adapter Nipple ST100 x Plain End','E494G':'Adapter Nipple ST100 x OGS','E440H':'Adapter Nipple ST100 x Male NPT','E494I':'Instrumentation Nipple','E495':'Concentric Reducer','E496':'Cap','E498':'Flange Adapter Nipple'}
def fraction(n):
 f=Fraction(n).limit_denominator(16);whole=f.numerator//f.denominator;rem=f.numerator%f.denominator
 return str(whole) if not rem else (f'{whole} ' if whole else '')+f'{rem}/{f.denominator}'
def emit(doc,page,model,label,dims,ods,variant,grades,schedules,system,dimension,evidence,image=None):
 size=' x '.join(fraction(x) for x in dims);formatted=' x '.join(fraction(x)+'"' for x in dims)
 special=any(x in SPECIAL for x in ods)
 actual=[OD[x][1] for x in ods] if ods else []
 od_note=' (OD '+ ' x '.join(f'{x:g}' for x in actual)+' mm)' if special else ''
 image=image or f'{doc}-{page}-{model}'
 images.setdefault(image,{'publication':doc,'page':page,'model':model,'label':label})
 for schedule in schedules:
  for grade in grades:
   wall=f' Sch {schedule}' if schedule else ''
   desc=f'{grade} SS {system}{wall} {label}'+(f' {variant}' if variant else '')+f' - Victaulic {model}'+od_note
   name=f'{formatted} {desc}'
   assert len(name)<=255,name
   rows.append({'displayName':name,'description':desc,'catalog':'Plumbing','category':'Fitting','material':'Stainless Steel Grooved' if 'Duplex' not in grade else 'Duplex Stainless Grooved','sizeNominal':dims[0],'sizeLabel':size,'sizeUnit':'in','manufacturer':'Victaulic','model':model,'grade':grade,'schedule':schedule,'system':system,'variant':variant,'actualOutsideDiametersMm':actual,'dimensions':dimension,'source':{'publication':doc,'page':page,'url':f'https://assets.victaulic.com/assets/uploads/literature/{doc}.pdf','evidence':evidence},'imageKey':image,'aliases':[f'{formatted} Victaulic No. {model} {grade}'+wall+(f' {variant}' if variant else '')+od_note, f'{formatted} Stainless Steel {system} {label} {grade}'+wall+(f' {variant}' if variant else '')+od_note]})

def extract(doc,page,dimcols,models,tableindex=None):
 """Anchor rows to the last actual-OD column; carry only merged run OD cells.
 This bypasses PDF merged-cell artifacts without inventing size combinations.
 models: (model, dimension column, variant, label override, image key).
 """
 with pdfplumber.open(ROOT/(doc+'.pdf')) as pdf:
  p=pdf.pages[page-1];tables=p.find_tables();t=tables[tableindex] if tableindex is not None else max(tables,key=lambda t:len(t.rows))
  edges=[c.bbox[0] for c in t.columns]+[t.bbox[2]]
  cols=list(zip(edges,edges[1:]));words=p.extract_words();start=t.rows[1].bbox[3] if len(t.rows)>1 else t.bbox[1]
  def incol(w,i):return cols[i][0]+.2<(w['x0']+w['x1'])/2<cols[i][1]-.2
  anchors=[w for w in words if incol(w,dimcols[-1]) and start<=w['top']<t.bbox[3] and w['text'] in OD]
  carry=[None]*len(dimcols);previousY=None
  for anchor in anchors:
   y=anchor['top']
   if anchor['text'] in ['216.3','267.4','318.5'] and any(incol(w,dimcols[-1]) and 0<y-w['top']<13 and w['text'] in ['8.515','10.528','12.539'] for w in words):continue
   if previousY is not None and abs(y-previousY)<3:continue
   previousY=y
   line=[w for w in words if abs(w['top']-y)<2.8]
   for i,col in enumerate(dimcols):
    vals=[w['text'] for w in line if incol(w,col) and w['text'] in OD]
    if vals:carry[i]={'216.3':'8.515','267.4':'10.528','318.5':'12.539'}.get(vals[0],vals[0])
   assert all(carry),(doc,page,y,carry)
   dims=[OD[v][0] for v in carry]
   for model,col,variant,label,image in models:
    tokens=[w['text'] for w in line if incol(w,col)]
    measurement=next((x for x in tokens if re.match(r'^\d+(\.\d+)?(?:\(c\))?$',x)),None)
    if not measurement:continue # A dash is absence, not a size-range hint.
    grade=['304L','316L'];schedule=['10S'];system='OGS';base=re.sub(r'(SS|[CH])$','',model).strip();base=base.removeprefix('W')
    if doc=='17.16':
     if variant=='Cast' or (variant=='Standard' and ((base in ['410','411'] and 1<=dims[0]<=2.5) or (base in ['420','425','450','451'] and 1.5<=dims[0]<=2.5))):grade=['316 CF8M'];variant='Cast'
     if base=='460':grade=['316 CF8M'] if variant=='Cast' else ['316'];
    elif doc=='17.50':grade=['316 CF8M'] if 'C'==model[-1] else ['304L','316L'];schedule=['40S']
    elif doc=='17.18':
     grade=['Super Duplex CE3MN'];schedule=['40S']
     if model=='460DX':grade=['Duplex S31803','Duplex S32205','Super Duplex S32750'];schedule=['40S']
    elif doc=='17.05':schedule=['10S','40S'];system='AGS'
    elif doc=='31.04':
     system='StrengThin 100';schedule=[None]
     cast='(c)' in measurement or model=='E494G'
     grade=['304 CF8','316 CF8M'] if cast else ['304L','316L']
     if model=='E498':grade=['304/304L','316']
     if cast:variant='Cast'
    label=label or LABELS.get(base,LABELS.get(model))
    assert label,(doc,page,model,base)
    desc=' | '.join(w['text'] for w in line)
    emit(doc,page,model,label,dims,carry.copy(),variant,grade,schedule,system,{'publishedDimensionInches':measurement,'dimensionColumn':col},desc,image)
   audit.append({'publication':doc,'page':page,'actualOD':carry.copy(),'nominal':dims,'line':' '.join(w['text'] for w in line)})

# Explicit table/column maps keep source layout changes detectable.
extract('17.16',3,[1],[('410 SS',2,'Standard',None,'ogs-410'),('410 SS',4,'SWS',None,'ogs-410'),('411 SS',6,'Standard',None,'ogs-411'),('411 SS',8,'SWS',None,'ogs-411')])
extract('17.16',4,[1],[('410-DR',2,'',None,'ogs-410-dr')])
extract('17.16',5,[1],[('412 SS',2,'SWS',None,'ogs-412'),('413 SS',4,'SWS',None,'ogs-413')])
extract('17.16',6,[1],[('420 SS',2,'Standard',None,'ogs-420'),('420 SS',4,'SWS',None,'ogs-420')])
for p in [7,8,9,10]:extract('17.16',p,[5,7,9],[('425 SS',10,'Standard',None,'ogs-425'),('425 SS',13,'SWS',None,'ogs-425')])
extract('17.16',11,[1],[('430 SS',2,'SWS',None,'ogs-430'),('433 SS',5,'SWS',None,'ogs-433'),('435 SS',8,'SWS',None,'ogs-435')])
extract('17.16',12,[1],[('442 SS',2,'',None,'ogs-442'),('443 SS',4,'',None,'ogs-443')])
for p in [13,14,15]:extract('17.16',p,[3,5],[('450 SS',6,'Standard',None,'ogs-450'),('450 SS',8,'SWS',None,'ogs-450'),('451 SS',10,'Standard',None,'ogs-451'),('451 SS',12,'SWS',None,'ogs-451')])
extract('17.16',16,[1],[('460 SS',2,'Cast',None,'ogs-460-cast'),('460 SS',5,'Flat',None,'ogs-460-flat')])
extract('17.50',3,[1],[('410C',2,'Cast',None,'ogs-410'),('410H',4,'SWS',None,'ogs-410'),('411C',6,'Cast',None,'ogs-411'),('411H',8,'SWS',None,'ogs-411')])
extract('17.50',4,[1],[('412H',2,'SWS',None,'ogs-412'),('413H',4,'SWS',None,'ogs-413')])
extract('17.50',5,[1],[('420C',2,'Cast',None,'ogs-420'),('420H',4,'SWS',None,'ogs-420')])
for p in [6,7,8]:extract('17.50',p,[5,7,9],[('425C',10,'Cast',None,'ogs-425'),('425H',12,'SWS',None,'ogs-425')])
extract('17.50',9,[1],[('430H',2,'SWS',None,'ogs-430'),('433H',5,'SWS',None,'ogs-433'),('435H',8,'SWS',None,'ogs-435')])
extract('17.50',10,[1],[('440H',2,'',None,'ogs-440'),('442H',4,'',None,'ogs-442'),('443H',6,'',None,'ogs-443')])
for p in [11,12]:extract('17.50',p,[7,9],[('450C',10,'Cast',None,'ogs-450'),('450H',12,'SWS',None,'ogs-450'),('451C',14,'Cast',None,'ogs-451'),('451H',16,'SWS',None,'ogs-451')])
extract('17.50',13,[1],[('460H',2,'Flat',None,'ogs-460-flat'),('460H',5,'SWS',None,'ogs-460-sws')])
extract('17.18',2,[1],[('410DX',2,'Cast','90° Elbow','ogs-410'),('411DX',4,'Cast','45° Elbow','ogs-411')],3)
extract('17.18',2,[1],[('420DX',2,'Cast','Tee','ogs-420')],6)
extract('17.18',3,[5,7,9],[('425DX',10,'Cast','Reducing Tee','ogs-425')],2)
extract('17.18',3,[1],[('460DX',2,'Flat','Cap','ogs-460-flat')],4)
extract('17.05',2,[1],[('W410',2,'','90° Long Radius Elbow','ags-410'),('W411',4,'',None,'ags-411'),('W420',6,'',None,'ags-420')])
for p in [3,4]:extract('17.05',p,[5,7,9],[('W425',10,'',None,'ags-425')])
extract('17.05',5,[1],[('W442',2,'',None,'ags-442'),('W443',4,'',None,'ags-443'),('W449',6,'',None,'ags-449')])
extract('17.05',6,[1],[('W445R',2,'',None,'ags-445r')],0)
extract('17.05',6,[1],[('W460',2,'',None,'ags-460')],1)
for p in [7,8]:extract('17.05',p,[3,5],[('W450',6,'',None,'ags-450'),('W451',8,'',None,'ags-451')])
extract('31.04',3,[1],[('E490',2,'',None,'st100-490'),('E491',4,'',None,'st100-491')])
extract('31.04',4,[1],[('E412',2,'',None,'st100-412'),('E413',4,'',None,'st100-413')])
extract('31.04',5,[1],[('E492',2,'',None,'st100-492')])
extract('31.04',6,[5,7,9],[('E493',10,'',None,'st100-493')])
extract('31.04',7,[1],[('E494',3,'',None,'st100-494')])
extract('31.04',8,[1],[('E494G',2,'Cast',None,'st100-494g')])
extract('31.04',9,[1],[('E440H',2,'',None,'st100-440h')])
extract('31.04',10,[1],[('E494I',2,'',None,'st100-494i')])
extract('31.04',11,[3,5],[('E495',6,'',None,'st100-495')])
extract('31.04',12,[1],[('E496',2,'',None,'st100-496')])
extract('31.04',13,[1],[('E498',2,'PN10',None,'st100-498'),('E498',4,'PN16',None,'st100-498')])
# 17.32's side-by-side nominal-only tables have no actual OD columns.
# Each explicit combination below is transcribed from pages 2-4, not expanded from a range.
for model,label,page,combos,image in [
 ('401DX','90° Elbow',2,[(x,) for x in [3,4,6,8,10,12,14,16]],'sthp-401'),
 ('403DX','45° Elbow',2,[(x,) for x in [3,4,6,8,10,12,14,16]],'sthp-403'),
 ('402DX','Tee',2,[(x,) for x in [3,4,6,8,10,12,14,16]],'sthp-402'),
 ('404DX','Concentric Reducer',3,[(4,3),(6,4),(8,4),(8,6),(10,6),(10,8),(12,8),(12,10),(14,10),(14,12),(16,12)],'sthp-404'),
 ('405DX','Reducing Tee',3,[(4,4,2),(4,4,3),(6,6,4),(8,8,4),(8,8,6),(10,10,6),(10,10,8),(12,12,6),(12,12,8),(12,12,10),(14,14,6),(14,14,8),(14,14,10),(14,14,12)],'sthp-405'),
 ('406DX','Cap',4,[(x,) for x in [3,4,6,8,10,12,14,16]],'sthp-406')]:
 for dims in combos:emit('17.32',page,model,label,list(dims),[], 'Cast' if dims[0]<=8 else 'Fabricated', ['Super Duplex','Duplex'],[None],'StrengThin High Pressure',{},'Explicit nominal table combination '+str(dims),image)
for r in rows:
 od=r['actualOutsideDiametersMm']
 if len(od)>1:assert od[0]>od[-1] and (len(od)!=3 or od[0]==od[1]),r['displayName']
keys=[r['displayName'].lower() for r in rows]
assert len(keys)==len(set(keys)),[k for k,n in collections.Counter(keys).items() if n>1]
publications=[]
for doc in ['17.16','17.50','17.18','17.05','31.04','17.32']:
 p=ROOT/(doc+'.pdf');publications.append({'number':doc,'url':f'https://assets.victaulic.com/assets/uploads/literature/{doc}.pdf','sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
result={'manufacturer':'Victaulic','retrievedOn':'2026-10-17','publications':publications,'rows':rows,'images':images,'extractionAudit':audit,'countsByPublication':dict(collections.Counter(r['source']['publication'] for r in rows))}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'rows':len(rows),'images':len(images),'counts':result['countsByPublication']},indent=2))
