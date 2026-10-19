import { mkdirSync, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { generate, generateEnding, sourceDir, languages, endingCopy } from './generate.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[i + 1]]);
  return pairs;
}, []));
for (const key of ['originals', 'out', 'work']) if (!args[key]) throw new Error(`Missing --${key}`);
const originals = resolve(args.originals);
const out = resolve(args.out);
const work = resolve(args.work);
const tools = resolve(args.tools || sourceDir);
if (out === originals) throw new Error('Output must differ from the untouched originals');
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });
const requireTools = createRequire(join(tools, 'package.json'));
const ffmpeg = requireTools('ffmpeg-static');
const ffprobe = requireTools('ffprobe-static').path;
const cli = join(tools, 'node_modules/hyperframes/bin/hyperframes.mjs');
const env = { ...process.env, DO_NOT_TRACK: '1', HYPERFRAMES_FFMPEG_PATH: ffmpeg, HYPERFRAMES_FFPROBE_PATH: ffprobe };
const manifestPath = join(out, 'manifest.json');
async function run(command, commandArgs, log) {
  await new Promise((done, fail) => {
    const stream = createWriteStream(log);
    const child = spawn(command, commandArgs, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
    child.on('error', error => { stream.end(); fail(error); });
    child.on('close', code => stream.end(() => code === 0 ? done() : fail(new Error(`Command failed (${code}); see ${log}`))));
  });
}
async function probe(path, log) {
  await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames', '-of', 'json', path], log);
  return JSON.parse(readFileSync(log, 'utf8'));
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// Reuse the illustrative fan footage already present in the original film.
const fan = join(work, 'fan.mp4');
await run(ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-ss', '6', '-t', '3.2', '-i', join(originals, 'fans-reserve-presentacion.mp4'), '-vf', 'crop=338:230:790:360,setpts=(PTS-STARTPTS)*1.875,fps=30', '-t', '6', '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', fan], join(work, 'fan-extract.log'));
const projects = generate(join(work, 'projects'), tools).filter(project => (!args.lang || project.lang === args.lang) && (!args.shape || (project.portrait ? 'vertical' : 'horizontal') === args.shape));
const endings = new Map(generateEnding(join(work, 'ending-projects'), tools, fan).map(project => [project.name, project]));
if (!projects.length) throw new Error('No variants match the requested filters');
const fileName = project => `fans-reserve-presentacion${project.portrait ? '-vertical' : ''}${project.lang === 'es' ? '' : `-${project.lang}`}.mp4`;
const targets = new Set(projects.map(fileName));
const manifest = args.lang || args.shape ? JSON.parse(readFileSync(manifestPath, 'utf8')).filter(entry => !targets.has(entry.file)) : [];
// Two independent variants at a time; avoid ten competing Chrome renderers.
for (let i = 0; i < projects.length; i += 2) {
  const batch = await Promise.allSettled(projects.slice(i, i + 2).map(async project => {
    const { lang, portrait, name, folder } = project;
    const file = fileName(project);
    const input = join(originals, file);
    const output = join(out, file);
    const base = await probe(input, join(work, `${name}-input.json`));
    const video = base.streams.find(s => s.codec_type === 'video');
    if (Math.abs(Number(base.format.duration) - 31.6) > .02 || video.r_frame_rate !== '30/1' || video.width !== (portrait ? 720 : 1280) || video.height !== (portrait ? 1280 : 720)) throw new Error(`Unexpected source format: ${file}`);
    const ending = endings.get(name);
    for (const [part, projectFolder] of [['subscription', folder], ['ending', ending.folder]]) {
      for (const command of ['lint', 'validate', 'inspect']) {
        const flags = command === 'inspect' ? ['--samples', '12', '--strict'] : [];
        await run(process.execPath, [cli, command, projectFolder, ...flags], join(work, `${name}-${part}-${command}.log`));
      }
    }
    const scene = join(work, `${name}-scene.mp4`);
    await run(process.execPath, [cli, 'render', folder, '--output', scene, '--fps', '30', '--quality', 'high', '--workers', '2'], join(work, `${name}-render.log`));
    const endingScene = join(work, `${name}-ending.mp4`);
    await run(process.execPath, [cli, 'render', ending.folder, '--output', endingScene, '--fps', '30', '--quality', 'high', '--workers', '2'], join(work, `${name}-ending-render.log`));
    const filter = '[0:v]split=3[h][r][o];[h]trim=end=19.6,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[head];[r]trim=start=24.6:end=28.6,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[reserve];[o]trim=start=29.2,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[outro];[1:v]setpts=PTS-STARTPTS,format=yuv420p,setsar=1[subscription];[2:v]setpts=PTS-STARTPTS,format=yuv420p,setsar=1[call];[head][subscription]xfade=transition=fade:duration=0.4:offset=19.2[first];[first][reserve]xfade=transition=fade:duration=0.4:offset=24.6[second];[second][call]xfade=transition=fade:duration=0.4:offset=28.2[third];[third][outro]xfade=transition=fade:duration=0.4:offset=33.8[v]';
    await run(ffmpeg, ['-hide_banner', '-y', '-i', input, '-i', scene, '-i', endingScene, '-filter_complex', filter, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-t', '36.2', '-movflags', '+faststart', output], join(work, `${name}-splice.log`));
    const result = await probe(output, join(work, `${name}-output.json`));
    const finalVideo = result.streams.find(s => s.codec_type === 'video');
    if (Math.abs(Number(result.format.duration) - 36.2) > .02 || finalVideo.width !== video.width || finalVideo.height !== video.height || finalVideo.r_frame_rate !== '30/1' || Number(finalVideo.nb_frames) !== 1086) throw new Error(`Output format mismatch: ${file}`);
    manifest.push({ file, sourceSha256: hash(input), outputSha256: hash(output), duration: result.format.duration, video: finalVideo, checks: ['subscription:lint/validate/inspect', 'ending:lint/validate/inspect'], exclusiveLabel: languages[lang][5], endingHeadline: endingCopy[lang][1] });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`OK ${name}: ${file}`);
  }));
  const failures = batch.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'One or more variants failed');
}
console.log(`Rendered and verified ${manifest.length} films.`);
