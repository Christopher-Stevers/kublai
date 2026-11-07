/** Runs before app/auth/sync code, including when only a cached shell is available. */
export const OFFLINE_TEST_BOOT_SCRIPT = `(function(){
  var key='foremanhq.offline-test';
  function enabled(){try{return localStorage.getItem(key)==='1'}catch(e){return false}}
  var simulated=enabled();
  try {var original=Object.getOwnPropertyDescriptor(Navigator.prototype,'onLine');
    Object.defineProperty(navigator,'onLine',{configurable:true,get:function(){return !enabled() && (original&&original.get?original.get.call(navigator):true)}});
  }catch(e){}
  window.addEventListener('storage',function(e){if(e.key===key && enabled()!==simulated)location.reload()});
  var worker=navigator.serviceWorker&&navigator.serviceWorker.controller;
  if(worker && typeof MessageChannel!=='undefined'){
    var stateChannel=new MessageChannel();var stateTimer=setTimeout(function(){stateChannel.port1.close()},5000);
    stateChannel.port1.onmessage=function(e){clearTimeout(stateTimer);stateChannel.port1.close();if(typeof e.data.enabled==='boolean' && e.data.enabled!==enabled()){try{localStorage.setItem(key,e.data.enabled?'1':'0');location.reload()}catch(error){}}};
    worker.postMessage({type:'FOREMANHQ_OFFLINE_TEST_GET'},[stateChannel.port2]);
  }
  if(!simulated)return;
  function recovery(){
    if(document.getElementById('offline-test-reconnect'))return;
    var b=document.createElement('button');b.id='offline-test-reconnect';b.type='button';
    b.textContent='Offline test · Reconnect';b.setAttribute('aria-label','Turn off offline test mode');
    b.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:100000;background:#92400e;color:white;border:1px solid #fbbf24;border-radius:999px;padding:8px 14px;font:600 13px system-ui;box-shadow:0 2px 8px #0005;cursor:pointer';
    b.onclick=function(){var w=navigator.serviceWorker&&navigator.serviceWorker.controller;if(!w){b.textContent='Offline support unavailable. Reload to retry.';return}
      b.disabled=true;b.textContent='Reconnecting…';var c=new MessageChannel();var t=setTimeout(function(){b.disabled=false;b.textContent='Retry reconnect';c.port1.close()},15000);
      c.port1.onmessage=function(e){clearTimeout(t);c.port1.close();if(!e.data.ok){b.disabled=false;b.textContent='Retry reconnect';return}localStorage.setItem(key,'0');location.reload()};
      w.postMessage({type:'FOREMANHQ_OFFLINE_TEST_SET',enabled:false},[c.port2]);
    };document.body.appendChild(b);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',recovery);else recovery();
})();`;
