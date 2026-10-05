import { chromium } from 'playwright';
const BASE='http://localhost:4173', OUT='/mnt/project-files/analisis-visual/despues';
const [who, pages] = [process.argv[2], process.argv.slice(3)];
const b = await chromium.launch();
for (const [dev,vp] of [['movil',{width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}],['escritorio',{width:1440,height:900}]]) {
  const ctx = await b.newContext({ viewport:{width:vp.width,height:vp.height}, isMobile:vp.isMobile, hasTouch:vp.hasTouch, deviceScaleFactor:vp.deviceScaleFactor||1, reducedMotion:'reduce' });
  await ctx.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const p = await ctx.newPage();
  if (who!=='visitante') { await p.goto(BASE+'/login'); await p.fill('input[type=email]', who==='fan'?'fan@sugarfans.com':'creator@sugarfans.com'); await p.fill('input[type=password]','demo1234'); await p.click('form button[type=submit]'); await p.waitForTimeout(1200); }
  for (const pg of pages) { const [path,name]=pg.split('='); await p.goto(BASE+path); await p.waitForTimeout(1200);
    await p.screenshot({path:`${OUT}/${dev}-${who}-${name}.png`}); await p.screenshot({path:`${OUT}/${dev}-${who}-${name}-completa.png`, fullPage:true}); }
  await ctx.close();
}
await b.close();
