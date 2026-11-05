import { mkdirSync, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { generate, sourceDir, languages } from './generate.mjs';

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
const projects = generate(join(work, 'projects'), tools).filter(project => (!args.lang || project.lang === args.lang) && (!args.shape || (project.portrait ? 'vertical' : 'horizontal') === args.shape));
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
    for (const command of ['lint', 'validate', 'inspect']) {
      const flags = command === 'inspect' ? ['--samples', '12', '--strict'] : [];
      await run(process.execPath, [cli, command, folder, ...flags], join(work, `${name}-${command}.log`));
    }
    const scene = join(work, `${name}-scene.mp4`);
    await run(process.execPath, [cli, 'render', folder, '--output', scene, '--fps', '30', '--quality', 'high', '--workers', '2'], join(work, `${name}-render.log`));
    // Turn-taking fix in the opening call: while she says her line (about 7.0-8.45 s) his half of the
    // call came from a take where he talks too. Replace only his half with his own silent listening
    // frames from 8.45-9.75 s (before his bubble appears), played in reverse so the last patched frame
    // is exactly the one at 8.45 s, with a 0.2 s fade-in. Everything else stays untouched.
    const [px, py, pw, ph] = portrait ? [116, 820, 488, 412] : [788, 358, 338, 302];
    const callFix = `[0:v]split=2[base][src];[src]trim=start=8.45:end=9.75,setpts=PTS-STARTPTS,crop=${pw}:${ph}:${px}:${py},reverse,setpts=1.12*PTS,fps=30,format=yuva420p,fade=t=in:st=0:d=0.2:alpha=1,setpts=PTS+7.0/TB[quiet];[base][quiet]overlay=${px}:${py}:eof_action=pass:enable='between(t,7.0,8.45)',format=yuv420p,settb=1/15360,setpts=N*512[fixed];`; // exact 1/30 s timestamps so the later trims keep all 948 frames
    const filter = callFix + '[fixed]split=2[h][t];[h]trim=end=19.6,setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[head];[t]trim=start=24.6,setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[tail];[1:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[scene];[head][scene]xfade=transition=fade:duration=0.4:offset=19.2[first];[first][tail]xfade=transition=fade:duration=0.4:offset=24.6[v]';
    await run(ffmpeg, ['-hide_banner', '-y', '-i', input, '-i', scene, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'copy', '-t', '31.6', '-movflags', '+faststart', output], join(work, `${name}-splice.log`));
    const result = await probe(output, join(work, `${name}-output.json`));
    const finalVideo = result.streams.find(s => s.codec_type === 'video');
    if (Math.abs(Number(result.format.duration) - 31.6) > .02 || finalVideo.width !== video.width || finalVideo.height !== video.height || finalVideo.r_frame_rate !== '30/1' || Number(finalVideo.nb_frames) !== 948) throw new Error(`Output format mismatch: ${file}`);
    manifest.push({ file, sourceSha256: hash(input), outputSha256: hash(output), duration: result.format.duration, video: finalVideo, checks: ['lint', 'validate', 'inspect'], exclusiveLabel: languages[lang][3], proposeLabel: languages[lang][4] });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`OK ${name}: ${file}`);
  }));
  const failures = batch.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'One or more variants failed');
}
console.log(`Rendered and verified ${manifest.length} films.`);
