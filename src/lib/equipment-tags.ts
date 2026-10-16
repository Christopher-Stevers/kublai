import type { TitleBlockWord } from "./drawing-title-block";
import { makeSnapshotSource } from "./snapshot-source";
export const normalizeEquipmentTag = (tag: string) => tag.toUpperCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, "").trim().replace(/^([A-Z]+)(\d)/, "$1-$2");
export function tagPattern(tag: string) {
  const normalized = normalizeEquipmentTag(tag);
  if (!/^[A-Z][A-Z0-9./-]{1,39}$/.test(normalized) || !/\d/.test(normalized)) return null;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-\\s]*");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?![A-Z0-9]|[-.][A-Z0-9])`, "i");
}
export function containsEquipmentTag(text: string, tag: string) {
  return tagPattern(tag)?.test(text.replace(/[\u2010-\u2015\u2212]/g, "-")) ?? false;
}
function textLines(words: TitleBlockWord[]) {
  const lines: TitleBlockWord[] = [];
  for (const word of [...words].sort((a,b) => a.top-b.top || a.left-b.left)) {
    const line = [...lines].reverse().find(item => Math.abs(item.top-word.top) < Math.max(0.003, (word.bottom-word.top)*0.45) && word.left >= item.left && word.left-item.right < 0.025);
    if (line) { line.text += ` ${word.text}`; line.right=Math.max(line.right,word.right); line.bottom=Math.max(line.bottom,word.bottom); }
    else lines.push({...word});
  }
  return lines;
}
export function equipmentTagCandidates(words: TitleBlockWord[], points: Array<{x:number;y:number}>) {
  if (!points.length) return [];
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
  const inside=words.filter(w=>(w.left+w.right)/2>=left && (w.left+w.right)/2<=right && (w.top+w.bottom)/2>=top && (w.top+w.bottom)/2<=bottom);
  return [...new Set(textLines(inside).flatMap(w => [...w.text.matchAll(/\b[A-Z]{1,8}\s*[-\u2010-\u2015]?\s*\d{1,5}(?:[-.]\d{1,4})?[A-Z]?\b/gi)].map(m=>normalizeEquipmentTag(m[0]))))];
}
export function equipmentTagLocations(words: TitleBlockWord[], tag: string) {
  const direct = words.filter(w=>containsEquipmentTag(w.text,tag));
  const joined = textLines(words).filter(w=>containsEquipmentTag(w.text,tag) && !direct.some(d=>d.left>=w.left && d.right<=w.right && Math.abs(d.top-w.top)<0.01));
  return [...direct,...joined].filter(w=>[w.left,w.top,w.right,w.bottom].every(Number.isFinite) && w.right>w.left && w.bottom>w.top).map(w=>({...w,left:Math.min(1,Math.max(0,w.left)),top:Math.min(1,Math.max(0,w.top)),right:Math.min(1,Math.max(0,w.right)),bottom:Math.min(1,Math.max(0,w.bottom))})).filter(w=>w.right>w.left&&w.bottom>w.top);
}
export function equipmentDrawingDestination(input:{jobId:string;setId:string;sheetId:string;sourceSheetId:string;name:string;tag:string;box:TitleBlockWord}) {
  const {box}=input;
  return makeSnapshotSource(`/dashboard/jobs/${input.jobId}/drawings`,{version:1,drawing:{jobId:input.jobId,setId:input.setId,sheetId:input.sheetId,sourceSheetId:input.sourceSheetId,viewport:{center:{x:(box.left+box.right)/2,y:(box.top+box.bottom)/2},zoom:Math.min(10,Math.max(2,0.35/Math.max(box.right-box.left,box.bottom-box.top)))},appearance:{inverted:false,lineColor:null},layers:{markups:true,issues:true,private:true,published:true},selectedId:null,search:input.tag,highlight:{left:box.left,top:box.top,right:box.right,bottom:box.bottom,text:input.tag}}},`${input.tag} — ${input.name}`);
}
