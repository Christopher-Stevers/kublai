// Synthetic local HTTP transport only; no production tRPC/authentication claim.
import {useQueryClient,useQuery,useInfiniteQuery,useMutation} from '@tanstack/react-query';
import {getQueryKey} from '@trpc/react-query';
async function rpc(name,input,options={}){
 const response=await fetch(`/fixture/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,{method:options.method??'GET',signal:options.signal});
 const value=await response.json();
 if(!response.ok)throw Object.assign(new Error(value.message??'Synthetic refusal'),{data:{code:value.code}});
 return value;
}
const client={notifications:{identity:{query:(input,options)=>rpc('identity',input,options)},overview:{query:(input,options)=>rpc('overview',input,options)}}};
const query=name=>({_def:()=>({path:['notifications',name]}),useQuery:(input,options)=>useQuery({...options,queryKey:getQueryKey(api.notifications[name],input,'query'),queryFn:({signal})=>rpc(name,input,{signal})})});
const mutation=name=>({useMutation:()=>useMutation({mutationFn:input=>rpc(name,input,{method:'POST'})})});
export const api={
 useUtils(){const cache=useQueryClient();const invalidate=name=>input=>cache.invalidateQueries({queryKey:[['notifications',name],{input}]});return{client,notifications:{overview:{invalidate:invalidate('overview')},list:{invalidate:invalidate('list')},jobSettings:{invalidate:invalidate('jobSettings')}},drawingsWorkspace:{notifications:{invalidate:async()=>undefined}},chat:{getOverview:{invalidate:async()=>undefined}},conversations:{list:{invalidate:async()=>undefined}}};},
 notifications:{identity:query('identity'),overview:query('overview'),jobSettings:query('jobSettings'),
  list:{_def:()=>({path:['notifications','list']}),useInfiniteQuery:(input,options)=>useInfiniteQuery({...options,queryKey:getQueryKey(api.notifications.list,input,'infinite'),queryFn:({signal})=>rpc('list',input,{signal}),initialPageParam:null})},
  read:mutation('read'),setJobSettings:mutation('setJobSettings'),
 },
};
