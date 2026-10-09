import { describe,it,expect } from 'vitest';
import { snapshotRect } from './snapshot-capture';
describe('snapshot selection',()=>{
  it('handles dragging in any direction and clamps to the visible view',()=>{
    expect(snapshotRect({x:180,y:160},{x:30,y:20},200,180)).toEqual({x:30,y:20,width:150,height:140});
    expect(snapshotRect({x:-30,y:-20},{x:240,y:230},200,180)).toEqual({x:0,y:0,width:200,height:180});
  });
});
