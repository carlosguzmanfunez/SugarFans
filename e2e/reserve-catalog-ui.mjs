// Real offline app: reading-language changes, search, profiles and booking UI.
// No external requests, provider credentials or payment execution.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const compiled = await build({ entryPoints:['src/lib/vip.ts'], bundle:true, platform:'node', format:'esm', write:false });
const { demoExperiences } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const offers = demoExperiences();
// Complete locations only in these disposable browser fixtures. Actual legacy
// offers stay hidden until their creator supplies a verified event location.
offers.find(e=>e.id==='6').details = { ...offers.find(e=>e.id==='6').details, country:'US', region:'Florida' };
offers.find(e=>e.id==='8').details = { ...offers.find(e=>e.id==='8').details, country:'MX', region:'Ciudad de México' };
// A new creator-authored offer must keep its own text even with a known type.
offers.push({ ...offers.find(e=>e.type==='live-1-1'), id:'qa-own-copy', title:'Tema propio del creador', description:'Esta descripción no pertenece al catálogo traducido.' });
const out = resolve(process.env.RESERVE_CATALOG_OUTPUT || join(tmpdir(),'fansreserve-catalog-ui'));
mkdirSync(out,{recursive:true});
const expected = {
 es: { title:'Platiquemos de lo que te interesa', fashion:'Charla de moda y belleza', questions:'Preguntas y respuestas sobre belleza', action:'Reserva tu plática', description:'Una conversación en vivo 1:1 con tu creador favorito sobre intereses compartidos, sus proyectos y las preguntas que siempre quisiste hacerle.' },
 en: { title:'Let’s talk about what interests you', fashion:'Fashion and beauty conversation', questions:'Beauty questions and answers', action:'Book your conversation' },
 pt: { title:'Vamos conversar sobre o que te interessa', fashion:'Conversa sobre moda e beleza', questions:'Perguntas e respostas sobre beleza', action:'Reserve sua conversa' },
 fr: { title:'Parlons de ce qui vous intéresse', fashion:'Discussion sur la mode et la beauté', questions:'Questions et réponses sur la beauté', action:'Réservez votre conversation' },
 it: { title:'Parliamo di ciò che ti interessa', fashion:'Chiacchierata su moda e bellezza', questions:'Domande e risposte sulla bellezza', action:'Prenota la tua conversazione' },
};
const results=[];const pageErrors=[];const blocked=[];
const check=async(name,fn)=>{await fn();results.push({name,ok:true});console.log(`OK ${name}`);};
const server=await preview({mode:'offline',preview:{host:'127.0.0.1',port:0,open:false}});
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({headless:true});
try {
 for(const [device,viewport] of [['escritorio',{width:1366,height:900}],['movil',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,timezoneId:'America/Tegucigalpa'});
  await context.route('**/*',r=>{
   const url=r.request().url();if(url.startsWith(base)||url.startsWith('data:'))return r.continue();
   blocked.push(new URL(url).origin);return r.abort();
  });
  await context.addInitScript(({offers})=>{
   localStorage.setItem('fansreserve_age_verified','true');
   if(!localStorage.getItem('qa-catalog-seeded')){
    localStorage.setItem('fansreserve_vip_experiences_v1',JSON.stringify(offers));
    localStorage.setItem('qa-catalog-seeded','true');
   }
  },{offers});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(`${base}/reserve`);
  const cards=page.getByTestId('reserve-card');
  await check(`${device}: retiro y ubicación conservan el catálogo correcto`,async()=>{
   await cards.first().waitFor();
   assert.equal(await cards.count(),8); // Seven virtual pilot offers + creator-authored fixture.
   assert.equal(await cards.filter({hasText:'Acceso anticipado a mi próximo proyecto'}).count(),0);
   assert.equal(await cards.filter({hasText:'Saludo y fotos contigo'}).count(),0);
   assert.equal(await cards.filter({hasText:'Entrenamiento en gimnasio'}).count(),0);
   assert.equal(await cards.first().getByRole('heading').innerText(),expected.es.title);
  });
  for(const [language,copy] of Object.entries(expected)){
   await page.getByTestId('reserve-language-selector').getByRole('combobox').selectOption(language);
   const featured=cards.filter({has:page.getByRole('heading',{name:copy.title,exact:true})});
   await check(`${device}/${language}: nombres, botones y descripción`,async()=>{
    await featured.getByRole('button',{name:`${copy.action}: ${copy.title}`,exact:true}).waitFor();
    await cards.filter({has:page.getByRole('heading',{name:copy.fashion,exact:true})}).waitFor();
    await cards.filter({has:page.getByRole('heading',{name:copy.questions,exact:true})}).waitFor();
    await cards.filter({hasText:'Tema propio del creador'}).waitFor();
    assert.equal(await featured.getByRole('heading').getAttribute('lang'),language);
    assert.equal(await featured.getByRole('heading').innerText(),copy.title);
    await featured.locator('button').first().click();
    const dialog=page.getByTestId('reserve-dialog');
    await dialog.getByRole('heading',{name:copy.title,exact:true}).waitFor();
    assert.equal(await dialog.getByTestId('experience-description').getAttribute('lang'),language);
    const description=await dialog.getByTestId('experience-description').innerText();
    assert(description.length>50);
    if(language==='es')assert.equal(description,copy.description);
    else assert.notEqual(description,expected.es.description);
    assert(!/encuentro|encounter|rendez-vous|encontro|incontro|intim|sensual|seduc/i.test(description));
    assert.equal(await dialog.getByRole('button',{name:copy.action,exact:true}).count(),1);
    await dialog.screenshot({path:join(out,`descripcion-${language}-${device}.png`),animations:'disabled'});
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(),0);
   });
   await check(`${device}/${language}: búsqueda por el nombre traducido`,async()=>{
    const search=page.getByRole('searchbox',{name:'Buscar en Reserve'});
    await search.fill(copy.title);await featured.waitFor();assert.equal(await cards.count(),1);
    await search.fill('');await cards.filter({hasText:'Tema propio del creador'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'desbordamiento horizontal');
   });
   await check(`${device}/${language}: ambas presenciales conservan sus traducciones y filtros`,async()=>{
    const titles = {
     es:['Saludo y fotos contigo','Entrenamiento en gimnasio'],
     en:['Say hello and take photos','Gym training session'],
     pt:['Um olá e fotos com você','Treino na academia'],
     fr:['Un bonjour et des photos avec vous','Entraînement en salle de sport'],
     it:['Un saluto e qualche foto insieme','Allenamento in palestra'],
    }[language];
    const city=async(country,label)=>{
     const selector=page.getByTestId('reserve-city-selector').first();
     const change=selector.getByRole('button',{name:'Cambiar ciudad'});
     if(await change.count())await change.click();
     await selector.getByLabel('País de asistencia').selectOption(country);
     await selector.getByLabel('Ciudad de asistencia').selectOption({label});
     await selector.getByRole('checkbox').check();await selector.getByRole('button',{name:'Confirmar ciudad',exact:true}).click();
    };
    await city('US','Miami, Florida');
    const greeting=cards.filter({has:page.getByRole('heading',{name:titles[0],exact:true})});await greeting.waitFor();
    assert.equal(await cards.filter({has:page.getByRole('heading',{name:titles[1],exact:true})}).count(),0);
    await greeting.locator('button').first().click();
    const dialog=page.getByTestId('reserve-dialog');
    assert.equal(await dialog.getByTestId('experience-description').getAttribute('lang'),language);
    assert(!/encuentro|encounter|rendez-vous|encontro|incontro|intim|sensual|seduc/i.test(await dialog.innerText()));
    await page.keyboard.press('Escape');
    await city('MX','Ciudad de México, Ciudad de México');
    await cards.filter({has:page.getByRole('heading',{name:titles[1],exact:true})}).waitFor();
    assert.equal(await greeting.count(),0);
    await page.evaluate(()=>localStorage.removeItem('fansreserve_reserve_destination_v1'));
    await page.reload();await cards.filter({hasText:copy.title}).waitFor();
   });
  }
  await check(`${device}: idioma persiste al recargar y navegar al perfil`,async()=>{
   await page.reload();await cards.filter({hasText:expected.it.title}).waitFor();
   assert.equal(await page.getByTestId('reserve-language-selector').getByRole('combobox').inputValue(),'it');
   await page.goto(`${base}/creator/1#reserve`);
   const section=page.getByTestId('creator-reserve');
   await section.getByRole('heading',{name:expected.it.title,exact:true}).waitFor();
   assert.equal(await section.getByTestId('reserve-card').first().getByRole('heading').innerText(),expected.it.title);
   await section.getByTestId('reserve-language-selector').getByRole('combobox').selectOption('es');
   await section.getByRole('heading',{name:expected.es.title,exact:true}).waitFor();
   await section.screenshot({path:join(out,`perfil-${device}.png`),animations:'disabled'});
  });
  await check(`${device}: el botón destacado abre la reserva existente sin cobrar`,async()=>{
   await page.goto(`${base}/login`);await page.locator('input[type=email]').fill('fan@sugarfans.com');await page.locator('input[type=password]').fill('demo1234');
   await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname!=='/login');
   await page.goto(`${base}/reserve`);
   await cards.filter({hasText:expected.es.title}).getByRole('button',{name:`${expected.es.action}: ${expected.es.title}`,exact:true}).click();
   const dialog=page.getByTestId('reserve-dialog');
   await dialog.getByTestId('booking-calendar').waitFor();
   await dialog.getByRole('button',{name:/^Confirmar reserva/}).waitFor();
   await page.keyboard.press('Escape');
  });
  await context.close();
 }
 assert.deepEqual(pageErrors,[]);
 writeFileSync(join(out,'resultados.json'),JSON.stringify({passed:results.length,pageErrors,blockedExternalOrigins:[...new Set(blocked)],results},null,2));
 console.log(`${results.length}/${results.length} comprobaciones de catálogo`);
} finally { await browser.close();await server.close(); }
