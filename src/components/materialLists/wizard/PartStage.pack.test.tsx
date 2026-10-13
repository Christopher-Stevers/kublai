import {act,render,fireEvent,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {PartStage} from './PartStage';
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('holding the switch for one second changes units without releasing the pointer',()=>{
 vi.useFakeTimers();
 class TestPointerEvent extends MouseEvent {pointerId=1;pointerType='mouse';}
 vi.stubGlobal('PointerEvent',TestPointerEvent);
 const part={id:'clips',displayName:'Clip box',description:null,imageUrl:null,material:null,size:null,piecesPerPack:50};
 const select=vi.fn(), preview=vi.fn();
 render(<PartStage partsForSelection={[part]} pendingParts={[]} onPartSelect={vi.fn()} onPartQuantitySet={select} onQuantityPickerPreviewChange={preview} onEditPart={vi.fn()}/>);
 const card=screen.getByRole('button',{name:'Clip box'});
 Object.assign(card,{setPointerCapture:vi.fn(),hasPointerCapture:()=>false});
 fireEvent.pointerDown(card,{clientY:300,button:0});
 act(()=>vi.advanceTimersByTime(120));
 fireEvent.pointerMove(window,{clientY:102});
 expect(preview).toHaveBeenLastCalledWith({partId:'clips',partName:'Clip box',quantity:-1,mode:undefined});
 act(()=>vi.advanceTimersByTime(999));
 expect(preview).toHaveBeenLastCalledWith({partId:'clips',partName:'Clip box',quantity:-1,mode:undefined});
 expect(select).not.toHaveBeenCalled();
 act(()=>vi.advanceTimersByTime(1));
 expect(preview).toHaveBeenLastCalledWith({partId:'clips',partName:'Clip box',quantity:1,mode:'individual'});
 fireEvent.pointerMove(window,{clientY:264});
 fireEvent.pointerUp(window);
 expect(select).toHaveBeenCalledWith(part,.2);
});

it('releasing over the switch early does not change quantity',()=>{
 vi.useFakeTimers();
 class TestPointerEvent extends MouseEvent {pointerId=1;pointerType='mouse';}
 vi.stubGlobal('PointerEvent',TestPointerEvent);
 const part={id:'clips',displayName:'Clip box',description:null,imageUrl:null,material:null,size:null,piecesPerPack:50};
 const select=vi.fn(),preview=vi.fn();
 render(<PartStage partsForSelection={[part]} pendingParts={[]} onPartSelect={vi.fn()} onPartQuantitySet={select} onQuantityPickerPreviewChange={preview} onEditPart={vi.fn()}/>);
 const card=screen.getByRole('button',{name:'Clip box'});
 Object.assign(card,{setPointerCapture:vi.fn(),hasPointerCapture:()=>false});
 fireEvent.pointerDown(card,{clientY:300,button:0});
 act(()=>vi.advanceTimersByTime(120));
 fireEvent.pointerMove(window,{clientY:102});
 act(()=>vi.advanceTimersByTime(500));
 fireEvent.pointerUp(window);
 act(()=>vi.advanceTimersByTime(1000));
 expect(select).not.toHaveBeenCalled();
 expect(preview).toHaveBeenLastCalledWith(null);
});
