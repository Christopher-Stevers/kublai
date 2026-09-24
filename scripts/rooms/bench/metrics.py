"""Instance-mask metrics. Zero is background; labels are arbitrary positive integers."""
import numpy as np
VERSION = 'instance-iou-v1'

def match_at(ious, threshold):
    edges = [sorted(np.flatnonzero(row >= threshold).tolist(), key=lambda j: -row[j]) for row in ious]
    matched = {}
    def augment(i, seen):
        for j in edges[i]:
            if j in seen: continue
            seen.add(j)
            if j not in matched or augment(matched[j], seen):
                matched[j] = i
                return True
        return False
    for i in range(len(edges)): augment(i, set())
    return matched

def score(truth, prediction):
    if truth.shape != prediction.shape: raise ValueError('Prediction dimensions differ from reference')
    if truth.ndim != 2 or prediction.dtype.kind not in 'ui' or truth.dtype.kind not in 'ui':
        raise ValueError('Expected two-dimensional unsigned/integer instance masks')
    if np.any(prediction < 0) or np.any(truth < 0): raise ValueError('Negative labels')
    tids, gt = np.unique(truth.ravel(), return_inverse=True)
    pids, pr = np.unique(prediction.ravel(), return_inverse=True)
    if len(tids) > 5000 or len(pids) > 5000: raise ValueError('Too many instances')
    table = np.bincount(gt * len(pids) + pr, minlength=len(tids)*len(pids)).reshape(len(tids),len(pids))
    garea = table.sum(axis=1)[tids != 0].astype(float)
    parea = table.sum(axis=0)[pids != 0].astype(float)
    intersection = table[np.ix_(tids != 0,pids != 0)].astype(float)
    union = garea[:,None] + parea[None,:] - intersection
    ious = np.divide(intersection,union,out=np.zeros_like(intersection),where=union>0)
    n,m = len(garea),len(parea)
    results = {'expected':n,'predicted':m}
    for threshold, suffix in [(.5,'50'),(.75,'75')]:
        matches = match_at(ious, threshold);tp=len(matches)
        precision=tp/m if m else (1. if not n else 0.);recall=tp/n if n else 1.
        results.update({f'tp{suffix}':tp,f'fp{suffix}':m-tp,f'fn{suffix}':n-tp,
                        f'precision{suffix}':precision,f'recall{suffix}':recall,
                        f'f1_{suffix}':2*tp/(n+m) if n+m else 1.})
        if suffix=='50':
            total = sum(float(ious[i,j]) for j,i in matches.items())
            results.update(matched_iou_sum=total,mean_iou_all_gt=total/n if n else 1.)
    coverage = np.divide(intersection,garea[:,None],out=np.zeros_like(intersection),where=garea[:,None]>0)
    results['merge_candidates'] = int(np.sum(np.sum(coverage>=.5,axis=0)>=2))
    results['split_candidates'] = int(np.sum((np.sum(coverage>=.15,axis=1)>=2)&(coverage.sum(axis=1)>=.5)))
    return results

def aggregate(cases):
    total={k:sum(c['metrics'][k] for c in cases) for k in ['expected','predicted','tp50','fp50','fn50','tp75','fp75','fn75','merge_candidates','split_candidates','matched_iou_sum']}
    for suffix in ['50','75']:
        tp=total['tp'+suffix];n=total['expected'];m=total['predicted']
        total['f1_'+suffix]=2*tp/(n+m) if n+m else 1.
        total['recall'+suffix]=tp/n if n else 1.
        total['precision'+suffix]=tp/m if m else (1. if not n else 0.)
    total['mean_iou_all_gt']=total['matched_iou_sum']/total['expected'] if total['expected'] else 1.
    total['failures']=sum(c['status']!='ok' for c in cases)
    total['cache_hits']=sum(c.get('cache_hit',False) for c in cases)
    times=[c['timing']['wall_ms'] for c in cases if c['status']=='ok']
    total['median_wall_ms']=float(np.median(times)) if times else None
    total['p95_wall_ms']=float(np.percentile(times,95)) if times else None
    return total
