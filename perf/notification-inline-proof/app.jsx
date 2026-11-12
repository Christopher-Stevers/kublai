import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NotificationCenter} from '~/components/notifications/NotificationCenter';
import {setAppPageActive} from '~/lib/app-page-activity';
const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
window.inlineNavigation=[];
function App(){
 const [session,setSession]=useState('synthetic-user');
 window.inlineFixture={setActive:setAppPageActive,setSession,refetch:()=>cache.refetchQueries({queryKey:[['notifications','overview']]})};
 return <QueryClientProvider client={cache}><NotificationCenter sessionKey={session}/></QueryClientProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
