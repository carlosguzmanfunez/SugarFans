import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceDir = dirname(fileURLToPath(import.meta.url));
// [eyebrow, title, step 1, label 1, step 2, label 2, step 3]; step 3 label is "Reserve Event · 1:1" everywhere.
// Order matches the creator profile: subscribe (exclusive content), propose an experience, book a Reserve.
export const languages = {
  es: ['ASÍ FUNCIONA', 'Cada paso te acerca más.', 'Suscríbete', 'Contenido exclusivo', 'Propón', 'Tu experiencia', 'Reserva'],
  en: ['HOW IT WORKS', 'Every step brings you closer.', 'Subscribe', 'Exclusive content', 'Propose', 'Your experience', 'Reserve'],
  pt: ['COMO FUNCIONA', 'Cada passo te deixa mais perto.', 'Assine', 'Conteúdo exclusivo', 'Proponha', 'Sua experiência', 'Reserve'],
  fr: ['COMMENT ÇA MARCHE', 'Chaque étape te rapproche.', "S’abonner", 'Contenu exclusif', 'Propose', 'Ton expérience', 'Réserver'],
  it: ['COME FUNZIONA', 'Ogni passo ti porta più vicino.', 'Abbonati', 'Contenuto esclusivo', 'Proponi', 'La tua esperienza', 'Prenota'],
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
