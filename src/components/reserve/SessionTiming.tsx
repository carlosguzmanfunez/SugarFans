import React,{useEffect,useState} from 'react';
import {liveWindow,type VipBooking} from '../../lib/vip';
import {sessionNow} from '../../lib/reserveSessionClient';
export default function SessionTiming({booking}:{booking:VipBooking}){
 const [now,setNow]=useState(sessionNow());
 useEffect(()=>{const timer=setInterval(()=>setNow(sessionNow()),1000);return()=>clearInterval(timer);},[]);
 const seconds=Math.max(0,Math.ceil((liveWindow(booking.date,booking.time,booking.durationMinutes||30,booking.timeZone).start.getTime()-now)/1000));
 if(!seconds)return null;
 return <p role="status" className="mb-4 text-sm text-yellow-200" data-testid="session-countdown">Preparación: tu Reserve comienza en {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}. Este tiempo no consume la duración contratada.</p>;
}
