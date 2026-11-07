import {describe,it,expect} from "vitest";
import {systemRuleSchema,systemAlternativeSchema} from "./job-systems";
import {specMaterialCandidate} from "./spec-material-summary";
const option=systemAlternativeSchema.parse({id:"copper",label:"Type L",requiredTerms:["Type L"]});
const rule=systemRuleSchema.parse({id:"pipe",label:"Pipe",group:"pipe",sizeRange:{min:null,max:2,unit:"in"},alternatives:[option]});
describe("spec material candidates",()=>{
 it("keeps required material terms and size limits",()=>{
 expect(specMaterialCandidate({displayName:"Copper Type L pipe",sizeNominal:"2",sizeUnitCode:"in"},rule,option)).toBe(true);
 expect(specMaterialCandidate({displayName:"Copper Type M pipe",sizeNominal:"2",sizeUnitCode:"in"},rule,option)).toBe(false);
 expect(specMaterialCandidate({displayName:"Copper Type L pipe",sizeNominal:"3",sizeUnitCode:"in"},rule,option)).toBe(false);
 });
 it("does not assume unknown sizes meet a restricted range",()=>{
 expect(specMaterialCandidate({displayName:"Copper Type L pipe"},rule,option)).toBe(false);
 });
});
