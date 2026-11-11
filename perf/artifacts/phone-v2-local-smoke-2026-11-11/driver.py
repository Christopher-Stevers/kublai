import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

repo=Path('/home/tim/.openclaw/workspace/kublai')
config=json.loads(Path('/tmp/foremanhq-openjob-phase-r7-config.json').read_text())['candidate']
output=Path('/tmp/foremanhq-phone-v2-local-smoke-20261111.json')
if output.exists():
    raise RuntimeError('Refusing to overwrite previous smoke evidence')
port=49112
with socket.socket() as probe:
    probe.bind(('127.0.0.1', port))
profile=Path(tempfile.mkdtemp(prefix='foremanhq-phone-v2-smoke-'))
log=Path('/tmp/foremanhq-phone-v2-local-browser-20261111.log').open('w')
browser=None
try:
    browser=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-dev-shm-usage',f'--user-data-dir={profile}',f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1','about:blank'],stdout=log,stderr=log,start_new_session=True)
    for _ in range(80):
        if browser.poll() is not None:
            raise RuntimeError('Owned smoke browser stopped')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1) as response:
                if response.status==200:
                    break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Owned smoke browser metadata unavailable')
    env=dict(os.environ)
    env.pop('DATABASE_URL',None)
    env.update(PERF_PHONE_SMOKE='1',PERF_PHONE_CONTROL_TRANSPORT='local-smoke',PERF_PHONE_TARGET_CREATION='browser-create-target',PERF_PHONE_HOST_BASE=config['base'],PERF_PHONE_BASE=config['base'],PERF_PHONE_CDP=f'http://127.0.0.1:{port}/',PERF_PHONE_LAB_ROOT=str(Path(config['sourceEvidence']).parent),PERF_LAB_SOCKET=str(Path(config['databaseLog']).parent),PERF_BUILD=config['expectedLabBuild'],PERF_PHONE_OUTPUT=str(output),PERF_PHONE_RUNS='1')
    result=subprocess.run(['node','perf/phone/run.mjs'],cwd=repo,env=env,capture_output=True,text=True,timeout=150)
    Path('/tmp/foremanhq-phone-v2-local-driver-20261111.log').write_text(result.stdout+result.stderr)
    if output.exists():
        report=json.loads(output.read_text())
        print(json.dumps({'status':report.get('status'),'method':report.get('method'),'physicalPhoneEvidence':report.get('physicalPhoneEvidence'),'samples':len(report.get('samples',report.get('completedSamples',[]))),'phase':report.get('phase'),'cleanup':report.get('cleanup'),'exitCode':result.returncode}))
    else:
        raise RuntimeError('Smoke driver did not create evidence')
finally:
    if browser is not None and browser.poll() is None:
        os.killpg(browser.pid,signal.SIGTERM)
        try:
            browser.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(browser.pid,signal.SIGKILL)
            browser.wait(timeout=5)
    log.close()
    shutil.rmtree(profile)
