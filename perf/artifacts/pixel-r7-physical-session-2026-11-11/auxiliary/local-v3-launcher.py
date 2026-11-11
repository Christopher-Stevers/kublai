import json,os,shutil,signal,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
s=Path(Path('/tmp/foremanhq-phone-active-session').read_text());env=json.loads((s/'runner-env.json').read_text())
output=s/'local-v3-smoke.json'
assert not output.exists()
port=49112
with socket.socket() as probe:probe.bind(('127.0.0.1',port))
profile=Path(tempfile.mkdtemp(prefix='foremanhq-phone-v3-smoke-'));browser=None
with (s/'local-v3-browser.log').open('w') as log:
 try:
  browser=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-dev-shm-usage',f'--user-data-dir={profile}',f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1','about:blank'],stdout=log,stderr=log,start_new_session=True)
  for _ in range(80):
   assert browser.poll() is None
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version',timeout=1) as r:
     if r.status==200:break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('Owned smoke browser unavailable')
  env.update(PERF_PHONE_SMOKE='1',PERF_PHONE_CONTROL_TRANSPORT='local-smoke',PERF_PHONE_BASE=env['PERF_PHONE_HOST_BASE'],PERF_PHONE_CDP=f'http://127.0.0.1:{port}/',PERF_PHONE_OUTPUT=str(output),PERF_PHONE_RUNS='2')
  with (s/'local-v3-driver.log').open('w') as driverlog:
   result=subprocess.run(['node',str(s/'method-v3/run.mjs')],cwd=env['PERF_PHONE_LAB_ROOT'],env={**os.environ,**env},stdout=driverlog,stderr=subprocess.STDOUT,timeout=180)
  d=json.loads(output.read_text());print(json.dumps({'status':d.get('status'),'physicalPhoneEvidence':d.get('physicalPhoneEvidence'),'samples':len(d.get('samples',d.get('completedSamples',[]))),'phase':d.get('phase'),'error':d.get('error'),'cleanup':d.get('cleanup'),'exit':result.returncode}))
 finally:
  if browser is not None and browser.poll() is None:
   os.killpg(browser.pid,signal.SIGTERM)
   try:browser.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(browser.pid,signal.SIGKILL);browser.wait(timeout=5)
  shutil.rmtree(profile)
