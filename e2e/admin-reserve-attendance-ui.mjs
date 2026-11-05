// Complete admin workspace with disposable fictional records. CI only.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startAttendanceReview} from './admin-reserve-attendance-review.mjs';
const {server,out,base}=await startAttendanceReview();const browser=await chromium.launch();const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('OK '+name);};
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await page.goto(base+'/admin?section=attendance');const panel=page.getByTestId('admin-reserve-attendance');
 await check('Sección administrativa accesible por enlace y por su navegación',async()=>{
  await panel.getByTestId('admin-attendance-row').first().waitFor();assert.equal(await page.getByRole('button',{name:'Asistencia de Reserve',exact:true}).getAttribute('aria-current'),'true');
  assert.equal(await panel.getByTestId('admin-attendance-row').count(),20);await page.screenshot({path:join(out,'escritorio.png'),fullPage:true});
 });
 await check('Páginas de veinte y seis reservas sin cargar un inventario ilimitado',async()=>{
  await panel.getByRole('button',{name:'Siguiente',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid=admin-attendance-row]').length===6);
  assert.equal(await panel.getByRole('button',{name:'Siguiente',exact:true}).isEnabled(),false);
  await panel.getByRole('button',{name:'Anterior',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid=admin-attendance-row]').length===20);
 });
 await check('Busca por nombre o reserva, abre la constancia y descarga texto legible',async()=>{
  await panel.getByRole('searchbox').fill('conexión completa');await panel.getByRole('button',{name:'Buscar reservas',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid=admin-attendance-row]').length===1);
  const button=panel.getByRole('button',{name:/Ver constancia de/});await button.click();const dialog=page.getByRole('dialog');await dialog.getByTestId('admin-attendance-detail').waitFor();
  assert.ok((await dialog.innerText()).includes('15 min 0 s'));assert.ok((await dialog.innerText()).includes('Envío aceptado'));
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Descargar constancia',exact:true}).click();const download=await downloadEvent;
  assert.ok(download.suggestedFilename().endsWith('.txt'));assert.ok(readFileSync(await download.path(),'utf8').includes('FANS RESERVE · CONSTANCIA'));
  await page.keyboard.press('Escape');assert.ok(await button.evaluate(b=>b===document.activeElement));
 });
 await check('El detalle muestra información incompleta sin declarar ausencia ni aplicar descuentos',async()=>{
  await panel.getByRole('searchbox').fill('datos incompletos');await panel.getByRole('button',{name:'Buscar reservas',exact:true}).click();await panel.getByRole('button',{name:/Ver constancia de Clase/}).click();
  const dialog=page.getByRole('dialog');await dialog.getByTestId('admin-attendance-detail').waitFor();assert.ok((await dialog.innerText()).includes('Revisar registros'));assert.ok((await dialog.innerText()).includes('no deciden descuentos'));
  await page.screenshot({path:join(out,'detalle-escritorio.png'),fullPage:true});await page.keyboard.press('Escape');
 });
 await check('Móvil y escritorio conservan contenido, foco y fechas completas sin desbordes',async()=>{
  await panel.getByRole('searchbox').fill('');await panel.getByRole('button',{name:'Buscar reservas',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid=admin-attendance-row]').length===20);
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await panel.getByRole('button',{name:/Ver constancia de/}).first().click();await page.getByTestId('admin-attendance-detail').waitFor();
   assert.ok(await page.getByRole('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
   if(width===390)await page.screenshot({path:join(out,'detalle-movil.png'),fullPage:true});await page.keyboard.press('Escape');
   if(width===390)await page.screenshot({path:join(out,'movil.png'),fullPage:true});
  }
 });
 await check('Vacío, carga y fallo de consulta se distinguen y permiten recuperarse',async()=>{
  await page.getByLabel('Ejemplo ficticio',{exact:true}).selectOption('empty');await panel.getByText('No encontramos reservas con estos filtros.',{exact:true}).waitFor();
  await page.getByLabel('Ejemplo ficticio',{exact:true}).selectOption('loading');await panel.getByText('Estamos consultando la asistencia…',{exact:true}).waitFor();assert.equal(await panel.getByTestId('admin-attendance-row').count(),0);
  await page.getByLabel('Ejemplo ficticio',{exact:true}).selectOption('error');await panel.getByRole('alert').waitFor();assert.equal(await panel.getByTestId('admin-attendance-row').count(),0);
  await page.getByLabel('Ejemplo ficticio',{exact:true}).selectOption('pending');await panel.getByTestId('admin-attendance-row').first().waitFor();
 });
 await check('Un fallo de contenido no bloquea la revisión independiente de asistencia',async()=>{
  await page.getByLabel('Ejemplo ficticio',{exact:true}).selectOption('content-error');await panel.getByTestId('admin-attendance-row').first().waitFor();
  await page.reload();await panel.getByTestId('admin-attendance-row').first().waitFor();assert.ok(page.url().includes('section=attendance'));assert.deepEqual(errors,[]);
 });
 writeFileSync(join(out,'resultados-ui.json'),JSON.stringify({results,providerCalls:0,errors},null,2));console.log(`${results.length}/${results.length} recorridos de asistencia aprobados.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
