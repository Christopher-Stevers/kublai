/** Serialized browser function. Material-list only; no app code or writes.
 * One exact candidate query per coalesced mutation batch, never an all-control
 * visibility walk or continuous rAF. The two rAF checks are the declared endpoint.
 */
export function armMaterialInputReady({sourcePath,destinationPath,token,timeoutMs=60000},sourceTarget){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw Error('Invalid readiness timeout');
 if(typeof token!=='string'||!token||!sourcePath.startsWith('/jobs/')||!destinationPath.startsWith('/jobs/material-lists/'))throw Error('Invalid material readiness contract');
 const root=document.querySelector('main'),selector='button[aria-label="Increase quantity"]';
 if(!(sourceTarget instanceof Element)||!sourceTarget.isConnected||!root?.isConnected||!root.contains(sourceTarget)||location.pathname!==sourcePath)throw Error('Wrong source/target');
 if(root.querySelector(selector))throw Error('Destination control already mounted at source');
 if(window.__materialInputReadyV3?.pending)throw Error('Previous readiness latch still active');
 const armedAt=performance.now(),events=[],checks={candidateQueries:0,visibilityChecks:0,mutationBatches:0};
 let resolve;const promise=new Promise(r=>resolve=r);let phase='armed',settled=false,queued=false,startedAt=null,readyAt=null,firstRafAt=null,secondRafAt=null,candidate=null,watched=null,raf1=0,raf2=0,timer=0,pointerId=null,clicks=0;
 const visible=element=>{checks.visibilityChecks++;if(!element?.isConnected||!root.isConnected||!root.contains(element)||element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;const style=getComputedStyle(element);if(style.visibility!=='visible'||style.display==='none')return false;const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0;};
 const first=()=>{checks.candidateQueries++;return root.querySelector(selector);};
 const cleanup=()=>{observer.disconnect();resize.disconnect();clearTimeout(timer);cancelAnimationFrame(raf1);cancelAnimationFrame(raf2);for(const n of['pointerdown','pointerup','pointercancel','click'])document.removeEventListener(n,onInput,true);for(const n of['transitionend','animationend','load'])root.removeEventListener(n,schedule,true);window.removeEventListener('pagehide',onPageHide,true);};
 const finish=(ok,reason)=>{if(settled)return;settled=true;phase=ok?'complete':'failed';const endedAt=performance.now();cleanup();resolve({ok,reason:reason??null,token,sourcePath,destinationPath,armedAt,startedAt,readyAt,firstRafAt,secondRafAt,endedAt,timeOrigin:performance.timeOrigin,durationMs:ok?secondRafAt-startedAt:null,events:[...events],checks:{...checks},endpoint:'trusted pointerdown → exact destination/first exact visible control → two sampled rAF callbacks; not physical paint'});};
 const retry=()=>{cancelAnimationFrame(raf1);cancelAnimationFrame(raf2);raf1=raf2=0;readyAt=firstRafAt=secondRafAt=null;candidate=null;phase='waiting';schedule();};
 const stillReady=()=>location.pathname===destinationPath&&first()===candidate&&visible(candidate);
 const check=()=>{
  queued=false;if(settled||phase==='painting'||startedAt===null||clicks!==1)return;
  if(!root.isConnected){finish(false,'root-disconnected');return;}
  if(location.pathname!==destinationPath)return;
  const next=first();if(next!==watched){resize.disconnect();watched=next;if(next?.isConnected)resize.observe(next);}
  if(!visible(next))return;
  candidate=next;readyAt=performance.now();phase='painting';
  raf1=requestAnimationFrame(at=>{raf1=0;if(settled)return;if(!stillReady()){retry();return;}firstRafAt=at;raf2=requestAnimationFrame(at2=>{raf2=0;if(settled)return;if(!stillReady()){retry();return;}secondRafAt=at2;finish(true);});});
 };
 function schedule(){if(settled||queued||phase==='painting')return;queued=true;queueMicrotask(check);}
 function onInput(e){
  if(!e.isTrusted)return;
  const matches=e.target instanceof Node&&sourceTarget.contains(e.target);
  if(e.type==='pointerdown'){
   if(startedAt!==null||!matches||e.button!==0||e.isPrimary===false){finish(false,'unexpected-or-second-pointerdown');return;}
   if(location.pathname!==sourcePath||first()!==null||!sourceTarget.isConnected){finish(false,'source-changed-before-input');return;}
   startedAt=performance.now();pointerId=e.pointerId;phase='waiting';events.push({type:e.type,at:startedAt,eventTimeStamp:e.timeStamp,trusted:true});return;
  }
  if(startedAt===null){if(e.type==='click')finish(false,'click-without-pointerdown');return;}
  if(e.type==='pointercancel'){finish(false,'pointer-cancelled');return;}
  if(e.type==='pointerup'&&e.pointerId!==pointerId){finish(false,'pointer-identity-changed');return;}
  if(e.type==='click'){
   clicks++;if(clicks!==1||!matches){finish(false,'unexpected-or-second-click');return;}
   events.push({type:e.type,at:performance.now(),eventTimeStamp:e.timeStamp,trusted:true});schedule();
  }
 }
 function onPageHide(){finish(false,'page-hidden-or-unloaded');}
 const observer=new MutationObserver(()=>{checks.mutationBatches++;schedule();});
 const resize=new ResizeObserver(schedule);
 observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','aria-hidden','aria-label','style','class']});
 for(const n of['pointerdown','pointerup','pointercancel','click'])document.addEventListener(n,onInput,true);
 for(const n of['transitionend','animationend','load'])root.addEventListener(n,schedule,true);
 window.addEventListener('pagehide',onPageHide,true);
 timer=setTimeout(()=>finish(false,startedAt===null?'input-timeout':'readiness-timeout'),timeoutMs);
 window.__materialInputReadyV3={token,get pending(){return !settled;},wait:()=>promise,cancel:()=>finish(false,'cancelled')};
 return{token,armedAt,sourceNegative:true,timeoutMs};
}
