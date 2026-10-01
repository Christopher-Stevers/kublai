"""Bounded offline PDF paint extraction. An original output can never be reused."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent
RUNTIME = Path('/home/tim/datasets/foremanhq-room-detection/pdfbox-runtime')
JDK = Path('/home/tim/.local/share/mise/installs/java/temurin-21.0.12+8.0.LTS')
JAR = RUNTIME / 'pdfbox-app-3.0.7.jar'
JAR_SHA = 'bf70b90aca964bda6f1438d7b87d6f99cfaa9912ba6fcebc0541d9d90ee5ef54'
LIMITS = {'seconds': 60, 'rss_bytes': 2 * 1024**3, 'log_bytes': 8 * 1024**2}


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def write_new(path, obj):
    with Path(path).open('x') as f:
        json.dump(obj, f, indent=2, allow_nan=False)
        f.write('\n')


def compile_java(directory):
    if sha(JAR) != JAR_SHA:
        raise ValueError('PDFBox artifact hash mismatch')
    directory.mkdir()
    subprocess.run([str(JDK / 'bin/javac'), '-cp', str(JAR), '-d', str(directory),
                    str(HERE / 'StreamInk.java')], check=True, timeout=30, capture_output=True)


def child_extract(pdf, page, output, classes, log, limits=LIMITS):
    """Watch the native process, including allocations outside its bounded heap."""
    start, peak, failure = time.monotonic(), 0, None
    with log.open('xb') as f:
        p = subprocess.Popen([str(JDK / 'bin/java'), '-Djava.awt.headless=true', '-Xmx1400m',
                              '-Xss512k', '-XX:MaxDirectMemorySize=128m', '-XX:MaxMetaspaceSize=128m',
                              '-XX:ActiveProcessorCount=4', '-cp', str(classes) + ':' + str(JAR),
                              'StreamInk', str(pdf), str(page), str(output)],
                             stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while p.poll() is None:
                try:
                    for line in Path(f'/proc/{p.pid}/status').read_text().splitlines():
                        if line.startswith(('VmRSS:', 'VmHWM:')):
                            peak = max(peak, int(line.split()[1]) * 1024)
                except FileNotFoundError:
                    pass
                if time.monotonic() - start > limits['seconds']:
                    failure = 'wall-clock budget exceeded'
                elif peak > limits['rss_bytes']:
                    failure = 'resident-memory budget exceeded'
                elif log.stat().st_size > limits['log_bytes']:
                    failure = 'diagnostic-log budget exceeded'
                if failure:
                    os.killpg(p.pid, signal.SIGKILL)
                    break
                time.sleep(.025)
            p.wait(timeout=5)
        finally:
            if p.poll() is None:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait(timeout=5)
    return {'exit_code': p.returncode, 'seconds': time.monotonic() - start,
            'peak_rss_bytes': peak, 'failure': failure,
            'log_sha256': sha(log), 'successful': not failure and p.returncode == 0}


def extract(pdf, page, output):
    pdf, output = Path(pdf).resolve(strict=True), Path(output).absolute()
    if page < 0 or not pdf.is_file() or pdf.stat().st_size > 128 * 1024**2:
        raise ValueError('Invalid source/page')
    # A spent sibling claim survives deletion or movement of the result directory.
    claim = output.with_name(output.name + '.claim.json')
    plan = {'version': 'stream-ink-trial-v1', 'source': str(pdf), 'source_sha256': sha(pdf),
            'page_index': page, 'output': str(output), 'limits': LIMITS,
            'java_sha256': sha(JDK / 'bin/java'), 'javac_sha256': sha(JDK / 'bin/javac'),
            'jdk_release_sha256': sha(JDK / 'release'), 'pdfbox_sha256': sha(JAR),
            'sources': {p.name: sha(p) for p in sorted(HERE.iterdir()) if p.suffix in {'.py', '.java'}},
            'production_promotion': False, 'room_accuracy_measured': False}
    if plan['pdfbox_sha256'] != JAR_SHA or output.exists():
        raise ValueError('Runtime mismatch or original result exists')
    write_new(claim, plan)
    output.mkdir()
    write_new(output / 'plan.json', plan)
    frozen = output / 'sources'
    frozen.mkdir()
    for name in plan['sources']:
        (frozen / name).write_bytes((HERE / name).read_bytes())
    try:
        compile_java(output / 'classes')
        result = child_extract(pdf, page, output / 'paint', output / 'classes', output / 'extract.log')
        if sha(pdf) != plan['source_sha256'] or any(sha(HERE / n) != s or sha(frozen / n) != s
                                                  for n, s in plan['sources'].items()):
            raise ValueError('Source changed during experiment')
        result['plan_sha256'] = sha(output / 'plan.json')
        if not result['successful']:
            write_new(output / 'failure.json', result)
            raise RuntimeError(f'Extraction failed; retained {output / "failure.json"}')
        from evidence import records
        counts = {}
        for record in records(output / 'paint'):
            counts[record[0]] = counts.get(record[0], 0) + 1
        result['verified_record_counts'] = counts
        result['summary_sha256'] = sha(output / 'paint/summary.json')
        result['class_sha256'] = {p.name: sha(p) for p in sorted((output / 'classes').glob('*.class'))}
        result['approved_for_production'] = False
        result['room_accuracy_measured'] = False
        write_new(output / 'completed.json', result)
        return result
    except Exception as e:
        if not (output / 'failure.json').exists():
            write_new(output / 'failure.json', {'successful': False, 'error': str(e)})
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--page', type=int, required=True, help='zero-based PDF index')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(extract(args.pdf, args.page, args.output), indent=2))
