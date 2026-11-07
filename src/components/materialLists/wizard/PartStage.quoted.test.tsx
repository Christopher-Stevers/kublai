import {render,screen,cleanup,within} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {PartStage} from './PartStage';
afterEach(cleanup);
const part=(id:string,jobPriceStatus?:string)=>({id,displayName:id,description:null,imageUrl:null,material:null,size:null,jobPriceStatus});
it('tags priced parts as Quoted on the photo and shows nothing for the rest',()=>{
 render(<PartStage partsForSelection={[part('Estimated','estimated'),part('Confirmed','confirmed'),part('Needed','listed'),part('Unlisted','unlisted'),part('Plain')]} pendingParts={[]} onPartSelect={vi.fn()} onEditPart={vi.fn()}/>);
 const quoted=(name:string)=>within(screen.getByRole('heading',{name}).closest('[data-slot=card]')!).queryByText('Quoted');
 expect(quoted('Estimated')).toBeInTheDocument();
 expect(quoted('Confirmed')).toBeInTheDocument();
 expect(quoted('Needed')).toBeNull();
 expect(quoted('Unlisted')).toBeNull();
 expect(quoted('Plain')).toBeNull();
 expect(screen.queryByText(/On job list|Not on job price list/)).toBeNull();
});
