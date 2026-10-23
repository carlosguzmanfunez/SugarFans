import config from '../config/payout-schedule.json';
import {PAYOUT_TIME_ZONE,payoutWindow} from './payoutCalendar';
export type ReviewProfile = keyof typeof config.profiles;
export interface ReviewScheduleStatus {
 version:1; profile:ReviewProfile; timeZone:string; mode:'review-only'; caseLimit:number;
 withinWindowMinutes:number; outsideWindowMinutes:number; precisionMinutes:number; requiredPlan:string;
 plannedProfile:ReviewProfile; plannedWithinWindowMinutes:number; plannedRequiredPlan:string;
 serverTime:string; source:'deployment-configuration';
}
export interface ReviewJob {
 id:string;state:string;started_at:string;finished_at:string|null;
 summary:{trigger?:string;schedule_profile?:string|null};
}
export function reviewScheduleStatus(now=new Date()):ReviewScheduleStatus {
 const profile=config.activeProfile as ReviewProfile,p=config.profiles[profile];
 return {version:1,profile,timeZone:PAYOUT_TIME_ZONE,mode:'review-only',caseLimit:config.caseLimit,
  withinWindowMinutes:p.withinWindowMinutes,outsideWindowMinutes:p.outsideWindowMinutes,precisionMinutes:p.precisionMinutes,requiredPlan:p.requiredPlan,
  plannedProfile:'five-minute-review',plannedWithinWindowMinutes:config.profiles['five-minute-review'].withinWindowMinutes,plannedRequiredPlan:'pro',
  serverTime:now.toISOString(),source:'deployment-configuration'};
}
// Strictly after the supplied instant. The daily time is 06:00 in Honduras.
export function nextReviewAt(at:Date,profile:ReviewProfile):string {
 if(!Number.isFinite(at.getTime())||!Object.prototype.hasOwnProperty.call(config.profiles,profile))throw Error('Horario de revisión inválido');
 for(let t=Math.floor(at.getTime()/60000)*60000+60000;t<=at.getTime()+86460000;t+=60000){
  const d=new Date(t),inside=payoutWindow(d).open;
  if(profile==='five-minute-review'&&inside?d.getUTCMinutes()%5===0:d.getUTCHours()===12&&d.getUTCMinutes()===0)return d.toISOString();
 }
 throw Error('No se encontró la siguiente revisión');
}
export function reviewScheduleHealth(jobs:ReviewJob[],schedule:ReviewScheduleStatus,now=new Date()) {
 const running=jobs.filter(j=>j.state==='running').sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at))[0];
 if(running&&Number.isFinite(Date.parse(running.started_at))&&now.getTime()-Date.parse(running.started_at)>180000)
  return {state:'interrupted' as const,last:running.started_at,next:null};
 const last=jobs.filter(j=>j.summary.trigger==='scheduled-review'&&j.summary.schedule_profile===schedule.profile&&Number.isFinite(Date.parse(j.started_at))).sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at))[0];
 if(!last)return {state:running?'running' as const:'unconfirmed' as const,last:null,next:nextReviewAt(now,schedule.profile)};
 if(last.state!=='finished')return {state:running?'running' as const:'failed' as const,last:last.started_at,next:nextReviewAt(now,schedule.profile)};
 const next=nextReviewAt(new Date(last.started_at),schedule.profile),late=now.getTime()>Date.parse(next)+(schedule.precisionMinutes+10)*60000;
 return {state:running?'running' as const:late?'late' as const:'current' as const,last:last.started_at,next:late?next:nextReviewAt(now,schedule.profile)};
}
