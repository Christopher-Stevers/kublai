import { expect, it } from "vitest";
import { compactDrawingWorkspace, omitDrawingHyperlinks, mergeDrawingWorkspaceSnapshot } from "./drawing-workspace-payload";
import { drawingMarkupSchema, type DrawingEntity, type DrawingWorkspace } from "./drawing-workspace";
it("omits destination payloads without changing source records, geometry, or manual links", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const data = drawingMarkupSchema.parse({sourceSheetId:id,type:"link",equipmentTag:"AHU-1",points:[{x:.1,y:.1},{x:.2,y:.2}], links:Array.from({length:50},(_,i)=>({label:`AHU-${i}`,url:`/jobs?view=${"x".repeat(1000)}${i}`}))});
  const entity: DrawingEntity = {id,sheetId:id,kind:"markup",visibility:"published",revision:2,authorId:"tim",authorName:"Tim",comments:[],createdAt:"",updatedAt:"",data};
  const original = {entities:[entity,{...entity,id:"manual",data:{...data,equipmentTag:undefined}}]} as DrawingWorkspace;
  const compact = compactDrawingWorkspace(original);
  const slim = compact.entities[0]!;
  expect(slim.kind).toBe("markup");
  if(slim.kind!=="markup") throw Error("fixture");
  expect(slim.data.links).toBeUndefined();
  expect(slim.data.deferredLinks).toEqual({id,revision:2,count:50});
  expect(slim.data.points).toEqual(data.points);
  expect(drawingMarkupSchema.safeParse(slim.data).success).toBe(true);
  expect(entity.data.links).toHaveLength(50);
  expect(compact.entities[1]).toBe(original.entities[1]);
  expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(entity).length / 20);
});

it("omits all hidden hyperlink records, leaving other annotations and a source count", () => {
  const link = {id:"link",sheetId:"sheet",kind:"markup", visibility:"published",data:{type:"link",sourceSheetId:"source",points:[{x:.1,y:.2}],href:"https://example.com"}} as DrawingEntity;
  const arrow = {...link,id:"arrow",data:{...link.data,type:"arrow"}} as DrawingEntity;
  const original = {entities:[link,arrow,{...link,id:"archived",visibility:"archived"}]} as DrawingWorkspace;
  const hidden = omitDrawingHyperlinks(original);
  expect(hidden.entities).toEqual([arrow]);
  expect(hidden.omittedHyperlinks).toEqual({source:1});
  expect(original.entities).toHaveLength(3);
});

it("preserves downloaded links when a hidden layer response is saved or shown offline", () => {
  const link = {id:"link",kind:"markup",data:{type:"link"}} as DrawingEntity;
  const saved = {sheetId:"sheet",actor:{id:"tim"},entities:[link]} as DrawingWorkspace;
  const hidden = {...saved, entities:[],omittedHyperlinks:{sheet:1}};
  expect(mergeDrawingWorkspaceSnapshot(hidden,saved).entities).toEqual([link]);
  expect(mergeDrawingWorkspaceSnapshot(hidden,{...saved,actor:{id:"other",name:"Other"}}).entities).toEqual([]);
  expect(mergeDrawingWorkspaceSnapshot({...saved,entities:[]},saved).entities).toEqual([]);
});
