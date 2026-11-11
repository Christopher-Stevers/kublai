import os,pathlib,json,socket,subprocess,sys,signal,time
attempt=pathlib.Path(__file__).parent
state=json.loads((attempt/'prepared.json').read_text())
variant=next(v for v in state['variants'] if v['label']==sys.argv[1])
root=pathlib.Path(variant['root']).resolve(); private=state['privateSocket']
assert str(root).startswith('/tmp/foremanhq-speed-app-') and (root/'PERF_LAB_ONLY').exists()
assert (root/'.next/BUILD_ID').read_text().strip()==variant['build']
assert pathlib.Path(private,'.s.PGSQL.55463').exists()
port={'A':3491,'B':3492}[variant['label']]
with socket.socket() as s:s.bind(('127.0.0.1',port))
env={k:os.environ[k] for k in ['PATH','HOME','USER','LANG','TMPDIR','XDG_CACHE_HOME'] if k in os.environ}
url='postgresql://localhost/foremanhq_perf_lab?host='+private.replace('/','%2F')+'&port=55463'
env.update(RELEASE_BUILD_ID=variant['build'],NEXT_PUBLIC_BUILD_ID=variant['build'],FOREMANHQ_BACKGROUND_MODE='separate',BIM_WORKER_DISABLED='1',SKIP_ENV_VALIDATION='1',CLERK_SECRET_KEY='sk_test_speed_lab_only',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_test_speed_lab_only',STRIPE_SECRET_KEY='sk_test_speed_lab_only',NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY='pk_test_speed_lab_only',PERF_LAB_SOCKET=private,PERF_LAB_DATABASE_URL=url,DATABASE_URL=url,PERF_LOG_DIR=str(root/'data/functional-perf'),PERF_FIXTURES=str(root/'perf/fixtures.json'))
stop=False
def interrupt(*args):
 global stop
 stop=True
signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
with (attempt/('server-'+variant['label']+'.log')).open('wb') as log:
 child=subprocess.Popen(['node',str(root/'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 record={**variant,'pid':child.pid,'base':'http://127.0.0.1:'+str(port)+'/'}
 (attempt/('backend-'+variant['label']+'.json')).write_text(json.dumps(record,indent=2))
 deadline=time.monotonic()+900
 try:
  while not stop and time.monotonic()<deadline and child.poll() is None:time.sleep(.5)
 finally:
  if child.poll() is None:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
  (attempt/('backend-'+variant['label']+'-exit.json')).write_text(json.dumps({'pid':child.pid,'exitCode':child.returncode,'cleaned':True}))
