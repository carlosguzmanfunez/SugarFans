export type HealthKind='healthy'|'unreachable'|'review_late'|'unsafe_configuration';
const day=86400000;
export function evaluateHealth(data:unknown,armedAt:string,now=Date.now()):{kind:HealthKind;detail:string}{
 if(!data||typeof data!=='object')return {kind:'unreachable',detail:'INVALID_HEALTH_RESPONSE'};
 const d=data as {version?:number;checked_at?:string;execution_enabled?:boolean;handoff_enabled?:boolean;schedule?:{profile?:string;mode?:string;precisionMinutes?:number};jobs?:{state:string;started_at:string;finished_at:string|null;execute_requested:boolean;summary:{trigger?:string;schedule_profile?:string}}[]};
 if(d.version!==1||!d.checked_at||!Number.isFinite(Date.parse(d.checked_at))||Math.abs(Date.parse(d.checked_at)-now)>120000||!Array.isArray(d.jobs))return {kind:'unreachable',detail:'INVALID_HEALTH_RESPONSE'};
 if(d.jobs.some(j=>!j||typeof j!=='object'||!j.summary||typeof j.started_at!=='string'||typeof j.state!=='string'))return {kind:'unreachable',detail:'INVALID_HEALTH_RESPONSE'};
 if(d.schedule?.profile!=='daily-review'||d.schedule.mode!=='review-only'||d.execution_enabled!==false||d.handoff_enabled!==false)return {kind:'unsafe_configuration',detail:'REVIEW_CONFIGURATION_CHANGED'};
 const armed=Date.parse(armedAt);
 if(!Number.isFinite(armed))return {kind:'unsafe_configuration',detail:'MONITOR_ANCHOR_MISSING'};
 const scheduled=d.jobs.filter(j=>j.summary?.trigger==='scheduled-review'&&j.summary.schedule_profile==='daily-review'&&Number.isFinite(Date.parse(j.started_at))&&Date.parse(j.started_at)<=now+120000);
 if(scheduled.some(j=>j.execute_requested!==false))return {kind:'unsafe_configuration',detail:'SCHEDULE_REQUESTED_EXECUTION'};
 const completed=scheduled.filter(j=>j.state==='finished'&&j.finished_at&&Number.isFinite(Date.parse(j.finished_at))&&Date.parse(j.finished_at)>=Date.parse(j.started_at)&&Date.parse(j.finished_at)<=now+120000);
 const anchor=Math.max(armed,...completed.map(j=>Date.parse(j.started_at)));
 // The deadline is anchored to arming / confirmed completion, never to "now".
 let expected=Math.floor(anchor/day)*day+12*3600000;
 if(expected<=anchor)expected+=day;
 if(now>expected+70*60000)return {kind:'review_late',detail:'SCHEDULED_REVIEW_MISSED'};
 return {kind:'healthy',detail:'REVIEW_MONITORED'};
}
