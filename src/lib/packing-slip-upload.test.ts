import {afterEach, expect, it, vi} from 'vitest';
import {uploadPackingSlip} from './packing-slip-upload';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('returns the saved document without retrying the POST',async()=>{
 const fetcher=vi.fn(async()=>Response.json({documentId:'saved'}));vi.stubGlobal('fetch',fetcher);
 expect(await uploadPackingSlip('/upload',new FormData())).toEqual({documentId:'saved'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('releases a hung request, aborts it, and warns about an uncertain save',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn(()=>new Promise<Response>(()=>{ /* Simulate a stalled connection. */ }));vi.stubGlobal('fetch',fetcher);
 const pending=expect(uploadPackingSlip('/upload',new FormData())).rejects.toThrow('Check saved packing slips before retrying');
 await vi.advanceTimersByTimeAsync(90_000);await pending;
 expect((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].signal?.aborted).toBe(true);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('also times out when headers arrive but the response body stalls',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:()=>new Promise(()=>{ /* Simulate a stalled connection. */ })})));
 const pending=expect(uploadPackingSlip('/upload',new FormData())).rejects.toThrow('Saving took too long');
 await vi.advanceTimersByTimeAsync(90_000);await pending;
});
it('preserves permission errors rather than treating a response as saved',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Permission required'},{status:403})));
 await expect(uploadPackingSlip('/upload',new FormData())).rejects.toThrow('Permission required');
});
