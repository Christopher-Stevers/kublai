#!/usr/bin/env python3
"""Analyze existing images for reversible display framing; never rewrite source pixels.
Usage: python audit-part-image-layouts.py inventory.json public-root output-directory
Requires Pillow and numpy. Only uniform empty margins qualify for trimming.
"""
import hashlib,json,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
inventory=json.loads(Path(sys.argv[1]).read_text());root=Path(sys.argv[2]);out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
report=[];layouts={}
for r in inventory:
    url=r['url'];row=dict(r)
    if not url: row['decision']='missing-image';report.append(row);continue
    if url.startswith('/api/catalogue/images/'):p=root/'images/catalog/uploads'/url.rsplit('/',1)[-1]
    else:p=root/url.lstrip('/')
    try:
        raw=p.read_bytes();im=ImageOps.exif_transpose(Image.open(p)).convert('RGBA');w,h=im.size
        # Full resolution analysis keeps small details and faint border pixels.
        a=np.array(im);rgb=a[:,:,:3].astype(np.int16);alpha=a[:,:,3];border=max(1,min(w,h)//50)
        corners=np.concatenate([rgb[:border,:border].reshape(-1,3),rgb[:border,-border:].reshape(-1,3),rgb[-border:,:border].reshape(-1,3),rgb[-border:,-border:].reshape(-1,3)])
        bg=np.median(corners,axis=0).astype(int);cornerSpread=float(np.percentile(np.max(abs(corners-bg),axis=1),99))
        edges=np.concatenate([rgb[0],rgb[-1],rgb[:,0],rgb[:,-1]])
        uniform=float(np.mean(np.max(abs(edges-bg),axis=1)<=10))
        transparent=float(np.mean(alpha<250))>.01
        flat=cornerSpread<=8 and uniform>=.96
        bounds=[0,0,w,h];decision='keep-review-background';color=None
        if transparent:
            foreground=alpha>0;color='#ffffff';decision='extend-transparent-background'
        elif flat:
            # Low threshold conservatively preserves pale edges and shadows.
            foreground=np.max(abs(rgb-bg),axis=2)>8;color='#'+''.join(f'{v:02x}' for v in bg);decision='extend-matched-background'
        else:
            foreground=None
            # Manufacturer shots often reach the border. Extend a verified
            # near-white background without trimming any source content.
            whites=corners[np.min(corners,axis=1)>=240]
            if len(whites)>=len(corners)*.75:
                bg=np.median(whites,axis=0).astype(int)
                color='#'+''.join(f'{v:02x}' for v in bg)
                decision='extend-only-source-edge'
                row['review']='subject-or-shadow-at-source-edge'
        if foreground is not None:
            ys,xs=np.where(foreground)
            if len(xs):
                left,right,top,bottom=int(xs.min()),int(xs.max())+1,int(ys.min()),int(ys.max())+1
                guard=max(2,round(max(w,h)*.015));x0=max(0,left-guard);y0=max(0,top-guard);x1=min(w,right+guard);y1=min(h,bottom+guard)
                removed=1-(x1-x0)*(y1-y0)/(w*h)
                edgeTouch=left==0 or top==0 or right==w or bottom==h
                if removed>.12 and (x1-x0)>4 and (y1-y0)>4:
                    bounds=[x0,y0,x1-x0,y1-y0];decision='trim-empty-margin'
                if edgeTouch:row['review']='subject-or-shadow-at-source-edge'
                row['removedArea']=round(removed,3)
            else:decision='keep-review-empty';color=None
        layout={'width':w,'height':h,'box':bounds,'background':color}
        if color is not None:layouts[url]=layout
        row.update(decision=decision,layout=layout,cornerSpread=round(cornerSpread,1),uniformEdgeFraction=round(uniform,3),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),path=str(p))
    except Exception as e:row.update(decision='unreadable',error=str(e))
    report.append(row)
from collections import Counter
summary={'parts':sum(r['parts'] for r in report),'images':len(report)-sum(not r['url'] for r in report),'decisions':dict(Counter(r['decision'] for r in report)),'sourceEdgeReviews':sum('review' in r for r in report),'bytes':sum(r.get('bytes',0) for r in report)}
(out/'report.json').write_text(json.dumps({'summary':summary,'images':report},indent=2)+'\n')
(out/'layouts.json').write_text(json.dumps(layouts,separators=(',',':'))+'\n')
print(json.dumps(summary,indent=2))
