import { expect, it } from "vitest";
import { drawingMoveTargets } from "./drawing-folder-move";
it("excludes the source, descendants and cycles while naming nested destinations", () => {
  const folders = [
    {id:"a",name:"Source"}, {id:"b",name:"Child",parentId:"a"}, {id:"c",name:"Grandchild",parentId:"b"},
    {id:"d",name:"Other"}, {id:"e",name:"Nested",parentId:"d"},
    {id:"x",name:"Cycle",parentId:"y"}, {id:"y",name:"Cycle",parentId:"x"},
  ];
  expect(drawingMoveTargets(folders,"a")).toEqual([{id:"d",path:"Other"},{id:"e",path:"Other / Nested"}]);
});
