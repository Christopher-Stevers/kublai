"""Build a five-reader report from immutable outputs. Never changes predictions or receipts."""
import argparse
import collections
import datetime as dt
import hashlib
import html
import json
import statistics
from pathlib import Path

READERS=["ocr","jev","terra","astra","liquid"]
LABELS={"ocr":"OCR only","jev":"Jev Image","terra":"Terra 6.1 Low","astra":"Astra Max","liquid":"Liquid LFM3 direct"}


def read(p):return json.loads(p.read_text())
def key(v):return "".join(c for c in str(v or "").lower() if c.isalnum())
def unit(v):
    u=key(v)
    return {"each":"ea","piece":"ea","pieces":"ea","pcs":"ea","foot":"ft","feet":"ft"}.get(u,u)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def token_count(v):return f'{v:,}' if v is not None else 'not available'
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    p.write_text(v);p.chmod(0o600)


def main():
    ap=argparse.ArgumentParser();ap.add_argument("--base",type=Path,required=True)
    ap.add_argument("--liquid",type=Path,required=True);ap.add_argument("--output",type=Path,required=True)
    ap.add_argument("--evaluation",type=Path)
    args=ap.parse_args();base=args.base;out=args.output
    publication=read(base/"publication.json");published=Path(publication["dest"])
    index=read(published/"index.json");costs=read(base/"reader-cost-comparison.json")
    cases=[];by_reader={r:[] for r in READERS};hashes={};labels={}
    if args.evaluation:
        for row in args.evaluation.read_text().splitlines():
            r=json.loads(row);labels[r["source"]["caseId"]]=r
    for c in index["cases"]:
        record={"source":c,"predictions":{}}
        for r in READERS:
            p=(args.liquid/"results" if r=="liquid" else published/"results"/r)/(c["caseId"]+".json")
            if not p.exists():continue
            d=read(p)
            if d["sourceSha256"]!=c["sha256"] or d["caseId"]!=c["caseId"] or d["reader"]!=r:raise ValueError("Reader source mismatch")
            record["predictions"][r]=d;by_reader[r].append(d);hashes[f"{r}/{c['caseId']}"]=sha(p)
        verified=labels.get(c["caseId"],{})
        record["humanLabels"]=verified.get("humanLabels",[])
        record["split"]=verified.get("split","not-loaded")
        record["group"]=verified.get("group")
        cases.append(record)
    summary={}
    for r,results in by_reader.items():
        good=[d for d in results if d["status"]=="complete"];lines=[l for d in good for l in d["lines"]]
        durations=[d["durationMs"]/1000 for d in good if d.get("durationMs") is not None]
        summary[r]={"completed":len(good),"failed":len(results)-len(good),"pending":len(cases)-len(results),
            "detectedLines":len(lines),"noRows":sum(not d["lines"] for d in good),
            "unreadShipped":sum(l["shipped"] is None for l in lines),"unknownUnit":sum(not l["unit"] for l in lines),
            "parentOrders":sum(bool(d.get("orderId")) for d in good),"matchedLines":sum(bool(l["orderItemId"]) for l in lines),
            "medianSeconds":round(statistics.median(durations),2) if durations else None,
            "inputTokens":sum(d.get("usage",{}).get("inputTokens",0) for d in results) if any('inputTokens' in d.get('usage',{}) for d in results) else None,
            "outputTokens":sum(d.get("usage",{}).get("outputTokens",0) for d in results) if any('outputTokens' in d.get('usage',{}) for d in results) else None,
            "tokenUsageScope":"Recorded result calls only; use the separate cost audit for historical reader totals and retry overhead.",
            "confidenceBins":{field:[sum(lo<=l["confidence"][field]["value"]<hi for l in lines)
                for lo,hi in [(0,.5),(.5,.8),(.8,.95),(.95,1.000000001)]] for field in ["part","quantity","match","overall"]}}
    comparison={};conflicts=[];order_conflicts=[];coverage=[]
    for other in READERS[:-1]:
        counts=collections.Counter()
        for c in cases:
            a=c["predictions"].get("liquid");b=c["predictions"].get(other)
            if not a or not b or a["status"]!="complete" or b["status"]!="complete":continue
            counts["comparableDocuments"]+=1
            if a.get("orderId") and b.get("orderId"):
                counts["bothProposedOrder"]+=1;counts["sameProposedOrder"]+=a["orderId"]==b["orderId"]
                if a["orderId"]!=b["orderId"]:
                    order_conflicts.append({"caseId":c["source"]["caseId"],"other":other,
                        "liquidOrderId":a["orderId"],"otherOrderId":b["orderId"],
                        "liquidConfidence":a.get("orderConfidence"),"otherConfidence":b.get("orderConfidence")})
            if other=="astra" and len(a["lines"])!=len(b["lines"]):
                coverage.append({"caseId":c["source"]["caseId"],"liquidLines":len(a["lines"]),
                    "astraLines":len(b["lines"]),"meaning":"Row-count difference; inspect coverage, duplicate rows and table boundaries. Neither reader is ground truth."})
            ga=collections.defaultdict(list);gb=collections.defaultdict(list)
            for l in a["lines"]:
                if len(key(l.get("sku")))>=3:ga[(l["page"],key(l["sku"]))].append(l)
            for l in b["lines"]:
                if len(key(l.get("sku")))>=3:gb[(l["page"],key(l["sku"]))].append(l)
            for k,aa in ga.items():
                bb=gb.get(k,[])
                if len(aa)!=1 or len(bb)!=1:continue
                x,y=aa[0],bb[0];counts["uniqueSamePageSkuPairs"]+=1
                if x["shipped"] is None or y["shipped"] is None:counts["quantityAbstention"]+=1;continue
                if not unit(x["unit"]) or unit(x["unit"])!=unit(y["unit"]):counts["unitNotComparable"]+=1;continue
                counts["sameUnitNumericPairs"]+=1
                same=abs(x["shipped"]-y["shipped"])<1e-6;counts["equalQuantity"]+=same
                if not same:
                    high=min(x["confidence"]["quantity"]["value"],y["confidence"]["quantity"]["value"])>=.9
                    counts["highConfidenceDisagreements"]+=high
                    conflicts.append({"caseId":c["source"]["caseId"],"page":x["page"],"sku":x["sku"],"other":other,
                        "liquidLineId":x["lineId"],"otherLineId":y["lineId"],"liquidQuantity":x["shipped"],
                        "otherQuantity":y["shipped"],"unit":unit(x["unit"]),"bothAtLeast90":high})
        comparison[other]=dict(counts)
    telemetry=[];energy=0;gaps=0
    for p in args.liquid.glob("gpu-*.jsonl"):
        samples=[json.loads(s) for s in p.read_text().splitlines() if s.strip()]
        telemetry+=samples
        for a,b in zip(samples,samples[1:]):
            delta=b["at"]-a["at"]
            if 0<=delta<=5:energy+=delta*(a["gpuWatts"]+b["gpuWatts"])/2/3600000
            else:gaps+=1
    sessions=[read(p) for p in sorted(args.liquid.glob("session-*.json"))]
    latest=sessions[-1] if sessions else {}
    runtime_errors=[read(p) for p in sorted((args.liquid/'runtime-errors').glob('*.json'))]
    schema_diagnostics=collections.Counter()
    required_fields=['sku','description','ordered','shipped','backordered','unit','price','handwritten_quantity',
        'evidence','box','part_confidence','quantity_confidence','unit_confidence','uncertainty','issues']
    for p in (args.liquid/'calls').glob('*/page-*.json'):
        if '.request.' in p.name:continue
        call=read(p);data=call.get('parsed',{})
        if call.get('error'):schema_diagnostics['failedPageResponses']+=1;continue
        schema_diagnostics['parsedPages']+=1
        if data.get('kind') not in ['delivery','return','credit','other','unclear']:
            schema_diagnostics['outOfSchemaDocumentKind']+=1
        for row in data.get('lines',[]):
            if not isinstance(row,dict):schema_diagnostics['nonObjectRows']+=1;continue
            schema_diagnostics['rawRows']+=1
            for k in required_fields:
                if k not in row:schema_diagnostics['missing_'+k]+=1
            if 'unit_code' in row and 'unit' not in row:schema_diagnostics['unitCodeAliasInsteadOfUnit']+=1
            if 'unit_price' in row and 'price' not in row:schema_diagnostics['unitPriceAliasInsteadOfPrice']+=1
            box=row.get('box')
            if isinstance(box,list) and any(type(v) in (float,int) and v>1 for v in box):
                schema_diagnostics['boxOutsideFractionalCoordinates']+=1
    liquid_cost={"externalModelApiUsd":0,"sampledGpuBoardKwh":round(energy,6),"sampleGaps":gaps,
        "peakWholeGpuMemoryMiB":max((x["gpuMemoryMiB"] for x in telemetry),default=None),
        "peakProcessGpuAllocatedBytes":max((r.get("usage",{}).get("peakGpuAllocatedBytes",0) for r in by_reader["liquid"]),default=0),
        "totalComputeCostUsd":None,"failedRuntimeAttempts":len(runtime_errors),
        "note":"GPU board power includes desktop/other GPU use. CPU, system power, hardware, labour and tariff are not measured. Zero API fee is not zero total cost. Failed runtime attempts may have uncounted tokens; setup pilots are excluded."}
    verified_count=sum(len(c["humanLabels"]) for c in cases)
    report={"schemaVersion":1,"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"runId":index["runId"],
        "cases":len(cases),"pages":sum(c["source"]["pages"] for c in cases),"summary":summary,"liquidVersus":comparison,
        "quantityDisagreements":conflicts,"orderDisagreements":order_conflicts,"coverageDisagreementsWithAstra":coverage,
        "historicalCostAudit":costs,"liquidCost":liquid_cost,"liquidRuntime":latest,"liquidSessions":sessions,
        "liquidSchemaDiagnostics":dict(schema_diagnostics),
        "humanLabelCount":verified_count if args.evaluation else None,"predictionHashes":hashes,
        "caveat":"Completeness and model agreement are not accuracy. Human verification, grouped holdouts and reviewed row alignment are required."}
    write(out/"five-reader-comparison.json",json.dumps(report,ensure_ascii=False,indent=2))
    write(out/"five-reader-learning.jsonl","".join(json.dumps(c,ensure_ascii=False)+"\n" for c in cases))
    priority=[]
    for c in cases:
        liquid=c['predictions'].get('liquid')
        if not liquid:continue
        qs=[x for x in conflicts if x['caseId']==c['source']['caseId']]
        os=[x for x in order_conflicts if x['caseId']==c['source']['caseId']]
        high=sum(x['bothAtLeast90'] for x in qs)
        unknown=sum(not x['unit'] for x in liquid['lines'])
        malformed=sum(any('reference' in issue for issue in x['issues']) for x in liquid['lines'])
        rowdiff=any(x['caseId']==c['source']['caseId'] for x in coverage)
        priority.append({'caseId':c['source']['caseId'],'documentId':c['source']['documentId'],
            'sourceSha256':c['source']['sha256'],'split':c['split'],'group':c['group'],
            'priorityScore':10*(liquid['status']=='failed')+5*high+3*len(os)+2*rowdiff+bool(unknown)+bool(malformed),
            'quantityDisagreements':qs,'orderDisagreements':os,'rowCountDiffersFromAstra':rowdiff,
            'unknownUnits':unknown,'linesWithInvalidReferences':malformed,
            'meaning':'Deterministic review priority, not error probability or a verified answer.'})
    priority.sort(key=lambda x:(-x['priorityScore'],x['caseId']))
    write(out/'five-reader-review-priority.jsonl',''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in priority))
    lines=["ForemanHQ packing-slip comparison: five readers",report["generatedAt"],"",
        f"Same frozen Alma Phase #2 set: {len(cases)} PDFs / {report['pages']} pages.",
        "Fifth reader: LiquidAI/LFM3-VL-2B, pinned revision "+latest.get("revision","unknown")+".",
        "Liquid uses direct mode (thinking disabled), local BF16 GPU inference, independent source images and frozen job orders.",
        "No OCR text, Jev answers, Terra/Astra predictions, previous approvals or source filenames were supplied to Liquid.",
        "The earlier four readers were not rerun. Their original results and audited cost estimates are retained.","",
        "Reader | Complete | Failed/pending | Detected lines | Unread shipped | Unknown unit | Parent orders | Item matches"]
    for r in READERS:
        s=summary[r];lines.append(f"{LABELS[r]} | {s['completed']} | {s['failed']}/{s['pending']} | {s['detectedLines']} | {s['unreadShipped']} | {s['unknownUnit']} | {s['parentOrders']} | {s['matchedLines']}")
    lines += ["","These are output-completeness and proposal counts, not measured accuracy. Missing values can be correct abstentions; populated values can be wrong.",
        f"Human-verified labels loaded: {verified_count if args.evaluation else 'not refreshed yet'}.","",
        "Usage / cost (USD)",
        "OCR: $0 external model API; local compute unmeasured.",
        "Jev: $3.48778836 known API-equivalent usage, a lower bound; 267 calls have unknown usage.",
        "Terra 6.1 Low: $14.74248660 hypothetical API equivalent using logged cache hits.",
        "Astra Max: $66.34738800 hypothetical API equivalent using logged cache hits.",
        f"Liquid: $0 external model API. {token_count(summary['liquid']['inputTokens'])} input tokens / {token_count(summary['liquid']['outputTokens'])} output tokens.",
        f"Liquid sampled whole-GPU energy: {energy:.4f} kWh; peak board memory: {liquid_cost['peakWholeGpuMemoryMiB']} MiB.",
        "Local electricity cost = sampled kWh times the applicable electricity tariff, plus unmeasured system power. Hardware and maintenance also matter.",
        "Provider token accounting differs. Prior Terra/Astra totals include agent/tool conversations and follow-up audits, not an optimized one-call production pipeline.",
        f"Liquid median amortized processing seconds per completed PDF: {summary['liquid']['medianSeconds']}. Batched time is shared equally, not single-request latency.","",
        f"Runtime failures/retries recorded: {len(runtime_errors)}. Their GPU energy is included where sampled; failed-attempt token counts can be unknown. Setup pilots are separate and excluded.",
        "Strict quantity agreement with Liquid: unique same-page SKU, both numeric, same known unit only"]
    for r,c in comparison.items():
        n=c.get("sameUnitNumericPairs",0);eq=c.get("equalQuantity",0)
        lines.append(f"{LABELS[r]}: {eq}/{n} equal quantities; {c.get('highConfidenceDisagreements',0)} disagreements with both confidence scores >= 90%. Aligned SKU pairs: {c.get('uniqueSamePageSkuPairs',0)}; excluded for unknown/different units: {c.get('unitNotComparable',0)}; excluded for unread quantities: {c.get('quantityAbstention',0)}." )
    lines += ["These restricted agreements are not accuracy; omitted, duplicated, unmatched and unread rows are excluded from the pair denominator and remain separate review work.","",
        "Learning and next decisions",
        "1. Keep source transcription, candidate retrieval, order choice, item matching and normalization separate when assigning errors.",
        "2. Verify row coverage first. A model can omit a product while confidently reading the rows it found.",
        "3. Review disagreements and high-confidence failures, then also review a random sample of agreements. Agreement is not a label.",
        "4. Calibrate part, quantity, unit and order-match confidence separately against human labels; preserve supplier/revision/duplicate groups in held-out data.",
        "5. Any later Terra reference should receive only frozen sources and candidate orders. Keep Liquid and other predictions hidden from that reader.",
        "6. Evaluate cost per correctly reviewed line and Terra calls avoided. This direct-mode run does not establish the performance of thinking mode or a fine-tuned Liquid model.",
        "7. This trial makes no receiving, return, credit or approval writes. Production OCR -> Jev -> conditional Terra routing is unchanged.","",
        "Method: Liquid reads each page independently, with official image preprocessing. Deterministic retrieval scores every frozen job order and supplies full item details for the top eight, plus all order headers. Missing shortlist candidates can cause matching failures. Invalid/repeated item references are withheld and flagged; unread quantities and units are never supplied from the order.",
        "The setup pilots are retained separately and excluded from the fifth-reader aggregate. On case-001, the thinking pilot took about 242 seconds; the direct pilot about 50 seconds. This is a timing observation on one PDF, not a quality comparison.",
        "Learning bundle: five-reader-learning.jsonl. It retains every prediction and per-line confidence, source/version/hash, split/group and human labels separately. Machine-generated labels must not be promoted to verified truth.","",
        "Review priorities: five-reader-review-priority.jsonl ranks cases with quantity conflicts, different parent orders, row-count differences, unknown units and invalid item references. It includes case/source identifiers and held-out status. A conflict is a reason to inspect the PDF, not proof that Liquid or another reader is wrong.",
        f"Liquid/Astra row counts differ on {len(coverage)} completed PDFs. This is a coverage warning, not a count of missed rows.",
        f"Structured-output diagnostic: {schema_diagnostics['missing_unit']}/{schema_diagnostics['rawRows']} raw rows omitted the requested unit key; {schema_diagnostics['unitCodeAliasInsteadOfUnit']} used unit_code instead. {schema_diagnostics['unitPriceAliasInsteadOfPrice']} used unit_price instead of price. {schema_diagnostics['outOfSchemaDocumentKind']} pages returned a document-kind value outside the requested enum; {schema_diagnostics['boxOutsideFractionalCoordinates']} row boxes were outside 0..1. These are interface/schema failures, not direct measurements of visual recognition accuracy.",
        "Next Liquid experiment: constrain the exact JSON schema and test explicit unit/quantity crops. Preserve this baseline and compare the new adapter on the same development groups before a held-out evaluation. Do not silently turn omitted fields or out-of-range coordinates into confident readings.",
        "Official model source: https://huggingface.co/LiquidAI/LFM3-VL-2B/tree/"+latest.get('revision','unknown'),"",
        "Historical four-reader report and detailed API assumptions follow unchanged.","="*72,"",(base/"trial-report.txt").read_text()]
    report_text="\n".join(lines)
    write(out/"five-reader-report.txt",report_text)
    rows="".join("<tr><th>"+html.escape(LABELS[r])+"</th>"+"".join(f"<td>{summary[r][k]:,}</td>" for k in ["completed","failed","pending","detectedLines","unreadShipped","unknownUnit","parentOrders","matchedLines"])+"</tr>" for r in READERS)
    cost_rows=[("OCR","$0 model API","Local compute unmeasured"),("Jev","$3.49 known","Lower bound; unknown calls excluded"),("Terra 6.1 Low","$14.74 equivalent","Codex usage repriced as API; logged cache hits"),("Astra Max","$66.35 equivalent","Codex usage repriced as API; logged cache hits"),("Liquid LFM3 direct","$0 model API",f"{energy:.4f} kWh sampled GPU energy; total compute cost unpriced")]
    costs_html="".join("<tr>"+"".join("<td>"+html.escape(x)+"</td>" for x in row)+"</tr>" for row in cost_rows)
    priority_html='';seen_groups=set()
    for p in priority:
        if p['priorityScore']==0 or len(seen_groups)>=12:break
        group=p.get('group') or p['caseId']
        if group in seen_groups:continue
        seen_groups.add(group)
        reasons=[]
        if p['quantityDisagreements']:reasons.append(f"{len(p['quantityDisagreements'])} quantity comparisons differ")
        if p['orderDisagreements']:reasons.append(f"{len(p['orderDisagreements'])} order proposals differ")
        if p['rowCountDiffersFromAstra']:reasons.append('row count differs from Astra')
        if p['unknownUnits']:reasons.append(f"{p['unknownUnits']} units unresolved")
        if p['linesWithInvalidReferences']:reasons.append(f"{p['linesWithInvalidReferences']} invalid item references")
        url=f"https://foremanhq.stellarator.work/jobs/{index['jobId']}/receiving?document={p['documentId']}"
        priority_html+='<li><a target="_blank" rel="noreferrer" href="'+html.escape(url)+'">'+html.escape(p['caseId'])+'</a> — '+html.escape('; '.join(reasons) or 'Reading failed')+'</li>'
    data=json.dumps(cases,ensure_ascii=False,separators=(",",":")).replace("<","\\u003c")
    template='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForemanHQ | Five-reader packing-slip trial</title>
<style>:root{font-family:system-ui,sans-serif;color:#18212a;background:#f2f4f6}body{max-width:1300px;margin:auto;padding:32px 20px}h1{font-size:clamp(28px,4vw,44px);line-height:1.15;margin-bottom:12px}h2{margin-top:36px}p{line-height:1.6;max-width:95ch}.eyebrow{letter-spacing:.12em;text-transform:uppercase;color:#456177;font-size:12px}.note{border-left:4px solid #bc7c19;padding:12px 20px;background:#fff8e9}table{border-collapse:collapse;background:white;width:100%;font-size:14px}th,td{padding:12px;text-align:left;border-bottom:1px solid #dce2e6;vertical-align:top}th{font-weight:600}thead{background:#e5ebef}.scroll{overflow:auto;border:1px solid #dce2e6;border-radius:8px}input{padding:12px;font-size:16px;max-width:480px;width:90%;border:1px solid #abb7c0;border-radius:6px}details{margin:12px 0;border:1px solid #d6dee4;border-radius:6px;background:white;padding:15px}summary{cursor:pointer;font-weight:600}.readers{display:grid;grid-template-columns:repeat(5,minmax(240px,1fr));gap:16px;overflow:auto;margin-top:15px}.reader{font-size:13px}.part{padding:12px 0;border-top:1px solid #dce2e6}.muted{color:#5c6973}a{color:#165b92}pre{white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace;padding:15px;background:white}small{line-height:1.5;display:block}.flag{color:#9a4f08}button{padding:10px 16px;cursor:pointer}footer{margin-top:40px;border-top:1px solid #ccd5dc;padding-top:20px}</style>
<p class="eyebrow">ForemanHQ / Alma Phase #2 / Independent detection trial</p><h1>Five ways to read the same packing slips</h1><p>240 PDFs · 348 supplied pages · OCR, Jev, Terra, Astra and a local Liquid model. The fifth reader uses <strong>LFM3-VL-2B in direct mode</strong>. Original predictions and human decisions remain separate.</p>
<p class="note"><strong>These results are not an accuracy score.</strong> Completeness, confidence and agreement help prioritize review. Human-verified answers are needed before choosing production thresholds or training a model.</p>
<h2>Detection completeness</h2><div class="scroll"><table><thead><tr><th>Reader</th><th>Complete PDFs</th><th>Failed</th><th>Pending</th><th>Lines</th><th>Unread quantity</th><th>Unknown unit</th><th>Order proposals</th><th>Item matches</th></tr></thead><tbody>__ROWS__</tbody></table></div>
<h2>Cost and compute</h2><div class="scroll"><table><thead><tr><th>Reader</th><th>Recorded/estimated cost</th><th>Meaning</th></tr></thead><tbody>__COSTS__</tbody></table></div><p class="muted">Prior API equivalents include their original trial overhead. Liquid's local hardware, CPU power, electricity tariff and maintenance are not priced. These are not directly comparable optimized production costs.</p>
<h2>Review priorities</h2><p>These cases have unresolved differences or missing fields. Each link opens the normal receiving review. One example per known duplicate group is shown; this is a review queue, not an answer key.</p><ol>__PRIORITIES__</ol><h2>Inspect each slip</h2><p>Expand a case to see all five original readings, each line's confidence and evidence. The source links require your normal FormanHQ access.</p><input id="search" type="search" placeholder="Find a case or document…" aria-label="Find a case or document"><div id="cases"></div>
<h2>Full report and limitations</h2><details><summary>Read methodology, comparisons, learning plan and original cost audit</summary><pre>__TEXT__</pre></details><footer><small>Generated __DATE__. Private job data. No receipts are approved by this report.</small></footer>
<script type="application/json" id="data">__DATA__</script><script>
const records=JSON.parse(document.getElementById('data').textContent),names={ocr:'OCR only',jev:'Jev Image',terra:'Terra 6.1 Low',astra:'Astra Max',liquid:'Liquid LFM3 direct'};
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){const term=document.getElementById('search').value.toLowerCase(),box=document.getElementById('cases');box.replaceChildren();for(const c of records){if(!(c.source.caseId+' '+c.source.name).toLowerCase().includes(term))continue;const d=document.createElement('details'),s=document.createElement('summary');s.textContent=c.source.caseId+' · '+c.source.name;d.append(s);d.addEventListener('toggle',()=>{if(!d.open||d.dataset.loaded)return;d.dataset.loaded='1';const content=document.createElement('div');content.innerHTML='<p><a target="_blank" rel="noreferrer" href="https://foremanhq.stellarator.work/api/job-documents/files/'+encodeURIComponent(c.source.versionId)+'?jobId=__JOB__">Open original PDF</a> · <a target="_blank" rel="noreferrer" href="https://foremanhq.stellarator.work/jobs/__JOB__/receiving?document='+encodeURIComponent(c.source.documentId)+'">Open receiving review</a> · '+esc(c.source.pages)+' pages · '+esc(c.split)+'</p><div class="readers">'+Object.keys(names).map(r=>{const p=c.predictions[r];return '<section class="reader"><h3>'+esc(names[r])+'</h3>'+(p?'<p>'+esc(p.status)+' · '+p.lines.length+' lines</p><p>'+esc(p.orderLabel||'Order unresolved')+'</p>'+p.lines.map(l=>'<div class="part"><b>Page '+l.page+' · '+esc(l.description||l.sku||'Unread product')+'</b><p>'+esc(l.shipped)+' '+esc(l.unit||'unit unknown')+' shipped</p><small>'+Object.entries(l.confidence).map(([k,v])=>esc(k)+': '+Math.round(v.value*100)+'%').join(' · ')+'</small><details><summary>Evidence and issues</summary><p>'+esc(l.evidence)+'</p><p class="flag">'+l.issues.map(esc).join('<br>')+'</p></details></div>').join('')+'<details><summary>Document warnings</summary><p>'+p.warnings.map(esc).join('<br>')+'</p></details>':'<p>Pending</p>')+'</section>'}).join('')+'</div>';d.append(content)});box.append(d)}}document.getElementById('search').addEventListener('input',render);render();
</script></html>'''
    doc=template.replace('__ROWS__',rows).replace('__COSTS__',costs_html).replace('__PRIORITIES__',priority_html).replace('__TEXT__',html.escape(report_text)).replace('__DATE__',html.escape(report['generatedAt'])).replace('__JOB__',index['jobId']).replace('__DATA__',data)
    write(out/"five-reader-report.html",doc)
    print(json.dumps({"report":str(out),"liquid":summary['liquid'],"humanLabels":report['humanLabelCount'],"conflicts":len(conflicts)}))


if __name__=="__main__":main()
