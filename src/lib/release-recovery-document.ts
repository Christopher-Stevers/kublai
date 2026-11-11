/** Recovers initial script failures before React can install the quiet handler. */
export function releaseRecoveryBootScript(build: string | undefined) {
  if (!build || !/^[a-f0-9]{64}$/.test(build)) return "";
  return `(function(){var build=${JSON.stringify(build)};function recover(e){try{
    if(window.__foremenhqReleaseRecoveryReady||navigator.onLine===false||localStorage.getItem('foremanhq.offline-test')==='1')return;
    var active=document.activeElement;if(active&&/^(INPUT|TEXTAREA)$/.test(active.tagName)||active&&active.isContentEditable)return;
    var target=e.target,src=target&&(target.src||target.href)||e.filename||'',message=e.message||(e.reason&&e.reason.message)||'';
    if(src.indexOf(location.origin+'/_next/static/')!==0&&!/ChunkLoadError|Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module/.test(message))return;
    var leave=new Event('beforeunload',{cancelable:true});if(!window.dispatchEvent(leave)||leave.defaultPrevented)return;
    var key='foremenhq:release-reload:'+build;if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');location.reload();
  }catch(error){}}window.addEventListener('error',recover,true);window.addEventListener('unhandledrejection',recover);})();`;
}
