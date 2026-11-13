import { expect, it } from 'vitest';
import { drawingFolderSummary } from './drawing-folder-summary';
it('includes direct drawings and every nested folder, without counting siblings', () => {
  expect(drawingFolderSummary([
    {id:'root',sheetCount:2}, {id:'child',parentId:'root',sheetCount:3},
    {id:'deep',parentId:'child',sheetCount:4,coverImageUrl:'/drawing.png'},
    {id:'other',sheetCount:99},
  ],'root')).toEqual({count:9,coverImageUrl:'/drawing.png',hasSubfolders:true});
});
it('keeps the folder cover and counts cyclic cached entries only once', () => {
  expect(drawingFolderSummary([{id:'a',parentId:'b',sheetCount:2,coverImageUrl:'/a'}, {id:'b',parentId:'a',sheetCount:3}], 'a')).toEqual({count:5,coverImageUrl:'/a',hasSubfolders:true});
});
it('shows empty folders honestly', () => {
  expect(drawingFolderSummary([{id:'empty',sheetCount:0}], 'empty')).toEqual({count:0,coverImageUrl:null,hasSubfolders:false});
});
