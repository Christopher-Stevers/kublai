import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
const build='/home/tim/.openclaw/workspace/releases/speed-phase0-wizard-fastlane-20261112/.next-web';const proof='/home/tim/.openclaw/workspace/releases/speed-proof-20261110';const cwd='/home/tim/.openclaw/workspace/kublai';const port=3150;const require=createRequire(path.join(cwd,'package.json'));const nextRequire=createRequire(require.resolve('next/package.json'));process.env.NODE_ENV='production';nextRequire('@next/env').loadEnvConfig(path.join(build,'runtime'),false,{info(){},error(){}});
let child,stop=false,forced=false;const stopFile=path.join(proof,'phase0-wizard-auth-proof-STOP');const delay=ms=>new Promise(r=>setTimeout(r,ms));
const terminate=()=>{stop=true;if(child&&child.exitCode===null)try{process.kill(-child.pid,'SIGTERM');}catch{}};process.on('SIGTERM',terminate);process.on('SIGINT',terminate);const watchdog=setTimeout(terminate,45000);
try{
 const release=JSON.parse(await fs.readFile(path.join(build,'release-assets.json')));if(release.sourceHash!=='9aaeabbebd27c93155b7e4bc0c9535f9224942860b7e4ccd61d134403bc355b0'||release.sourceFingerprint!=='34f0c1508584e40382ad25955b3aa2b5703bdd78ced4e6ef2536e902fd82281d')throw Error('R20 binding mismatch');
 if(await fs.stat(stopFile).then(()=>true,()=>false))throw Error('Refusing previous stop marker');
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options',`${url.searchParams.get('options')??''} -c default_transaction_read_only=on`.trim());const databaseUrl=url.toString();const db=require('postgres')(databaseUrl,{max:1,connect_timeout:3});
 try{const result=await Promise.race([db.unsafe('show default_transaction_read_only'),delay(5000).then(()=>{throw Error('Read-only metadata timeout');})]);if(result[0]?.default_transaction_read_only!=='on')throw Error('Read-only mode unavailable');}finally{await db.end({timeout:1});}
 if(stop)throw Error('Stopped before startup');
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'localhost',()=>server.close(resolve));});
 const log=await fs.open(path.join(proof,'phase0-wizard-auth-wrapper.log'),'w');child=spawn(process.execPath,[path.join(build,'runtime/release/start.mjs')],{cwd,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,DATABASE_URL:databaseUrl,NEXT_DIST_DIR:build,HOSTNAME_BIND:'localhost',PORT:String(port),FOREMANHQ_BACKGROUND_MODE:'separate',BIM_WORKER_DISABLED:'1'}});await log.close();
 await fs.writeFile(path.join(proof,'phase0-wizard-auth-proof-server.json'),JSON.stringify({sourceBuild:release.sourceHash,sourceFingerprint:release.sourceFingerprint,pid:child.pid,port,backgroundMode:'separate',bimDisabled:true,databaseReadOnlyVerified:true,credentialsLogged:false,pinnedWrapper:true}));
 while(!stop&&child.exitCode===null){if(await fs.stat(stopFile).then(()=>true,()=>false))break;await delay(100);}
}catch{await fs.writeFile(path.join(proof,'phase0-wizard-auth-proof-supervisor-error.json'),JSON.stringify({failed:true,message:'Read-only proof preparation/start failed; no credentials logged'}));process.exitCode=1;}
finally{
 terminate();if(child&&child.exitCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),delay(5000)]);if(child.exitCode===null){forced=true;try{process.kill(-child.pid,'SIGKILL');}catch{}await Promise.race([new Promise(r=>child.once('exit',r)),delay(1000)]);}}
 clearTimeout(watchdog);await fs.writeFile(path.join(proof,'phase0-wizard-auth-proof-cleanup.json'),JSON.stringify({exitCode:child?.exitCode??null,ownServerStopped:!child||child.exitCode!==null,forced,appMutationsRequested:false,databaseReadOnlyConfigured:true}));
}
