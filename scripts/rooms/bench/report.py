"""Portable local HTML review pages; no server, analytics, CDN, or external assets."""
import html,json
from pathlib import Path

def esc(x):return html.escape(str(x))
STYLE='''body{font:15px system-ui;margin:28px;background:#eef1f5;color:#152232}a{color:#235ab2}table{border-collapse:collapse;width:100%;background:white}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}th{background:#dce3eb;position:sticky;top:0}summary{cursor:pointer;padding:12px}article{background:white;border:1px solid #cdd4dd;border-radius:8px;margin:14px 0;padding:12px}img{width:32%;max-height:420px;object-fit:contain}small{color:#56616f}.bad{color:#ad2020}code{overflow-wrap:anywhere}button,select{padding:8px}h1{margin-bottom:8px}'''

def run_report(run,folder):
    rows=[]
    for c in sorted(run['cases'],key=lambda x:(x['metrics']['f1_50'],x['metrics']['mean_iou_all_gt'],x['id'])):
        m=c['metrics'];base=c['id']
        visual=''.join(f'<a href="{base}/{f}.png"><img loading="lazy" src="{base}/{f}.png" alt="{esc(f)}"></a>' for f in ['input','truth','prediction']) if c.get('visuals') else ''
        rows.append(f'<article data-failure="{str(c["status"]!="ok" or m["f1_50"]<1).lower()}"><details><summary><b>{esc(base)}</b> — F1 {m["f1_50"]:.3f}; missed {m["fn50"]}; extra {m["fp50"]}; merges {m["merge_candidates"]}; splits {m["split_candidates"]}; {esc(c["status"])}</summary><p>Left: input. Middle: reference rooms. Right: predicted rooms. Cyan points are supplied labels. Instance colours are not matched identities.</p>{visual}<p class="bad">{esc(c.get("error",""))}</p><pre>{esc(json.dumps(c.get("diagnostics",{}),indent=2))}</pre></details></article>')
    s=run['summary'];body=f'<h1>{esc(run["config"]["name"])}</h1><p>Known-seed geometry benchmark · {esc(run["target"])} · {len(run["cases"])} cases · {run["width"]}px width · suite {esc(run["suite"])}</p><p><b>F1@0.50 {s["f1_50"]:.3f} · Recall {s["recall50"]:.3f} · F1@0.75 {s["f1_75"]:.3f} · Failures {s["failures"]}</b></p><p>Cached cases: {s["cache_hits"]}. Timings for cache hits are the original execution timings, not this run’s elapsed time. The adapter is a file-input adaptation of Opus’s raster primitives, not the production PDF detector.</p><p><a href="run.json">Complete results and provenance</a> · <a href="config.json">Configuration</a></p><label><input type="checkbox" onchange="document.querySelectorAll(\'article\').forEach(a=>a.hidden=this.checked&&a.dataset.failure===\'false\')"> Only imperfect or failed cases</label>'
    (folder/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Room benchmark</title><style>'+STYLE+'</style>'+body+''.join(rows))

def leaderboard(runs,root):
    groups={}
    for r in runs:groups.setdefault(r['comparison_key'],[]).append(r)
    sections=[]
    for key,group in sorted(groups.items(),key=lambda item:max(r['run_id'] for r in item[1]),reverse=True):
        # Incomplete/failed runs are displayed but cannot outrank successful runs.
        group.sort(key=lambda r:(r['summary']['failures']>0,-r['summary']['f1_50'],-r['summary']['mean_iou_all_gt'],r['summary']['median_wall_ms'] or float('inf')))
        baseline=group[0];srows=[]
        for i,r in enumerate(group):
            s=r['summary'];srows.append(f'<tr><td>{i+1 if not s["failures"] else "unranked"}</td><td><a href="{esc(r["run_id"])}/index.html">{esc(r["config"]["name"])}</a><br><small>{esc(r["run_id"])}</small></td><td>{s["f1_50"]:.3f}</td><td>{s["recall50"]:.3f}</td><td>{s["f1_75"]:.3f}</td><td>{s["mean_iou_all_gt"]:.3f}</td><td>{s["merge_candidates"]}/{s["split_candidates"]}</td><td>{s["failures"]}</td><td>{round(s["median_wall_ms"]) if s["median_wall_ms"] else "—"}</td><td>{s["cache_hits"]}</td></tr>')
        sections.append(f'<h2>{esc(baseline["suite"])} · {esc(baseline["target"])} · {len(baseline["cases"])} cases · {baseline["width"]}px</h2><p>Comparison group <code>{key[:16]}</code>. Only identical inputs, references, target, seed mode, resolution, scorer and timeout are grouped.</p><table><tr><th>Rank</th><th>Version / run</th><th>F1@.5</th><th>Recall</th><th>F1@.75</th><th>IoU/all GT</th><th>Merge/split flags</th><th>Failures</th><th>Median ms</th><th>Cached</th></tr>'+''.join(srows)+'</table>')
    links='<h2>Paired comparisons</h2><ul>'+''.join(f'<li><a href="{esc(p.name)}">{esc(p.stem)}</a></li>' for p in sorted(root.glob('compare-*.html')))+'</ul>'
    (root/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Room detection leaderboard</title><style>'+STYLE+'</style><h1>Room detection experiments</h1><p>Rank: successful runs first, then F1@0.5, IoU across all reference rooms, then runtime. Compare fresh repeats for performance claims. These scores use supplied label locations, not complete PDF/OCR detection. Default ResPlan inputs are generated layouts.</p>'+''.join(sections)+links)

def comparison(a,b,path):
    if a['comparison_key']!=b['comparison_key']:raise ValueError('Cannot compare different suites, inputs, targets, seed modes, resolutions, scorers or timeouts')
    aa={c['id']:c for c in a['cases']};rows=[]
    for c in b['cases']:
        before=aa[c['id']];delta=c['metrics']['f1_50']-before['metrics']['f1_50']
        rows.append({'id':c['id'],'f1_delta':delta,'before_f1':before['metrics']['f1_50'],'after_f1':c['metrics']['f1_50'],'before_status':before['status'],'after_status':c['status'],'f1_75_delta':c['metrics']['f1_75']-before['metrics']['f1_75'],'iou_delta':c['metrics']['mean_iou_all_gt']-before['metrics']['mean_iou_all_gt'],'before_iou':before['metrics']['mean_iou_all_gt'],'after_iou':c['metrics']['mean_iou_all_gt']})
    rows.sort(key=lambda r:(r['f1_delta'],r['iou_delta']));out={'baseline':a['run_id'],'candidate':b['run_id'],'regressions':sum(r['f1_delta']<-.000001 for r in rows),'improvements':sum(r['f1_delta']>.000001 for r in rows),'outline_regressions_over_1pp':sum(r['iou_delta']<-.01 for r in rows),'outline_improvements_over_1pp':sum(r['iou_delta']>.01 for r in rows),'cases':rows}
    path.write_text(json.dumps(out,indent=2))
    path.with_suffix('.html').write_text('<!doctype html><meta charset="utf-8"><title>Room regressions</title><style>'+STYLE+'</style><h1>Paired comparison</h1><p>'+esc(a['run_id'])+' → '+esc(b['run_id'])+f'</p><p>{out["improvements"]} improved, {out["regressions"]} regressed at IoU .50. Outline IoU: {out["outline_improvements_over_1pp"]} improved and {out["outline_regressions_over_1pp"]} regressed by more than one percentage point.</p><table><tr><th>Case</th><th>Before</th><th>After</th><th>Delta F1@.50</th><th>Delta F1@.75</th><th>Delta IoU/all rooms</th><th>Review</th></tr>'+''.join(f'<tr><td>{r["id"]}</td><td>{r["before_f1"]:.3f}</td><td>{r["after_f1"]:.3f}</td><td>{r["f1_delta"]:+.3f}</td><td>{r["f1_75_delta"]:+.3f}</td><td>{r["iou_delta"]:+.3f}</td><td><a href="{a["run_id"]}/{r["id"]}/prediction.png">before</a> · <a href="{b["run_id"]}/{r["id"]}/prediction.png">after</a></td></tr>' for r in rows)+'</table>')
    return out
