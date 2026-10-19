import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceDir = dirname(fileURLToPath(import.meta.url));
export const languages = {
  es: ['ASÍ FUNCIONA', 'Cada paso te acerca más.', 'Sigue', 'Gratis', 'Suscríbete', 'Contenido exclusivo', 'Reserva'],
  en: ['HOW IT WORKS', 'Every step brings you closer.', 'Follow', 'Free', 'Subscribe', 'Exclusive content', 'Reserve'],
  pt: ['COMO FUNCIONA', 'Cada passo te deixa mais perto.', 'Siga', 'Grátis', 'Assine', 'Conteúdo exclusivo', 'Reserve'],
  fr: ['COMMENT ÇA MARCHE', 'Chaque étape te rapproche.', 'Suivre', 'Gratuit', "S’abonner", 'Contenu exclusif', 'Réserver'],
  it: ['COME FUNZIONA', 'Ogni passo ti porta più vicino.', 'Segui', 'Gratis', 'Abbonati', 'Contenuto esclusivo', 'Prenota'],
};
export const endingCopy = {
  es: ['Videollamada 1:1', 'Habla cara a cara con tu creador favorito.', 'Pregunta, aprende y comparte un momento.', 'Explora Reserve', 'Sala privada'],
  en: ['1:1 video call', 'Talk face to face with your favorite creator.', 'Ask, learn and share a moment.', 'Explore Reserve', 'Private room'],
  pt: ['Videochamada 1:1', 'Converse cara a cara com seu criador favorito.', 'Pergunte, aprenda e compartilhe um momento.', 'Explore o Reserve', 'Sala privada'],
  fr: ['Appel vidéo 1:1', 'Parle face à face avec ton créateur préféré.', 'Pose tes questions, apprends et partage un moment.', 'Explore Reserve', 'Salon privé'],
  it: ['Videochiamata 1:1', 'Parla faccia a faccia con il tuo creator preferito.', 'Chiedi, impara e condividi un momento.', 'Esplora Reserve', 'Stanza privata'],
};

export function generateEnding(out, tools, fanPath) {
  const template = readFileSync(join(sourceDir, 'ending.html'), 'utf8');
  const projects = [];
  for (const [lang, copy] of Object.entries(endingCopy)) {
    for (const portrait of [false, true]) {
      const name = `${lang}-${portrait ? 'vertical' : 'horizontal'}`;
      const folder = resolve(out, name);
      mkdirSync(join(folder, 'assets'), { recursive: true });
      copyFileSync(join(tools, 'node_modules/gsap/dist/gsap.min.js'), join(folder, 'assets/gsap.min.js'));
      copyFileSync(resolve(sourceDir, '../../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2'), join(folder, 'assets/sora.woff2'));
      copyFileSync(resolve(sourceDir, '../../public/favicon.svg'), join(folder, 'assets/mark.svg'));
      copyFileSync(resolve(sourceDir, '../../public/reserve-clips/maquillaje.mp4'), join(folder, 'assets/creator.mp4'));
      copyFileSync(fanPath, join(folder, 'assets/fan.mp4'));
      copyFileSync(join(sourceDir, 'DESIGN.md'), join(folder, 'DESIGN.md'));
      const values = { LANG: lang, SHAPE: portrait ? 'portrait' : 'landscape', WIDTH: portrait ? 720 : 1280, HEIGHT: portrait ? 1280 : 720 };
      ['EYEBROW', 'HEADLINE', 'DETAIL', 'CTA', 'PRIVATE'].forEach((key, i) => values[key] = copy[i]);
      writeFileSync(join(folder, 'index.html'), template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key])));
      writeFileSync(join(folder, 'hyperframes.json'), JSON.stringify({ media: { autoProxy: false } }, null, 2));
      projects.push({ lang, portrait, name, folder });
    }
  }
  return projects;
}
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
      ['EYEBROW', 'TITLE', 'FOLLOW', 'FREE', 'SUBSCRIBE', 'EXCLUSIVE', 'RESERVE'].forEach((key, i) => values[key] = copy[i]);
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
