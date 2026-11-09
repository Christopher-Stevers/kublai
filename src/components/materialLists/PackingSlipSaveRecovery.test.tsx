import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {PackingSlips} from './PackingSlips';
const push=vi.fn();
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('~/hooks/use-online-status',()=>({useOnlineStatus:()=>true}));
vi.mock('next/dynamic',()=>({default:()=>function Scanner({onSave}:{onSave:(file:File)=>Promise<boolean>}){return <button onClick={()=>void onSave(new File(['pdf'],'Packing slip.pdf'))}>Done</button>}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();push.mockReset();});
it('opens the saved receipt without waiting for a second document-list request',async()=>{
 let gets=0;
 const fetcher=vi.fn(async(_url:string,options?:RequestInit)=>{
  if(options?.method==='POST') return Response.json({documentId:'saved'});
  if(++gets===1)return Response.json({canUpload:true,documents:[]});
  return new Promise<Response>(()=>{ /* Simulate a stalled connection. */ });
 });
 vi.stubGlobal('fetch',fetcher);
 render(<PackingSlips jobId="job" materialListId="list" orderId="order"/>);
 fireEvent.click(screen.getByRole('button',{name:'Packing slips'}));
 fireEvent.click(await screen.findByRole('button',{name:'Done'}));
 await waitFor(()=>expect(push).toHaveBeenCalledWith('/jobs/job/receiving?document=saved&fromMaterialList=list'));
 expect(gets).toBe(1);
});
