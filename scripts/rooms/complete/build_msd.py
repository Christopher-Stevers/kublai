"""CC BY 4.0 MSD geometry -> monochrome, text-free, all-interior-space tests.
Generated wall-boundary inputs are not original construction-sheet scans.
Site-level split, no reference polygons/seeds are supplied for discovery.
"""
import argparse,collections,hashlib,json,math
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from shapely import wkt
from shapely.geometry import Polygon,MultiPolygon
p=argparse.ArgumentParser();p.add_argument('--corpus',default='/home/tim/datasets/foremanhq-room-detection');p.add_argument('--count',type=int,default=200);a=p.parse_args()
root=Path(a.corpus);out=root/'all-spaces-msd';out.mkdir(exist_ok=True);counts=collections.Counter();manifest=[]
for line in (root/'msd/floors.jsonl').open():
 record=json.loads(line);group=str(record['site_id']);split='holdout' if int(hashlib.sha256(group.encode()).hexdigest()[:8],16)%5==0 else 'development'
 if counts[split]>=a.count:continue
 rooms=[]
 for r in record['rooms']:
  if r['entity_type']!='area' or r['entity_subtype'] in ('SHAFT','BALCONY','TERRACE','OUTDOOR'):continue
  try:shape=wkt.loads(r['geom'])
  except Exception:continue
  if not shape.is_valid:shape=shape.buffer(0)
  if not shape.is_empty and shape.area>.3:rooms.append((r,shape))
 if len(rooms)<3:continue
 minx=min(s.bounds[0] for _,s in rooms);miny=min(s.bounds[1] for _,s in rooms);maxx=max(s.bounds[2] for _,s in rooms);maxy=max(s.bounds[3] for _,s in rooms)
 width=1024;scale=920/max(maxx-minx,maxy-miny);height=max(200,math.ceil((maxy-miny)*scale)+104)
 image=Image.new('RGB',(width,height),'white');draw=ImageDraw.Draw(image);truth=Image.new('I',(width,height),0);td=ImageDraw.Draw(truth);annotations=[]
 def coords(ring):return [((x-minx)*scale+52,(maxy-y)*scale+52) for x,y in ring.coords]
 for label,(r,shape) in enumerate(rooms,1):
  polys=list(shape.geoms) if isinstance(shape,MultiPolygon) else [shape]
  for poly in polys:
   outer=coords(poly.exterior);draw.line(outer,fill='black',width=4,joint='curve');td.polygon(outer,fill=label)
   for hole in poly.interiors:
    points=coords(hole);draw.line(points,fill='black',width=4);td.polygon(points,fill=0)
  seed=shape.representative_point();annotations.append({'label':label,'kind':r['entity_subtype'],'name':r['roomtype'] or r['entity_subtype'],'seed':[(seed.x-minx)*scale/width+52/width,(maxy-seed.y)*scale/height+52/height]})
 ident=record['id'];image_path=out/f'{ident}.png';image.save(image_path);np.save(out/f'{ident}.truth.npy',np.asarray(truth,dtype=np.int32));(out/f'{ident}.json').write_text(json.dumps(annotations))
 manifest.append({'id':ident,'split':split,'site':group,'image':image_path.name,'truth':f'{ident}.truth.npy','annotations':f'{ident}.json','image_sha256':hashlib.sha256(image_path.read_bytes()).hexdigest()});counts[split]+=1
 if counts['development']>=a.count and counts['holdout']>=a.count:break
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(dict(counts))
