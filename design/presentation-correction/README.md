# Correction to the presentation film

The original editable project is not in this repository. This HyperFrames source replaces only the Follow → Subscribe → Reserve scene in the ten existing MP4 files. The subscription label now describes exclusive content in Spanish, English, Portuguese, French and Italian. Reserve Event and Reserve 1:1 stay available.

The originals are silent, 31.6 seconds at 30 fps, in 1280×720 and 720×1280. The replacement runs from 19.2 to 25.0 seconds with 0.4-second crossfades. The source footage before 19.2 and after 25.0 stays at its original timeline position. Encoding is H.264 CRF 18 with fast-start metadata.

## Rebuild

Requires Node 22+, the app dependencies (`npm ci` at repository root), and the packages in this directory (`npm install`). Use an untouched copy of `public/presentacion` from commit `0378e77ca8b07b7165602d1da02326b1d266126c` as `--originals`. Do not use the already corrected outputs as source.

```sh
node design/presentation-correction/render.mjs --originals /path/to/originals --out /path/to/output --work /path/to/work
```

`--tools /path/to/tools` optionally points to another directory containing the pinned tool dependencies in `node_modules`. HyperFrames may use `HYPERFRAMES_BROWSER_PATH` for a locally installed Chrome. The script uses the packaged FFmpeg executable, validates each composition, renders each scene, then splices and probes every final video. Outputs include the ten MP4s and a manifest with hashes, dimensions, frame rates, durations and checks.

To retry a single language after an interrupted render, use the same output directory and add `--lang it` (or the relevant language code). Add `--shape vertical` or `--shape horizontal` to retry one format. This preserves the other manifest entries.

The input folder is read-only. Review the outputs before copying them to `public/presentacion`. Original posters have no subscription promise and are retained. The React component's asset version must be bumped when replacing films so cached videos refresh.

See `DESIGN.md` for the established identity and motion rules. These are local tooling dependencies, separate from the website's dependencies.
