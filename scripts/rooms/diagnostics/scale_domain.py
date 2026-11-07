"""CPU descriptive scale/domain diagnostics on two explicitly allowed datasets.

No prediction, training, thresholds for a detector, protected assets, or model
weights are opened. Swiss physical-room completeness is explicitly unknown.
"""
from __future__ import annotations
import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import shutil
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize
from shapely import wkt

BASE = Path('/home/tim/datasets/foremanhq-room-detection/models')
CONTEXT = BASE / 'data-context-20260930/manifest.json'
SWISS = BASE / 'data-swiss-true-openings-v4-20260930/manifest.json'
CONTEXT_SHA = '79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac'
SWISS_SHA = '619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b'
ORIGINAL_BINDING = Path('/home/tim/datasets/foremanhq-room-detection/partition/binding-20260930/binding.json')
BINDING_SHA = 'c6de300983e801a7e64e9d9f307009444248ad03b06198682607b360592f680f'
OVERVIEW = 512
TILE = 512
STRUCTURE = np.array([[0,1,0],[1,1,1],[0,1,0]])


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()


def verify(frozen):
    for path,sha in frozen.items():
        if digest(path)!=sha: raise ValueError('Frozen diagnostic bytes changed: '+str(path))


def asset(root,name,sha):
    if not isinstance(name,str) or Path(name).is_absolute(): raise ValueError('Relative local asset required')
    path=(root/name).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or digest(path)!=sha: raise ValueError('Asset escape/hash mismatch')
    return path


def quantiles(values):
    a=np.asarray(values,dtype=np.float64)
    if not len(a): return {'n':0,'min':None,'p10':None,'p50':None,'p90':None,'max':None}
    if not np.isfinite(a).all(): raise ValueError('Nonfinite diagnostic sample')
    return {'n':int(a.size),'min':float(a.min()),'p10':float(np.quantile(a,.1)),
            'p50':float(np.quantile(a,.5)),'p90':float(np.quantile(a,.9)),'max':float(a.max())}


def barrier_diameters(mask):
    """2*EDT at Zhang skeleton pixels; diameter proxy with raster rounding."""
    return 2*ndimage.distance_transform_edt(mask)[skeletonize(mask,method='zhang')]


def opening_spans(mask):
    """PCA-oriented pixel-cell bounding spans, not original door entity widths."""
    labels,count=ndimage.label(mask,STRUCTURE)
    sizes=np.bincount(labels.ravel())
    major,minor,areas=[],[],[]
    for ident,box in enumerate(ndimage.find_objects(labels),1):
        if box is None: continue
        points=np.argwhere(labels[box]==ident).astype(np.float64)
        if len(points)==1:
            spans=np.array([1.,1.])
        else:
            _,vectors=np.linalg.eigh(np.cov(points,rowvar=False))
            projected=points@vectors
            # A pixel cell contributes this additional support along each axis.
            spans=np.ptp(projected,axis=0)+np.abs(vectors).sum(axis=0)
        major.append(float(max(spans))); minor.append(float(min(spans)));areas.append(int(sizes[ident]))
    return np.asarray(major),np.asarray(minor),np.asarray(areas)


def region_scales(labels):
    counts=np.bincount(labels.ravel())
    areas,short,long=[],[],[]
    for ident,box in enumerate(ndimage.find_objects(labels),1):
        if box is None: continue
        y,x=box; areas.append(int(counts[ident])); spans=[y.stop-y.start,x.stop-x.start]
        short.append(min(spans));long.append(max(spans))
    return np.asarray(areas),np.asarray(short),np.asarray(long)


def reference_scales(references,scale):
    areas,short,long=[],[],[]
    for row in references['areas']:
        if row['supervision']!='interior': continue
        shape=wkt.loads(row['geometry_wkt'])
        if shape.is_empty or not shape.is_valid: raise ValueError('Invalid allowed source functional reference')
        left,top,right,bottom=shape.bounds
        spans=[(right-left)*scale,(bottom-top)*scale]
        areas.append(shape.area*scale*scale);short.append(min(spans));long.append(max(spans))
    return np.asarray(areas),np.asarray(short),np.asarray(long)


def selected_records(data,kind,original_ids):
    """Selection before any asset resolution; refuses unexpected split/source."""
    if kind=='context_development':
        rows=[r for r in data['records'] if r['split']=='validation']
        if len(rows)!=20 or {r['id'] for r in rows}!=set(original_ids) or any(r['source']!='synthetic-msd' for r in rows):
            raise ValueError('Only the exact original20 development cases are allowed')
    else:
        split='train' if kind=='swiss_train' else 'validation'
        rows=[r for r in data['records'] if r['split']==split]
        if len(rows)!=(80 if split=='train' else 20) or data.get('all_space_scoring_eligible') is not False:
            raise ValueError('Only the fixed Swiss80/20 head-only corpus is allowed')
        if any(r['source']!='swiss-dwellings-real-geometry' or r['render_stats']['all_space_scoring_eligible'] is not False for r in rows):
            raise ValueError('Swiss derived components are not certified room ground truth')
    return rows


def runtime():
    return {'python':sys.version.split()[0],**{p:version(p) for p in ('numpy','Pillow','scipy','scikit-image','shapely')}}


def run(output):
    initial={str(CONTEXT):CONTEXT_SHA,str(SWISS):SWISS_SHA,str(ORIGINAL_BINDING):BINDING_SHA,
             str(Path(__file__).resolve()):digest(__file__)}
    verify(initial)
    context=json.loads(CONTEXT.read_text());swiss=json.loads(SWISS.read_text())
    original=json.loads(ORIGINAL_BINDING.read_text())
    ids=[r['id'] for r in original['cases']]
    plans=[('context_development',CONTEXT,context),('swiss_train',SWISS,swiss),('swiss_development',SWISS,swiss)]
    # Resolve only these selected records. Prior/protected manifests/asset paths
    # in provenance metadata are never recursively traversed or opened.
    selected={name:selected_records(data,name,ids) for name,path,data in plans}
    frozen=dict(initial)
    for name,path,_ in plans:
        for row in selected[name]:
            for key in ('image','targets')+ (('references',) if name!='context_development' else ()):
                p=asset(path.parent,row[key],row[key+'_sha256']);frozen[str(p)]=row[key+'_sha256']
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    shutil.copyfile(__file__,output/'scale_domain.py')
    versions=runtime();started=time.monotonic();reports={}
    metric_keys=('barrier_diameter','barrier_diameter_overview','opening_major','opening_minor','opening_area',
                 'opening_major_overview','region_area','region_short','region_long','source_area','source_short','source_long')
    for name,path,_ in plans:
        collected={k:[] for k in metric_keys};pages=[]
        for row in selected[name]:
            image_path=asset(path.parent,row['image'],row['image_sha256'])
            target_path=asset(path.parent,row['targets'],row['targets_sha256'])
            with Image.open(image_path) as im: image=np.asarray(im.convert('RGB')).copy()
            with np.load(target_path,allow_pickle=False) as z:
                target,known=z['target'].copy(),z['known'].copy()
                labels=z['truth'].copy() if name=='context_development' else None
            verify({str(image_path):row['image_sha256'],str(target_path):row['targets_sha256']})
            if target.shape!=known.shape or target.shape!=(3,*image.shape[:2]) or not np.isin(target,(0,1)).all() or not np.isin(known,(0,1)).all():
                raise ValueError('Invalid allowed target/known dimensions')
            h,w=image.shape[:2];mp=h*w/1e6;ratio=OVERVIEW/max(h,w)
            opening=(target[2]>0)&(known[2]>0)
            barrier=(target[1]>0)&(known[1]>0)&~opening
            interior=(target[0]>0)&(known[0]>0)
            if labels is None: labels,_=ndimage.label(interior,STRUCTURE)
            widths=barrier_diameters(barrier)
            major,minor,door_area=opening_spans(opening)
            area,short,long=region_scales(labels)
            source_area,source_short,source_long=np.asarray([]),np.asarray([]),np.asarray([])
            if name!='context_development':
                refs_path=asset(path.parent,row['references'],row['references_sha256'])
                refs=json.loads(refs_path.read_text())
                source_area,source_short,source_long=reference_scales(refs,row['render_stats']['pixels_per_source_meter'])
            pools=dict(barrier_diameter=widths,barrier_diameter_overview=widths*ratio,
                       opening_major=major,opening_minor=minor,opening_area=door_area,opening_major_overview=major*ratio,
                       region_area=area,region_short=short,region_long=long,source_area=source_area,source_short=source_short,source_long=source_long)
            for key,values in pools.items(): collected[key].append(values)
            luma=image.astype(np.float32)@np.asarray([.2126,.7152,.0722],np.float32)
            ink=luma<245
            chromatic=np.ptp(image.astype(np.int16),axis=2)>20
            negatives=np.all(known>0,axis=0)&~np.any(target>0,axis=0)
            ys,xs=np.where(interior)
            bbox=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None
            native_bbox=[(bbox[2]-bbox[0])/w,(bbox[3]-bbox[1])/h] if bbox else None
            page={'id':row['id'],'width':w,'height':h,'megapixels':mp,'overview_ratio':ratio,
                  'overview_axis_scales':[OVERVIEW/w,OVERVIEW/h],
                  'region_kind':'procedural-reference-instances' if name=='context_development' else 'derived-interior-components-not-room-GT',
                  'region_count':len(area),'regions_per_megapixel':len(area)/mp,'interior_page_fraction':float(interior.mean()),
                  'interior_bbox_normalized':None if bbox is None else [bbox[0]/w,bbox[1]/h,bbox[2]/w,bbox[3]/h],
                  'interior_bbox_width_height_fraction':native_bbox,
                  'target_barrier_page_fraction':float(((target[1]>0)&(known[1]>0)).mean()),
                  'target_opening_page_fraction':float(opening.mean()),'ink_page_fraction':float(ink.mean()),
                  'chromatic_page_fraction':float(chromatic.mean()),'nonstructural_inside_ink_pixels_per_megapixel':float(np.count_nonzero(ink&interior)/mp),
                  'known_all_heads_negative_ink_pixels_per_megapixel':float(np.count_nonzero(ink&negatives)/mp),
                  'visible_ink_in_barrier_fraction':float(ink[barrier].mean()) if barrier.any() else None,
                  'region_bbox_short_less_than_tile_fraction':float((short<TILE).mean()) if len(short) else None,
                  'opening_components':len(major),'opening_components_area_under9':int(np.count_nonzero(door_area<9)),
                  'source_indoor_functional_areas':len(source_area),'scale':{k:quantiles(v) for k,v in pools.items()}}
            if name!='context_development':
                stats=row['render_stats'];page['wall_style']=stats['wall_ink_style'];page['pixels_per_source_meter']=stats['pixels_per_source_meter']
                page['source_door_entities']=sum(stats['entity_counts'].get('opening:'+s,0) for s in ('DOOR','ENTRANCE_DOOR'))
            pages.append(page)
        pooled={key:quantiles(np.concatenate(values)) for key,values in collected.items()}
        scalar=('width','height','megapixels','overview_ratio','region_count','regions_per_megapixel','interior_page_fraction',
                'target_barrier_page_fraction','target_opening_page_fraction','ink_page_fraction','chromatic_page_fraction',
                'nonstructural_inside_ink_pixels_per_megapixel','known_all_heads_negative_ink_pixels_per_megapixel',
                'visible_ink_in_barrier_fraction','region_bbox_short_less_than_tile_fraction','opening_components','source_indoor_functional_areas')
        reports[name]={'cases':pages,'pooled_distributions':pooled,
                       'page_distributions':{k:quantiles([p[k] for p in pages if p[k] is not None]) for k in scalar}}
        print(json.dumps({'dataset':name,'cases':len(pages),'wall_seconds':time.monotonic()-started}),flush=True)
    verify(frozen)
    if runtime()!=versions: raise ValueError('Diagnostic runtime changed')
    report={'contract':'read-only-scale-domain-diagnostic-v1','datasets':reports,'source_asset_bindings':frozen,'runtime':versions,
            'wall_seconds':time.monotonic()-started,'inference_runs':0,'training_runs':0,'all_space_scoring_eligible':False,
            'limitations':'Descriptive target/render scales, not detector performance. Swiss source functional references/derived components are not independently certified physical rooms. Boundary includes window/column footprints; opening components may fragment/merge original door entities. EDT and PCA are raster proxies. *_overview distributions use the minimum axis projection 512/max(width,height), not actual warped/morphologically widened coarse targets. Actual overviews resize anisotropically to512square; page overview_axis_scales records both axes. A511 is not quantitatively labelled or scored.'}
    with (output/'report.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    with (output/'completed.json').open('x') as f:json.dump({'report_sha256':digest(output/'report.json'),'source_sha256':digest(output/'scale_domain.py')},f,indent=2)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();os.umask(0o077);run(args.output)
