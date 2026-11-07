import {createCanvas}from'@napi-rs/canvas';
import {describe,it,expect}from'vitest';
import {detectAllSpaces}from'./hybrid/all-spaces';
import {pointInPolygon,roomLabelPoint,toPolygon}from'~/lib/room-shape';
function image(rotated=false){
 const width=420,height=360,canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.translate(width/2,height/2);if(rotated)ctx.rotate(Math.PI/9);
 ctx.strokeStyle='black';ctx.lineWidth=4;ctx.strokeRect(-140,-100,280,200);ctx.beginPath();ctx.moveTo(0,-100);ctx.lineTo(0,100);ctx.stroke();
 return{rgba:ctx.getImageData(0,0,width,height).data,width,height};
}
describe('all-space geometry regression',()=>{
 it('keeps blank pages empty',()=>expect(detectAllSpaces(new Uint8ClampedArray(120*120*4).fill(255),120,120,[]).rooms).toHaveLength(0));
 it('keeps rotated unlabeled rooms separate',()=>{
  const input=image(true),result=detectAllSpaces(input.rgba,input.width,input.height,[]);
  expect(result.rooms).toHaveLength(2);
  for(const room of result.rooms)expect(room.detection.requiresReview).toBe(true);
  expect(result.rooms.filter(r=>pointInPolygon({x:.65,y:.55},r.shape))).toHaveLength(1);
 });
 it('preserves large enclosed unlabeled halls',()=>{
  const input=image();const result=detectAllSpaces(input.rgba,input.width,input.height,[]);
  expect(result.rooms).toHaveLength(2);expect(result.rooms.every(r=>r.detection.areaFraction>.1)).toBe(true);
 });
 it('places the label in a ring corridor instead of the room in its hole',()=>{
  const shape=toPolygon({type:'polygon',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],holes:[[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}]]});
  expect(pointInPolygon(roomLabelPoint(shape),shape)).toBe(true);
 });
});
