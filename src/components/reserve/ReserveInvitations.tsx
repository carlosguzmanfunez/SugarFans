import React,{useEffect,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useAuth,type User} from '../../context/AuthContext';
import {useNotifications} from '../../lib/live';
import {SESSION_DEVICE_NOTICE} from '../../lib/reserveSession';
import {sessionClockReady,sessionNow,syncSessionClock} from '../../lib/reserveSessionClient';

export default function ReserveInvitations(){
 const {user}=useAuth();return user?<UserInvitations key={user.id} user={user}/>:null;
}
function UserInvitations({user}:{user:User}){
 const {data:items}=useNotifications(user);const {pathname}=useLocation();
 const [dismissed,setDismissed]=useState<string[]>([]);const [now,setNow]=useState(sessionNow());
 useEffect(()=>{
  let active=true;
  const sync=()=>syncSessionClock().then(()=>{if(active)setNow(sessionNow());}).catch(()=>undefined);
  sync();const timer=setInterval(()=>setNow(sessionNow()),10000);
  const visible=()=>{if(document.visibilityState==='visible')sync();};document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const item=user&&sessionClockReady()&&items.find(n=>n.link.includes('?reserveReminder=')&&!dismissed.includes(n.id)
  &&now-Date.parse(n.createdAt)<90000&&now>=Date.parse(n.createdAt));
 if(!item||pathname.startsWith('/live/')||pathname.startsWith('/evento/'))return null;
 return <aside role="region" aria-label="Tu Reserve está por comenzar" className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-line bg-white p-4 text-ink shadow-xl sm:bottom-6" data-testid="reserve-invitation">
  <p className="font-bold">{item.title}</p><p className="mt-1 text-sm">{SESSION_DEVICE_NOTICE}</p>
  <div className="mt-3 flex flex-wrap gap-2"><Link to={item.link} className="inline-flex min-h-11 items-center rounded-full bg-brand-600 px-5 text-sm font-semibold text-white">Preparar mi Reserve</Link>
  <button type="button" onClick={()=>setDismissed(d=>[...d,item.id])} className="min-h-11 px-3 text-sm font-semibold">Ahora no</button></div>
 </aside>;
}
