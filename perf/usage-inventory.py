"""Read only structured timing lines; do not retain journal content, IDs or arguments."""
import collections
import datetime
import json
import pathlib
import re
import subprocess

process = subprocess.Popen(["journalctl", "--user", "-u", "foremenhq", "--since", "-7 days", "--no-pager", "-o", "cat"], stdout=subprocess.PIPE, text=True)
rows = collections.defaultdict(list)
for line in process.stdout:
    match = re.search(r"\[TRPC\]\s+([A-Za-z0-9_.]+)\s+took\s+([0-9.]+)\s*ms", line)
    if match:
        rows[match[1]].append(float(match[2]))
if process.wait():
    raise RuntimeError("Journal read failed")
result = []
for name, values in sorted(rows.items(), key=lambda row: len(row[1]), reverse=True):
    router, method = name.split(".", 1)
    source = pathlib.Path("src/server/api/routers") / (router + ".ts")
    kind = "unknown"
    if source.exists():
        text = source.read_text()
        match = re.search(r"\b" + re.escape(method) + r"\s*:\s*", text)
        if match:
            operation = re.search(r"\.(mutation|query|subscription)\s*\(", text[match.end():])
            if operation:
                kind = operation[1]
    values.sort()
    percentile = lambda q: values[min(len(values) - 1, max(0, __import__('math').ceil(len(values) * q) - 1))]
    result.append({"procedure": name, "kind": kind, "observedCount": len(values), "p50Ms": percentile(.5), "p95Ms": percentile(.95)})
report = {"capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "source": "journalctl --user -u foremenhq --since=-7days; structured TRPC durations only", "limitations": "Observed instrumented journal counts, not complete usage analytics. May include testing. Server procedure duration is not phone paint latency. Unknown source kinds remain unknown.", "totalObserved": sum(map(len, rows.values())), "topProcedures": result[:20], "topMutations": [row for row in result if row["kind"] == "mutation"][:20], "allProcedures": result}
pathlib.Path("perf/observed-trpc-usage.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({key: value for key, value in report.items() if key != 'allProcedures'}))
