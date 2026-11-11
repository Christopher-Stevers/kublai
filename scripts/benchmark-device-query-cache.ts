/** Synthetic-only comparison. Run only outside a reserved performance capture. */
import { performance } from "node:perf_hooks";
import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import SuperJSON from "superjson";
import { DEVICE_QUERY_BUDGET, decodeDeviceQueries, encodeDeviceQueries, shouldPersistDeviceQuery } from "../src/lib/device-query-cache";
const maximum = Number(process.argv[2] ?? 160);
const itemBytes = Number(process.argv[3] ?? 8192);
if (!Number.isSafeInteger(maximum) || maximum < 4 || maximum > 1000 || !Number.isSafeInteger(itemBytes) || itemBytes < 1 || itemBytes > 32768)
  throw new Error("Usage: tsx scripts/benchmark-device-query-cache.ts [queries=160, max1000] [synthetic-text-bytes=8192, max32768]");
const encoder = new TextEncoder();
function previousEncoding(client: QueryClient) {
  const state = dehydrate(client, {shouldDehydrateQuery:shouldPersistDeviceQuery,shouldDehydrateMutation:()=>false});
  state.queries.sort((a,b)=>b.state.dataUpdatedAt-a.state.dataUpdatedAt);
  const kept: DehydratedState = {mutations:[],queries:[]};
  for (const query of state.queries) {
    const candidate={...kept,queries:[...kept.queries,query]};
    if(encoder.encode(SuperJSON.stringify(candidate)).byteLength<=DEVICE_QUERY_BUDGET) kept.queries.push(query);
  }
  return SuperJSON.stringify(kept);
}
function measure(run:()=>string) {
  const samples:number[]=[];let payload="";
  for(let i=0;i<3;i++){const start=performance.now();payload=run();samples.push(performance.now()-start);}
  return {medianMs:samples.sort((a,b)=>a-b)[1],bytes:encoder.encode(payload).byteLength,payload};
}
const rows=[];
for(const count of [...new Set([Math.floor(maximum/4),Math.floor(maximum/2),maximum])]){
  const client=new QueryClient();
  for(let i=0;i<count;i++)client.setQueryData([["job","getJob"],{input:{id:`synthetic-${i}`},type:"query"}],{date:new Date("2026-01-01"),text:"a".repeat(itemBytes)},{updatedAt:i+1});
  const legacy=measure(()=>previousEncoding(client));
  const current=measure(()=>encodeDeviceQueries(client));
  const decoded=decodeDeviceQueries(current.payload);
  rows.push({queries:count,syntheticTextBytesPerQuery:itemBytes,legacyMedianMs:legacy.medianMs,entryCodecMedianMs:current.medianMs,legacyPayloadBytes:legacy.bytes,entryPayloadBytes:current.bytes,withinBudget:current.bytes<=DEVICE_QUERY_BUDGET,decodedQueries:decoded.queries.length,datesPreserved:(decoded.queries[0]?.state.data as {date?:unknown})?.date instanceof Date});
}
console.log(JSON.stringify({method:"Three same-process runs per size; synthetic data only. CPU timing is a local microbenchmark, not phone INP or a lab journey.",rows},null,2));
