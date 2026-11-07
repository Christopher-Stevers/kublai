"""One bounded comparison with unmodified MIT roomgraph; never a production call."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from page_binding import sha

BASE = Path('/home/tim/datasets/foremanhq-room-detection')
REFERENCE = BASE/'roomgraph-reference-772f095'
COMMIT = '772f0954a33d7930c5a9c5e3a48335831cc06ba7'
PDF = Path('/home/tim/.openclaw/workspace/kublai/uploads/job-floor-plans/0391aed4-7773-47ec-9141-09df373ec008/8a769e9c-18aa-4436-9f9f-637bf1cb58b6/plan.pdf')
PDF_SHA = '17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f'
OUTPUT = BASE/'stream-vector/roomgraph-a511-page18-20261001'


def write(path, data):
    with path.open('x') as f:
        json.dump(data, f, indent=2, allow_nan=False)
        f.write('\n')


def run():
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REFERENCE, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=REFERENCE, text=True)
    if head != COMMIT or dirty or sha(PDF) != PDF_SHA:
        raise ValueError('Reference/source identity mismatch')
    files = subprocess.check_output(['git', 'ls-files'], cwd=REFERENCE, text=True).splitlines()
    command = [sys.executable, '-m', 'roomgraph.cli', 'extract', str(PDF), '--page', '17',
               '--scale', '1:125', '--formats', 'json,svg', '--out', str(OUTPUT/'result'), '--quiet']
    plan = {'version': 'roomgraph-reference-probe-v1', 'reference_commit': COMMIT, 'reference_license': 'MIT',
            'source_sha256': PDF_SHA, 'pdf_page_number': 18, 'pdf_page_index': 17,
            'scale': '1:125 (printed floor-plan title)', 'command': command,
            'seconds_limit': 60, 'rss_bytes_limit': 2*1024**3,
            'source_sha256s': {f: sha(REFERENCE/f) for f in files},
            'wrapper_sha256': sha(__file__), 'room_accuracy_measured': False,
            'approved_for_production': False}
    write(OUTPUT.with_name(OUTPUT.name+'.claim.json'), plan)
    OUTPUT.mkdir()
    write(OUTPUT/'plan.json', plan)
    started, peak, error = time.monotonic(), 0, None
    with (OUTPUT/'process.log').open('xb') as log:
        child = subprocess.Popen(command, cwd=REFERENCE, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while child.poll() is None:
                try:
                    for line in Path(f'/proc/{child.pid}/status').read_text().splitlines():
                        if line.startswith(('VmRSS:', 'VmHWM:')):
                            peak = max(peak, int(line.split()[1])*1024)
                except FileNotFoundError:
                    pass
                if time.monotonic()-started > 60:
                    error = 'wall-clock budget exceeded'
                elif peak > 2*1024**3:
                    error = 'resident-memory budget exceeded'
                elif (OUTPUT/'process.log').stat().st_size > 8*1024**2:
                    error = 'diagnostic-log budget exceeded'
                if error:
                    os.killpg(child.pid, signal.SIGKILL)
                    break
                time.sleep(.025)
            child.wait(timeout=5)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
    if sha(PDF) != PDF_SHA or any(sha(REFERENCE/f) != s for f, s in plan['source_sha256s'].items()):
        error = 'source changed during trial'
    report = {'exit_code': child.returncode, 'error': error, 'seconds': time.monotonic()-started,
              'peak_rss_bytes': peak, 'successful_execution': child.returncode == 0 and error is None,
              'plan_sha256': sha(OUTPUT/'plan.json'), 'log_sha256': sha(OUTPUT/'process.log'),
              'artifacts': {str(p.relative_to(OUTPUT)): sha(p) for p in sorted(OUTPUT.rglob('*')) if p.is_file()},
              'room_accuracy_measured': False, 'approved_for_production': False}
    write(OUTPUT/('completed.json' if report['successful_execution'] else 'failure.json'), report)
    return report


if __name__ == '__main__':
    print(json.dumps(run(), indent=2))
