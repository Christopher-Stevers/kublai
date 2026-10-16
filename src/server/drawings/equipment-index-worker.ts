import { readFile, stat, writeFile, rename } from "node:fs/promises";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unzipSync, strFromU8 } from "fflate";
import { SERVER_PDF_RENDER_OPTIONS } from "../rooms/pdf-render-options";
import { pdfTitleBlockWord, type TitleBlockWord } from "~/lib/drawing-title-block";
const [file, output, format] = process.argv.slice(2);
if (!file || !output || !["pdf","office"].includes(format ?? "")) throw Error("Invalid index arguments");
if ((await stat(file)).size > 160*1024*1024) throw Error("File exceeds text-index size limit");
const bytes=await readFile(file);
const pages: Array<{page:number;words:TitleBlockWord[]}>=[];
let incomplete=false;
if(format==="pdf") {
 const task=getDocument({...SERVER_PDF_RENDER_OPTIONS,verbosity:VerbosityLevel.ERRORS,data:new Uint8Array(bytes)});
 try {
  const doc=await task.promise;
  for(let n=1;n<=Math.min(doc.numPages,2000);n++) {
   const page=await doc.getPage(n),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
   const words=content.items.flatMap(item=>"str"in item&&item.str.trim()?[pdfTitleBlockWord(item,viewport)]:[]);
   pages.push({page:n,words});page.cleanup();
  }
  incomplete=doc.numPages>2000;
 } finally {await task.destroy();}
} else {
 let size=0;
 const files=unzipSync(bytes,{filter:entry=>{
  if(!/^(?:word\/document|xl\/(?:sharedStrings|worksheets\/sheet\d+)|ppt\/slides\/slide\d+)\.xml$/.test(entry.name)) return false;
  size+=entry.originalSize;
  if(size>32*1024*1024) throw Error("Office text exceeds index size limit");
  return true;
 }});
 const text=Object.values(files).map(data=>strFromU8(data).replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")).join(" ");
 pages.push({page:1,words:[{text,left:0,top:0,right:1,bottom:1}]});
}
const json=JSON.stringify({pages,incomplete});
if(json.length>48*1024*1024)throw Error("Text index exceeds size limit");
const temporary=`${output}.${process.pid}.tmp`;
await writeFile(temporary,json,{mode:0o600});await rename(temporary,output);
