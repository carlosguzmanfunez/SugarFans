import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceDir = dirname(fileURLToPath(import.meta.url));
// [eyebrow, title, step 1, line 1, step 2, line 2, step 3]. Steps 1 and 2 show a big verb with the
// rest of the sentence under it; step 3 keeps the "Reserve Event · 1:1" label everywhere.
// Order matches the creator profile: subscribe (exclusive content), propose an experience, book a Reserve.
export const languages = {
  es: ['ASÍ FUNCIONA', 'Cada paso te acerca más.', 'Suscríbete', 'a su contenido exclusivo', 'Propón', 'tu experiencia', 'Reserva'],
  en: ['HOW IT WORKS', 'Every step brings you closer.', 'Subscribe', 'to their exclusive content', 'Propose', 'your experience', 'Reserve'],
  pt: ['COMO FUNCIONA', 'Cada passo te deixa mais perto.', 'Assine', 'o conteúdo exclusivo', 'Proponha', 'sua experiência', 'Reserve'],
  fr: ['COMMENT ÇA MARCHE', 'Chaque étape te rapproche.', "Abonne-toi", 'à son contenu exclusif', 'Propose', 'ton expérience', 'Réserve'],
  it: ['COME FUNZIONA', 'Ogni passo ti porta più vicino.', 'Abbonati', 'al suo contenuto esclusivo', 'Proponi', 'la tua esperienza', 'Prenota'],
};
export function generate(out, tools) {
  const template = readFileSync(join(sourceDir, 'scene.html'), 'utf8');
  const projects = [];
  for (const [lang, copy] of Object.entries(languages)) {
    for (const portrait of [false, true]) {
      const name = `${lang}-${portrait ? 'vertical' : 'horizontal'}`;
      const folder = join(out, name);
      mkdirSync(join(folder, 'assets'), { recursive: true });
      copyFileSync(join(tools, 'node_modules/gsap/dist/gsap.min.js'), join(folder, 'assets/gsap.min.js'));
      copyFileSync(resolve(sourceDir, '../../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2'), join(folder, 'assets/sora.woff2'));
      copyFileSync(join(sourceDir, 'DESIGN.md'), join(folder, 'DESIGN.md'));
      const values = { LANG: lang, SHAPE: portrait ? 'portrait' : 'landscape', WIDTH: portrait ? 720 : 1280, HEIGHT: portrait ? 1280 : 720 };
      ['EYEBROW', 'TITLE', 'STEP1', 'LABEL1', 'STEP2', 'LABEL2', 'STEP3'].forEach((key, i) => values[key] = copy[i]);
      writeFileSync(join(folder, 'index.html'), template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key])));
      writeFileSync(join(folder, 'hyperframes.json'), JSON.stringify({ media: { autoProxy: false } }, null, 2));
      projects.push({ lang, portrait, name, folder });
    }
  }
  return projects;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(generate(resolve(process.argv[2]), resolve(process.argv[3])), null, 2));
}
