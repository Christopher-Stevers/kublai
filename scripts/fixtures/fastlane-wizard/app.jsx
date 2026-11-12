import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogueVisibilityProvider} from '~/components/catalogue/CatalogueVisibility';
import {WizardOptionCard} from '~/components/materialLists/wizard/WizardOptionGrid';
function App(){
  const [step,setStep]=useState(0),[hides,setHides]=useState(0),[unrelated,setUnrelated]=useState(0),[removed,setRemoved]=useState(false);
  window.wizardFixture={
    state:()=>({step,hides,unrelated}),
    remove:()=>setRemoved(true),
    syntheticLift:()=>{const card=document.querySelector('[data-tutorial-choice]'),r=card.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])card.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,isPrimary:true,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));},
  };
  return <><CatalogueVisibilityProvider value={{scope:{catalogId:'synthetic'},rules:[],enabled:true,hide:()=>setHides(n=>n+1)}}>
    {!removed&&<WizardOptionCard key={step} tutorialChoice={String(step)} hideCriteria={{size:{nominal:2,unit:'in'}}} onClick={()=>setStep(n=>n+1)}>Step {step}</WizardOptionCard>}
  </CatalogueVisibilityProvider><button id="unrelated" onClick={()=>setUnrelated(n=>n+1)}>Unrelated action</button><output id="state">{JSON.stringify({step,hides,unrelated})}</output></>;
}
createRoot(document.getElementById('root')).render(<App/>);
