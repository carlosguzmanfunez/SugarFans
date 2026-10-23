import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {build} from 'esbuild';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {schedule,buildScheduleConfig,assertPlan} from '../scripts/payout-schedule.mjs';
const folder=mkdtempSync(join(tmpdir(),'pro-schedule-'));
try{
 await build({entryPoints:['src/lib/payoutCalendar.ts','src/lib/payoutSchedule.ts'],outdir:folder,bundle:true,format:'esm',platform:'node',outExtension:{'.js':'.mjs'},logLevel:'silent'});
 const {payoutWindow}=await import(pathToFileURL(join(folder,'payoutCalendar.mjs')));
 const {nextReviewAt,reviewScheduleStatus,reviewScheduleHealth}=await import(pathToFileURL(join(folder,'payoutSchedule.mjs')));
 const active=JSON.parse(readFileSync('vercel.json','utf8')),proposal=JSON.parse(readFileSync('docs/operations/vercel-payouts-pro.example.json','utf8'));
 assert.deepEqual(active,buildScheduleConfig(schedule.activeProfile,active));assert.deepEqual(proposal,buildScheduleConfig('five-minute-review',active));
 assert.equal(active.crons.filter(c=>c.path==='/api/payout-job').length,0);assert.equal(proposal.crons.filter(c=>c.path==='/api/payout-job').length,0);
 assert.equal(proposal.crons.find(c=>c.path==='/api/usage').schedule,'0 14 * * *');assert.equal(proposal.functions['api/payout-review.ts'].maxDuration,180);
 assert.throws(()=>assertPlan('five-minute-review','hobby'),/requiere Pro/);assert.throws(()=>assertPlan('five-minute-review',undefined));assert.doesNotThrow(()=>assertPlan('five-minute-review','pro'));assert.doesNotThrow(()=>assertPlan('five-minute-review','enterprise'));
 const crons=proposal.crons.filter(c=>c.path===schedule.reviewPath).map(c=>c.schedule.split(' '));
 const matches=(expr,n)=>expr==='*'||expr.startsWith('*/')&&n%Number(expr.slice(2))===0||expr.split(',').some(p=>{const[a,b]=p.split('-').map(Number);return n>=a&&n<=(b??a);});let ticks=0;
 for(let t=Date.UTC(2026,0,1);t<Date.UTC(2029,0,1);t+=300000){const d=new Date(t),inside=payoutWindow(d).open,hour=d.getUTCHours(),minute=d.getUTCMinutes(),day=d.getUTCDate();const hits=crons.filter(([m,h,dom])=>matches(m,minute)&&matches(h,hour)&&matches(dom,day)).length;const daily=!inside&&hour===12&&minute===0;assert.equal(hits,inside||daily?1:0,d.toISOString());ticks++;}
 for(const [at,next]of[
  ['2026-10-25T23:59:59-06:00','2026-10-26T00:00:00-06:00'],
  ['2026-10-26T00:00:00-06:00','2026-10-26T00:05:00-06:00'],
  ['2026-11-01T23:54:59-06:00','2026-11-01T23:55:00-06:00'],
  ['2026-11-01T23:55:00-06:00','2026-11-02T06:00:00-06:00'],
  ['2028-02-29T23:59:59-06:00','2028-03-01T00:00:00-06:00'],
  ['2028-03-01T23:59:59-06:00','2028-03-02T06:00:00-06:00']
 ])assert.equal(Date.parse(nextReviewAt(new Date(at),'five-minute-review')),Date.parse(next));
 assert.equal(nextReviewAt(new Date('2026-10-26T06:00:00-06:00'),'daily-review'),'2026-10-27T12:00:00.000Z');
 const now=new Date('2026-10-26T12:00:00Z'),status=reviewScheduleStatus(now),job={id:'test',state:'finished',started_at:now.toISOString(),finished_at:now.toISOString(),summary:{trigger:'scheduled-review',schedule_profile:status.profile}};
 assert.equal(status.mode,'review-only');assert.equal(status.caseLimit,50);
 assert.equal(reviewScheduleHealth([],status,now).state,'unconfirmed');
 assert.equal(reviewScheduleHealth([{...job,summary:{trigger:'manual-review'}}],status,now).state,'unconfirmed');
 assert.equal(reviewScheduleHealth([{...job,summary:{trigger:'scheduled-review',schedule_profile:'old'}}],status,now).state,'unconfirmed');
 assert.equal(reviewScheduleHealth([job],status,now).state,'current');
 assert.equal(reviewScheduleHealth([{...job,state:'failed'}],status,now).state,'failed');
 assert.equal(reviewScheduleHealth([job],status,new Date('2026-10-27T13:11:00Z')).state,'late');
 assert.equal(reviewScheduleHealth([{...job,state:'running'}],status,new Date('2026-10-26T12:02:00Z')).state,'running');
 assert.equal(reviewScheduleHealth([{...job,state:'running'}],status,new Date('2026-10-26T12:04:00Z')).state,'interrupted');
 console.log(`OK ${ticks} intervalos 2026–2028: ventana 26–1 en Honduras, febrero bisiesto, siguiente revisión, retrasos e interrupciones; Hobby rechaza el perfil Pro. Ningún calendario apunta a un ejecutor.`);
}finally{assert.equal(resolve(folder,'..'),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
