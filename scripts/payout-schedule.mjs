import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const schedule=JSON.parse(readFileSync(join(root,'src/config/payout-schedule.json'),'utf8'));
export function buildScheduleConfig(profile,base){
 assert.ok(Object.hasOwn(schedule.profiles,profile),'Unknown review profile');
 return {...base,functions:{...base.functions,'api/payout-review.ts':{maxDuration:180}},crons:[...base.crons.filter(c=>!['/api/payout-job','/api/payout-review'].includes(c.path)),...schedule.profiles[profile].crons.map(expression=>({path:schedule.reviewPath,schedule:expression}))]};
}
export function assertPlan(profile,plan){
 assert.ok(Object.hasOwn(schedule.profiles,profile));
 if(schedule.profiles[profile].requiredPlan==='pro'&&!['pro','enterprise'].includes(plan))throw Error('El horario de cinco minutos requiere Pro o Enterprise; no se modificaron archivos ni la suscripción.');
}
function linkedPlan(){
 const linkFile=join(root,'.vercel/project.json');
 if(!existsSync(linkFile))throw Error('Vincula esta copia local al proyecto fans-reserve con Vercel CLI antes de preparar su calendario.');
 const link=JSON.parse(readFileSync(linkFile,'utf8'));
 assert.ok(/^team_[a-zA-Z0-9]+$/.test(link.orgId));
 assert.equal(link.projectName,'fans-reserve','Selecciona el proyecto fans-reserve antes de preparar su calendario');
 const cli=process.env.VERCEL_CLI_JS||(process.env.APPDATA?join(process.env.APPDATA,'npm/node_modules/vercel/dist/vc.js'):null);
 if(!cli||!existsSync(cli))throw Error('Falta Vercel CLI. Indica su archivo con VERCEL_CLI_JS; no se cambió la configuración.');
 const reply=spawnSync(process.execPath,[cli,'api','/v2/teams/'+link.orgId,'--method','GET'],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:2e6});
 if(reply.status!==0)throw Error('No se pudo confirmar el plan con Vercel; no se cambió la configuración.');
 const team=JSON.parse(reply.stdout);assert.equal(team.id,link.orgId);return team.billing?.plan;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const base=JSON.parse(readFileSync(join(root,'vercel.json'),'utf8'));
 if(process.argv.includes('--write-pro')){
  const profile='five-minute-review';assertPlan(profile,linkedPlan());
  const next=buildScheduleConfig(profile,base);
  writeFileSync(join(root,'vercel.json'),JSON.stringify(next,null,2)+'\n');
  writeFileSync(join(root,'src/config/payout-schedule.json'),JSON.stringify({...schedule,activeProfile:profile},null,2)+'\n');
  console.log('Preparado localmente: revisiones cada cinco minutos. Requiere revisión y publicación; no cambia la suscripción ni habilita pagos.');
 }else{
  assert.deepEqual(base,buildScheduleConfig(schedule.activeProfile,base),'El horario publicado y el perfil de revisiones no coinciden');
  assert.equal(schedule.reviewPath,'/api/payout-review');assert.equal(schedule.caseLimit,50);
  assert.ok(existsSync(join(root,'api/payout-review.ts')));
  const candidate=JSON.parse(readFileSync(join(root,'docs/operations/vercel-payouts-pro.example.json'),'utf8'));
  assert.deepEqual(candidate,buildScheduleConfig('five-minute-review',base),'El ejemplo Pro está desalineado');
  console.log('Calendario coherente: '+schedule.activeProfile+', hasta 50 casos, ruta exclusiva de revisión. Ejemplo Pro preparado; pagos sin activar.');
 }
}
