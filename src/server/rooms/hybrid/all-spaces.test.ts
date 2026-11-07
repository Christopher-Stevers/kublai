import { describe, it, expect } from 'vitest';
import { detectAllSpaces } from './all-spaces';
import { pointInPolygon } from '~/lib/room-shape';
function drawing() {
  const w=200,h=160,rgba=new Uint8ClampedArray(w*h*4).fill(255);
  const line=(x0:number,y0:number,x1:number,y1:number)=>{
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const i=(y*w+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;
    }
  };
  line(20,20,180,22);line(20,138,180,140);line(20,20,22,140);line(178,20,180,140);
  line(98,20,100,140);
  return { w,h,rgba };
}
describe('space discovery independent of labels',()=>{
 it('finds both enclosed rooms with no labels',()=>{
  const {rgba,w,h}=drawing();const result=detectAllSpaces(rgba,w,h,[]);
  expect(result.rooms).toHaveLength(2);expect(result.unlabeledCount).toBe(2);
 });
 it('keeps an unlabeled neighbour rather than annexing it to a named room',()=>{
  const {rgba,w,h}=drawing();const result=detectAllSpaces(rgba,w,h,[{x:.3,y:.5,name:'Office'}]);
  expect(result.rooms).toHaveLength(2);
  const office=result.rooms.find(r=>r.name==='Office')!;
  expect(pointInPolygon({x:.7,y:.5},office.shape)).toBe(false);
 });
});
