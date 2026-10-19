import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({assign:vi.fn(),allowed:true,online:true}));
vi.mock('~/hooks/use-online-status',()=>({useOnlineStatus:()=>state.online}));
vi.mock('~/trpc/react',()=>({api:{useUtils:()=>({supplierPriceBooks:{invalidate:vi.fn()},jobPricing:{invalidate:vi.fn()},materialList:{previewOrders:{invalidate:vi.fn()}}}),supplierPriceBooks:{
 assignments:{useQuery:()=>({data:{supplier:{name:'Next'},books:[{id:'alma-book',name:'Alma'},{id:'contract-book',name:'Contract'}],jobs:[{id:'alma',name:'Alma Phase 2',bookId:'alma-book'},{id:'other',name:'Other Job',bookId:null}],canAssign:state.allowed}})},
 assign:{useMutation:()=>({mutateAsync:state.assign,isPending:false})}
}}}));
import {SupplierJobPricingDialog} from './SupplierJobPricingDialog';
afterEach(()=>{cleanup();vi.clearAllMocks();state.allowed=true;state.online=true;});
it('shows all jobs with their current book and saves only the changed job',async()=>{
 state.assign.mockResolvedValue({saved:true});
 render(<SupplierJobPricingDialog supplierId="next" onClose={()=>{}}/>);
 expect(screen.getByLabelText('Price book for Alma Phase 2')).toHaveValue('alma-book');
 expect(screen.getByLabelText('Price book for Other Job')).toHaveValue('');
 expect(screen.getByRole('button',{name:'Save pricing for Alma Phase 2'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Price book for Other Job'),{target:{value:'contract-book'}});
 expect(state.assign).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save pricing for Other Job'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Other Job now uses Contract pricing.'));
 expect(state.assign).toHaveBeenCalledExactlyOnceWith({supplierId:'next',jobId:'other',bookId:'contract-book'});
});
it('supports returning a job to Standard pricing',async()=>{
 state.assign.mockResolvedValue({saved:true});
 render(<SupplierJobPricingDialog supplierId="next" onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Price book for Alma Phase 2'),{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'Save pricing for Alma Phase 2'}));
 await waitFor(()=>expect(state.assign).toHaveBeenCalledWith({supplierId:'next',jobId:'alma',bookId:null}));
});
it('keeps assignment controls read-only without permission',()=>{
 state.allowed=false;
 render(<SupplierJobPricingDialog supplierId="next" onClose={()=>{}}/>);
 expect(screen.getByLabelText('Price book for Alma Phase 2')).toBeDisabled();
 expect(screen.getByRole('button',{name:'Save pricing for Other Job'})).toBeDisabled();
});
